/**
 * Driver queue reads/writes: halls today, bag hall (lazy allocation), turn registration, priorities,
 * bulk status and history. Every method derives tenantId/driverId from the session (scopedDriver).
 */
import { Injectable } from '@nestjs/common';
import type { Hall, HallDay, Prisma } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';
import {
  localDate,
  type BagBlockReason,
  type BagHallDto,
  type BagTurnDto,
  type DriverBulkRole,
  type DriverBulkStateDto,
  type DriverHistoryDto,
  type DriverQueueHallsDto,
  type QueueHallDto,
  type SetBagPrioritiesInput,
} from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedDriver, type DriverScope } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService, TX_TIMEOUT_MS, type PrismaTx } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { QueueEngineService } from './queue-engine.service';
import { bagAssignmentDto, bagPriorityDtos, bagTurnDto, driverReservationDtoFromFull, reservationInclude } from './queue-mappers';
import {
  assertDriverEligible,
  dateOnlyIso,
  eligibilityError,
  firstBulkHall,
  hallDayDto,
  hasActivePenalty,
  loadDriverContext,
  loaderGroupMatches,
  parseGroupsSnapshot,
  readBulkSettings,
  syncHallDayStatus,
  timedPolicy,
  type DriverContext,
} from './queue-support';

const MAP_REASON: Record<string, BagBlockReason> = {
  DRIVER_NOT_APPROVED: 'DRIVER_NOT_APPROVED',
  DRIVER_BLOCKED: 'DRIVER_BLOCKED',
  DOCUMENTS_EXPIRED: 'DOCUMENTS_EXPIRED',
};

@Injectable()
export class DriverQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly engine: QueueEngineService,
    private readonly publisher: RealtimePublisher,
  ) {}

  private get db(): PrismaTx {
    return this.prisma;
  }

  // ───────────────────────── GET /driver/queue/halls ─────────────────────────
  async halls(user: AuthUser): Promise<DriverQueueHallsDto> {
    const { tenantId } = scopedDriver(user);
    const now = this.clock.now();
    const today = localDate(now);
    const halls = await this.prisma.hall.findMany({
      where: { tenantId, active: true, category: { in: ['BAG', 'BULK'] } },
      orderBy: { createdAt: 'asc' },
    });
    const days = await this.prisma.hallDay.findMany({ where: { tenantId, date: today } });
    const dayByHall = new Map(days.map((d) => [d.hallId, d]));
    const out: QueueHallDto[] = [];
    for (const h of halls) {
      const raw = dayByHall.get(h.id) ?? null;
      const day = raw ? await syncHallDayStatus(this.db, raw, now) : null;
      out.push({
        hallId: h.id,
        title: h.title,
        category: h.category,
        day: day ? hallDayDto(day) : null,
        serverTime: now.toISOString(),
      });
    }
    return { serverTime: now.toISOString(), halls: out };
  }

  // ───────────────────────── GET /driver/bag ─────────────────────────
  async bag(user: AuthUser): Promise<BagHallDto> {
    const scope = scopedDriver(user);
    const now = this.clock.now();
    const today = localDate(now);
    const found = await this.bagHallAndDay(this.db, scope.tenantId, today);
    const hall = found.hall;
    let day = found.day;
    if (hall && day) {
      const synced = await syncHallDayStatus(this.db, day, now);
      day = synced;
      if ((synced.status === 'OPEN' || synced.status === 'CLOSED') && synced.priorityEndAt && now >= synced.priorityEndAt) {
        let events: Awaited<ReturnType<QueueEngineService['allocateBagTx']>> = [];
        await this.prisma.$transaction(
          async (tx) => {
            const fresh = await tx.hallDay.findUniqueOrThrow({ where: { id: synced.id } });
            events = await this.engine.allocateBagTx(tx, fresh, now);
          },
          { timeout: TX_TIMEOUT_MS },
        );
        await this.publisher.publishAll(events);
        day = await this.prisma.hallDay.findUniqueOrThrow({ where: { id: synced.id } });
      }
    }
    return this.buildBagDto(scope, hall, day, now, today);
  }

  private async buildBagDto(scope: DriverScope, hall: Hall | null, day: HallDay | null, now: Date, today: string): Promise<BagHallDto> {
    const serverTime = now.toISOString();
    if (!hall) {
      return {
        serverTime,
        hall: null,
        day: null,
        turn: null,
        priorities: [],
        canRegister: false,
        registerBlock: 'NO_DAY',
        canSetPriorities: false,
        priorityBlock: 'NO_DAY',
        window: null,
        result: null,
      };
    }
    const ctx = await loadDriverContext(this.db, scope.tenantId, scope.driverId);
    const policy = await timedPolicy(this.db, hall.id);
    const eligibility = eligibilityError(ctx.driver, ctx.vehicle, policy.requireValidDocuments, today);
    const penalized = !eligibility && (await hasActivePenalty(this.db, scope.tenantId, scope.driverId, now));

    const turn = day
      ? await this.prisma.bagTurn.findUnique({ where: { hallDayId_driverId: { hallDayId: day.id, driverId: scope.driverId } } })
      : null;

    const common = eligibility ? MAP_REASON[eligibility] ?? null : penalized ? 'DRIVER_PENALIZED' : null;
    const registerBlock = this.registerBlock(day, turn !== null, common, now);
    const priorityBlock = this.priorityBlock(day, turn !== null, common, now);

    let result: BagHallDto['result'] = null;
    if (day && turn) {
      const status: 'WAITING' | 'ALLOCATED' | 'NOT_ALLOCATED' =
        turn.status === 'ALLOCATED' ? 'ALLOCATED' : turn.status === 'NOT_ALLOCATED' ? 'NOT_ALLOCATED' : 'WAITING';
      let assignment = null;
      if (status === 'ALLOCATED') {
        const r = await this.prisma.reservation.findFirst({
          where: { tenantId: scope.tenantId, driverId: scope.driverId, hallDayId: day.id, allocationRunId: { not: null }, status: { not: 'CANCELLED' } },
          include: reservationInclude,
        });
        if (r) assignment = await bagAssignmentDto(this.db, r);
      }
      result = { status, assignment };
    }

    return {
      serverTime,
      hall: { id: hall.id, title: hall.title },
      day: day ? hallDayDto(day) : null,
      turn: turn ? bagTurnDto(turn) : null,
      priorities: turn ? await bagPriorityDtos(this.db, turn.id) : [],
      canRegister: registerBlock === null,
      registerBlock,
      canSetPriorities: priorityBlock === null,
      priorityBlock,
      window:
        day?.priorityEndAt && day
          ? { opensAt: day.t0At.toISOString(), closesAt: day.priorityEndAt.toISOString() }
          : null,
      result,
    };
  }

  private registerBlock(day: HallDay | null, hasTurn: boolean, common: BagBlockReason | null, now: Date): BagBlockReason | null {
    if (!day) return 'NO_DAY';
    if (day.status === 'HALTED') return 'HALL_HALTED';
    if (common) return common;
    if (hasTurn) return 'TURN_EXISTS';
    if (now < day.t0At) return 'BEFORE_T0';
    if (day.status !== 'OPEN' && day.status !== 'ALLOCATING') return 'HALL_HALTED';
    if (!day.priorityEndAt || now >= day.priorityEndAt) return 'AFTER_PRIORITY_END';
    return null;
  }

  private priorityBlock(day: HallDay | null, hasTurn: boolean, common: BagBlockReason | null, now: Date): BagBlockReason | null {
    if (!day) return 'NO_DAY';
    if (day.status === 'HALTED') return 'HALL_HALTED';
    if (common) return common;
    if (!hasTurn) return 'NO_TURN';
    if (now < day.t0At) return 'BEFORE_T0';
    if (!day.priorityEndAt || now >= day.priorityEndAt) return 'AFTER_PRIORITY_END';
    return null;
  }

  // ───────────────────────── POST /driver/bag/turn ─────────────────────────
  async registerTurn(user: AuthUser): Promise<{ turn: BagTurnDto }> {
    const scope = scopedDriver(user);
    const now = this.clock.now();
    const today = localDate(now);
    return this.prisma.$transaction(
      async (tx) => {
        const { hall, day: raw } = await this.bagHallAndDay(tx, scope.tenantId, today);
        if (!hall || !raw) throw new DomainError('HALL_NOT_OPEN');
        const day = await syncHallDayStatus(tx, raw, now);
        const ctx = await loadDriverContext(tx, scope.tenantId, scope.driverId);
        const policy = await timedPolicy(tx, hall.id);
        await assertDriverEligible(tx, ctx, policy.requireValidDocuments, now);
        if (day.status === 'HALTED') throw new DomainError('HALL_HALTED');
        if (day.status !== 'OPEN' && day.status !== 'ALLOCATING') throw new DomainError('HALL_NOT_OPEN');
        if (now < day.t0At) throw new DomainError('HALL_NOT_OPEN');
        if (!day.priorityEndAt || now >= day.priorityEndAt) throw new DomainError('PRIORITY_WINDOW_CLOSED');
        const existing = await tx.bagTurn.findUnique({ where: { hallDayId_driverId: { hallDayId: day.id, driverId: scope.driverId } } });
        if (existing) throw new DomainError('TURN_EXISTS');
        const rows = await tx.$queryRaw<{ turnSeq: number }[]>`
          UPDATE hall_days SET "turnSeq" = "turnSeq" + 1, "updatedAt" = ${now}
          WHERE id = ${day.id}::uuid RETURNING "turnSeq"`;
        const turnNo = rows[0]!.turnSeq;
        let turn;
        try {
          turn = await tx.bagTurn.create({
            data: { tenantId: scope.tenantId, hallDayId: day.id, driverId: scope.driverId, turnNo, registeredAt: now },
          });
        } catch (e) {
          if (e instanceof PrismaNS.PrismaClientKnownRequestError && e.code === 'P2002') throw new DomainError('TURN_EXISTS');
          throw e;
        }
        await tx.queueEvent.create({
          data: {
            tenantId: scope.tenantId,
            hallDayId: day.id,
            type: 'TURN_REGISTERED',
            payload: { turnId: turn.id, driverId: scope.driverId, turnNo } satisfies Prisma.InputJsonObject,
            actorId: user.id,
          },
        });
        await this.audit.log(
          { action: 'bag.turn.register', entity: 'BagTurn', entityId: turn.id, after: { turnNo, hallDayId: day.id }, tenantId: scope.tenantId },
          tx,
        );
        return { turn: bagTurnDto(turn) };
      },
      { timeout: 30_000, maxWait: 60_000 },
    );
  }

  // ───────────────────────── PUT /driver/bag/priorities ─────────────────────────
  async setPriorities(user: AuthUser, input: SetBagPrioritiesInput): Promise<{ priorities: Awaited<ReturnType<typeof bagPriorityDtos>> }> {
    const scope = scopedDriver(user);
    const now = this.clock.now();
    const today = localDate(now);
    const unique = [...new Set(input.announcementIds)];
    if (unique.length !== input.announcementIds.length) throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'announcementIds', message: 'duplicate' }] });

    return this.prisma.$transaction(
      async (tx) => {
        const { hall, day: raw } = await this.bagHallAndDay(tx, scope.tenantId, today);
        if (!hall || !raw) throw new DomainError('HALL_NOT_OPEN');
        const day = await syncHallDayStatus(tx, raw, now);
        const ctx = await loadDriverContext(tx, scope.tenantId, scope.driverId);
        const policy = await timedPolicy(tx, hall.id);
        await assertDriverEligible(tx, ctx, policy.requireValidDocuments, now);
        if (day.status === 'HALTED') throw new DomainError('HALL_HALTED');
        const turn = await tx.bagTurn.findUnique({ where: { hallDayId_driverId: { hallDayId: day.id, driverId: scope.driverId } } });
        if (!turn) throw new DomainError('NO_TURN');
        if (now < day.t0At) throw new DomainError('HALL_NOT_OPEN');
        if (!day.priorityEndAt || now >= day.priorityEndAt) throw new DomainError('PRIORITY_WINDOW_CLOSED');

        const loader = ctx.vehicle?.loaderTypeId;
        for (const announcementId of unique) {
          const a = await tx.announcement.findFirst({
            where: { id: announcementId, tenantId: scope.tenantId, hallId: hall.id, status: 'ACTIVE', deletedAt: null },
            select: { id: true, loaderTypeId: true, loaderType2Id: true },
          });
          if (!a) throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'announcementIds', message: 'not eligible announcement' }] });
          if (!loader || !loaderGroupMatches(a, loader)) throw new DomainError('LOADER_MISMATCH');
          const open = await tx.loadUnit.count({ where: { announcementId, allocation: 'TIMED', state: 'OPEN' } });
          if (open <= 0) throw new DomainError('NO_UNIT_AVAILABLE');
        }

        const previousPriorities = await tx.bagPriority.count({ where: { turnId: turn.id } });
        await tx.bagPriority.deleteMany({ where: { turnId: turn.id } });
        if (unique.length) {
          await tx.bagPriority.createMany({
            data: unique.map((announcementId, i) => ({ tenantId: scope.tenantId, turnId: turn.id, rank: i + 1, announcementId })),
          });
        }
        await tx.queueEvent.create({
          data: {
            tenantId: scope.tenantId,
            hallDayId: day.id,
            type: 'PRIORITIES_SET',
            payload: { turnId: turn.id, driverId: scope.driverId, announcementIds: unique } satisfies Prisma.InputJsonObject,
            actorId: user.id,
          },
        });
        await this.audit.log(
          {
            action: 'bag.priorities.set',
            entity: 'BagTurn',
            entityId: turn.id,
            before: { priorities: previousPriorities },
            after: { priorities: unique },
            tenantId: scope.tenantId,
          },
          tx,
        );
        return { priorities: await bagPriorityDtos(tx, turn.id) };
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }

  // ───────────────────────── GET /driver/bulk ─────────────────────────
  async bulkState(user: AuthUser): Promise<DriverBulkStateDto> {
    const scope = scopedDriver(user);
    const now = this.clock.now();
    const today = localDate(now);
    const hall = await firstBulkHall(this.db, scope.tenantId);
    if (!hall) {
      return {
        serverTime: now.toISOString(),
        hall: null,
        day: null,
        halted: false,
        haltedReason: null,
        myGroup: null,
        headGroup: null,
        window: null,
        nextGroupTitle: null,
        groupCount: 0,
        canReserveNow: false,
      };
    }
    let day = await this.prisma.hallDay.findUnique({ where: { hallId_date: { hallId: hall.id, date: today } } });
    if (day) {
      day = await syncHallDayStatus(this.db, day, now);
      const ctx = await loadDriverContext(this.db, scope.tenantId, scope.driverId);
      let events: Awaited<ReturnType<QueueEngineService['advanceBulkTx']>> = [];
      await this.prisma.$transaction(
        async (tx) => {
          const fresh = await tx.hallDay.findUniqueOrThrow({ where: { id: day!.id } });
          events = await this.engine.advanceBulkTx(tx, ctx.driver.carrierId, fresh, now);
        },
        { timeout: TX_TIMEOUT_MS },
      );
      await this.publisher.publishAll(events);
      day = await this.prisma.hallDay.findUniqueOrThrow({ where: { id: day.id } });
    }

    const ctx = await loadDriverContext(this.db, scope.tenantId, scope.driverId);
    const bulkDay = day
      ? await this.prisma.bulkDay.findUnique({ where: { carrierId_hallDayId: { carrierId: ctx.driver.carrierId, hallDayId: day.id } } })
      : null;
    const rotation = await this.prisma.bulkRotationState.findUnique({
      where: { carrierId_hallId: { carrierId: ctx.driver.carrierId, hallId: hall.id } },
    });
    const groups = bulkDay ? parseGroupsSnapshot(bulkDay.membersSnapshot) : [];
    const groupRows = groups.length
      ? await this.prisma.bulkGroup.findMany({ where: { id: { in: groups.map((g) => g.id) } }, select: { id: true, title: true } })
      : [];
    const titles = new Map(groupRows.map((g) => [g.id, g.title]));
    const myGroup = groups.find((g) => g.memberIds.includes(scope.driverId)) ?? null;
    const openWindow = bulkDay
      ? await this.prisma.bulkWindow.findFirst({ where: { bulkDayId: bulkDay.id, closedAt: null }, orderBy: { seq: 'desc' } })
      : null;
    const settings = rotation ? readBulkSettings(rotation.settings) : null;

    let canReserveNow = false;
    if (openWindow && bulkDay && day && day.status !== 'HALTED' && bulkDay.status !== 'HALTED') {
      const isMine = openWindow.eligible.includes(scope.driverId);
      const already = await this.prisma.reservation.count({ where: { bulkWindowId: openWindow.id, driverId: scope.driverId, status: { not: 'CANCELLED' } } });
      const loadsToday = await this.prisma.reservation.count({
        where: { tenantId: scope.tenantId, driverId: scope.driverId, status: { not: 'CANCELLED' }, bulkWindow: { is: { bulkDayId: bulkDay.id } } },
      });
      const openUnits = await this.prisma.loadUnit.count({
        where: { allocation: 'GROUP', state: 'OPEN', tenantId: scope.tenantId, announcement: { is: { carrierId: ctx.driver.carrierId, hallId: hall.id, status: 'ACTIVE', deletedAt: null } } },
      });
      canReserveNow = isMine && already === 0 && loadsToday < (settings?.maxLoadsPerDriverPerDay ?? 2) && openUnits > 0;
    }

    const role: DriverBulkRole | null = !myGroup
      ? null
      : bulkDay && myGroup.id === bulkDay.headGroupId
        ? 'HEAD'
        : rotation && myGroup.id === rotation.cursorGroupId
          ? 'CURSOR'
          : 'OTHER';
    const headGroup = bulkDay
      ? { id: bulkDay.headGroupId, title: titles.get(bulkDay.headGroupId) ?? '' }
      : null;
    const cursorGroupId = openWindow?.groupId ?? rotation?.cursorGroupId ?? null;
    const cursorIndex = cursorGroupId ? groups.findIndex((g) => g.id === cursorGroupId) : -1;
    const nextGroup = cursorIndex >= 0 ? groups[(cursorIndex + 1) % groups.length] : undefined;

    return {
      serverTime: now.toISOString(),
      hall: { id: hall.id, title: hall.title },
      day: day ? hallDayDto(day) : null,
      halted: day?.status === 'HALTED' || bulkDay?.status === 'HALTED',
      haltedReason: day?.haltedReason ?? bulkDay?.haltedReason ?? null,
      myGroup: myGroup
        ? {
            id: myGroup.id,
            title: titles.get(myGroup.id) ?? '',
            role: role ?? 'OTHER',
            remainingCount: rotation?.cursorGroupId === myGroup.id ? rotation.cursorRemaining.length : myGroup.memberIds.length,
          }
        : null,
      headGroup,
      window: openWindow
        ? {
            seq: openWindow.seq,
            kind: openWindow.kind,
            round: openWindow.round,
            groupId: openWindow.groupId,
            groupTitle: titles.get(openWindow.groupId) ?? '',
            isMine: openWindow.eligible.includes(scope.driverId),
            opensAt: openWindow.opensAt.toISOString(),
            closesAt: openWindow.closesAt.toISOString(),
          }
        : null,
      nextGroupTitle: nextGroup ? (titles.get(nextGroup.id) ?? '') : null,
      groupCount: groups.length,
      canReserveNow,
    };
  }

  // ───────────────────────── GET /driver/history ─────────────────────────
  async history(user: AuthUser): Promise<DriverHistoryDto> {
    const scope = scopedDriver(user);
    const turns = await this.prisma.bagTurn.findMany({
      where: { tenantId: scope.tenantId, driverId: scope.driverId },
      include: { hallDay: { include: { hall: { select: { title: true } } } } },
      orderBy: { registeredAt: 'desc' },
      take: 200,
    });
    const turnDtos: DriverHistoryDto['turns'] = [];
    for (const t of turns) {
      let assignment = null;
      if (t.status === 'ALLOCATED') {
        const r = await this.prisma.reservation.findFirst({
          where: { tenantId: scope.tenantId, driverId: scope.driverId, hallDayId: t.hallDayId, allocationRunId: { not: null }, status: { not: 'CANCELLED' } },
          include: reservationInclude,
        });
        if (r) assignment = await bagAssignmentDto(this.db, r);
      }
      turnDtos.push({
        ...bagTurnDto(t),
        hallTitle: t.hallDay.hall.title,
        date: t.hallDay.date,
        assignment,
      });
    }
    const reservations = await this.prisma.reservation.findMany({
      where: { tenantId: scope.tenantId, driverId: scope.driverId },
      include: reservationInclude,
      orderBy: { reservedAt: 'desc' },
      take: 200,
    });
    const reservationDtos: DriverHistoryDto['reservations'] = [];
    for (const r of reservations) reservationDtos.push(await driverReservationDtoFromFull(this.db, r));
    return { turns: turnDtos, reservations: reservationDtos };
  }

  // ───────────────────────── helpers ─────────────────────────
  private async bagHallAndDay(db: PrismaTx, tenantId: string, today: string): Promise<{ hall: Hall | null; day: HallDay | null }> {
    const halls = await db.hall.findMany({ where: { tenantId, active: true, category: 'BAG' }, orderBy: { createdAt: 'asc' } });
    if (halls.length === 0) return { hall: null, day: null };
    const days = await db.hallDay.findMany({ where: { hallId: { in: halls.map((h) => h.id) }, date: today } });
    const byHall = new Map(days.map((d) => [d.hallId, d]));
    for (const h of halls) {
      const d = byHall.get(h.id);
      if (d) return { hall: h, day: d };
    }
    return { hall: halls[0]!, day: null };
  }
}

// re-exported for tests that build the DTO directly
export { eligibilityError, dateOnlyIso };
export type { DriverContext };
