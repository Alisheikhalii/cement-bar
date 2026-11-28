/**
 * Driver reservation lifecycle (SPEC §3.2): atomic reservation, idempotent retry, cancel requests and
 * active/history listing. All decisions use the SERVER clock inside the transaction.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type Allocation,
  type CancelRequestInput,
  type CreateReservationInput,
  type DriverReservationDto,
  type QueueSseEvent,
} from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedDriver, type DriverScope } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { requestContext } from '../../common/context/request-context';
import { DomainError } from '../../common/errors/domain-error';
import { uniqueViolationField } from '../../common/errors/error-mapping';
import { PrismaService, TX_TIMEOUT_MS, type PrismaTx } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { QueueEngineService } from './queue-engine.service';
import { driverReservationDto, driverReservationDtoFromFull, reservationInclude } from './queue-mappers';
import {
  assertDriverEligible,
  bulkPolicy,
  counterRange,
  dateOnlyIso,
  freePolicy,
  hasActivePenalty,
  loaderGroupMatches,
  loadDriverContext,
  readBulkSettings,
  syncHallDayStatus,
  timedPolicy,
} from './queue-support';

const ACTIVE_STATUSES = ['RESERVED', 'ARRIVED', 'LOADED', 'EXITED', 'CANCEL_REQUESTED'] as const;
const ARCHIVED_STATUSES = ['CANCELLED', 'NO_SHOW', 'RETURNED'] as const;

interface UnitRow {
  id: string;
  seq: number;
  allocation: Allocation;
  state: string;
  announcementId: string;
}

@Injectable()
export class DriverReservationsService {
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

  // ───────────────────────── POST /driver/reservations ─────────────────────────
  async create(user: AuthUser, input: CreateReservationInput): Promise<DriverReservationDto> {
    const scope = scopedDriver(user);
    const now = this.clock.now();
    const key = input.idempotencyKey;

    // Fast idempotent retry: the same key returns the same permit.
    const prior = await this.prisma.reservation.findUnique({
      where: { driverId_idempotencyKey: { driverId: scope.driverId, idempotencyKey: key } },
      select: { id: true },
    });
    if (prior) return driverReservationDto(this.db, prior.id);

    const events: QueueSseEvent[] = [];
    let reservationId = '';
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const ctx = await loadDriverContext(tx, scope.tenantId, scope.driverId);
          const target = await this.resolveTarget(tx, scope, input);
          const hall = await tx.hall.findUnique({ where: { id: target.hallId } });
          if (!hall) throw new DomainError('NOT_FOUND');
          const requireDocs =
            hall.category === 'BULK'
              ? (await bulkPolicy(tx, hall.id)).requireValidDocuments
              : (await timedPolicy(tx, hall.id)).requireValidDocuments;
          await assertDriverEligible(tx, ctx, requireDocs, now);

          // Lazy advance of the driver's own carrier rotation inside the same transaction.
          if (hall.category === 'BULK' && target.hallDayId) {
            const hd = await tx.hallDay.findUnique({ where: { id: target.hallDayId } });
            if (hd) events.push(...(await this.engine.advanceBulkTx(tx, ctx.driver.carrierId, hd, now)));
          }

          const loader = ctx.vehicle!.loaderTypeId;
          const unit = await this.selectUnit(tx, scope.tenantId, input, loader);
          const ann = await tx.announcement.findFirst({
            where: { id: unit.announcementId, tenantId: scope.tenantId, status: 'ACTIVE', deletedAt: null },
            select: { id: true, carrierId: true, hallId: true, hallDayId: true, number: true, loaderTypeId: true, loaderType2Id: true },
          });
          if (!ann) throw new DomainError('NO_UNIT_AVAILABLE');
          if (!loaderGroupMatches(ann, loader)) throw new DomainError('LOADER_MISMATCH');

          const day = ann.hallDayId ? await tx.hallDay.findUnique({ where: { id: ann.hallDayId } }) : null;
          if (!day) throw new DomainError('HALL_NOT_OPEN');
          const syncedDay = await syncHallDayStatus(tx, day, now);
          if (syncedDay.status === 'HALTED') throw new DomainError('HALL_HALTED');

          let bulkWindowId: string | null = null;
          if (unit.allocation === 'TIMED') throw new DomainError('WINDOW_CLOSED');
          if (unit.allocation === 'FREE') {
            if (syncedDay.status !== 'OPEN' && syncedDay.status !== 'ALLOCATING') throw new DomainError('HALL_NOT_OPEN');
            if (now < syncedDay.t0At || now >= syncedDay.hallEndAt) throw new DomainError('HALL_NOT_OPEN');
            const fp = await freePolicy(tx, hall.id);
            const activeFree = await tx.reservation.count({
              where: { tenantId: scope.tenantId, driverId: scope.driverId, source: 'FREE', status: { in: [...ACTIVE_STATUSES] } },
            });
            if (activeFree >= fp.maxActiveFreeReservations) throw new DomainError('ACTIVE_FREE_LIMIT');
          } else {
            // GROUP
            if (ann.carrierId !== ctx.driver.carrierId) throw new DomainError('NOT_IN_GROUP');
            const bulkDay = await tx.bulkDay.findUnique({
              where: { carrierId_hallDayId: { carrierId: ctx.driver.carrierId, hallDayId: day.id } },
            });
            const window = bulkDay
              ? await tx.bulkWindow.findFirst({ where: { bulkDayId: bulkDay.id, closedAt: null }, orderBy: { seq: 'desc' } })
              : null;
            if (!window || now < window.opensAt || now >= window.closesAt) throw new DomainError('WINDOW_CLOSED');
            if (!window.eligible.includes(scope.driverId)) {
              const groups = bulkDay ? await this.groupContains(tx, bulkDay.membersSnapshot, scope.driverId) : false;
              throw new DomainError(groups ? 'WINDOW_CLOSED' : 'NOT_IN_GROUP');
            }
            const inWindow = await tx.reservation.count({
              where: { bulkWindowId: window.id, driverId: scope.driverId, status: { not: 'CANCELLED' } },
            });
            if (inWindow > 0) throw new DomainError('ONE_PER_WINDOW');
            const rotation = await tx.bulkRotationState.findUnique({
              where: { carrierId_hallId: { carrierId: ctx.driver.carrierId, hallId: hall.id } },
            });
            const maxLoads = rotation ? readBulkSettings(rotation.settings).maxLoadsPerDriverPerDay : 2;
            const loadsToday = await tx.reservation.count({
              where: { tenantId: scope.tenantId, driverId: scope.driverId, status: { not: 'CANCELLED' }, bulkWindow: { is: { bulkDayId: bulkDay!.id } } },
            });
            if (loadsToday >= maxLoads) throw new DomainError('DAILY_LIMIT_REACHED');
            bulkWindowId = window.id;
          }

          const permitNo = (await counterRange(tx, scope.tenantId, 'permit', 1))[0]!;
          const ctxReq = requestContext.get();
          const reservation = await tx.reservation.create({
            data: {
              tenantId: scope.tenantId,
              permitNo,
              unitId: unit.id,
              driverId: scope.driverId,
              carrierId: ann.carrierId,
              source: unit.allocation === 'GROUP' ? 'GROUP' : 'FREE',
              hallDayId: day.id,
              bulkWindowId,
              status: 'RESERVED',
              idempotencyKey: key,
              reservedAt: now,
              ip: ctxReq?.ip ?? null,
              userAgent: ctxReq?.userAgent ?? null,
            },
          });
          const upd = await tx.loadUnit.updateMany({
            where: { id: unit.id, state: 'OPEN' },
            data: { state: 'RESERVED', currentReservationId: reservation.id, version: { increment: 1 } },
          });
          if (upd.count !== 1) throw new DomainError('UNIT_TAKEN');
          const remaining = await tx.loadUnit.count({ where: { announcementId: ann.id, state: 'OPEN' } });
          await tx.queueEvent.create({
            data: {
              tenantId: scope.tenantId,
              hallDayId: day.id,
              carrierId: ann.carrierId,
              type: 'RESERVED',
              payload: {
                reservationId: reservation.id,
                permitNo,
                unitId: unit.id,
                announcementId: ann.id,
                driverId: scope.driverId,
                source: reservation.source,
                bulkWindowId,
                remaining,
              } satisfies Prisma.InputJsonObject,
              actorId: user.id,
            },
          });
          await this.audit.log(
            {
              action: 'reservation.create',
              entity: 'Reservation',
              entityId: reservation.id,
              after: { permitNo, unitId: unit.id, announcementId: ann.id, source: reservation.source, bulkWindowId },
              tenantId: scope.tenantId,
            },
            tx,
          );
          events.push({
            type: 'unit.reserved',
            tenantId: scope.tenantId,
            hallId: hall.id,
            at: now.toISOString(),
            payload: { announcementId: ann.id, unitId: unit.id, remaining, carrierId: ann.carrierId },
          });
          reservationId = reservation.id;
        },
        { timeout: TX_TIMEOUT_MS },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const field = uniqueViolationField(e) ?? '';
        if (field.includes('idempotencyKey')) {
          const again = await this.prisma.reservation.findUnique({
            where: { driverId_idempotencyKey: { driverId: scope.driverId, idempotencyKey: key } },
            select: { id: true },
          });
          if (again) return driverReservationDto(this.db, again.id);
        }
        throw new DomainError('UNIT_TAKEN');
      }
      throw e;
    }

    await this.publisher.publishAll(events);
    return driverReservationDto(this.db, reservationId);
  }

  private async resolveTarget(
    tx: PrismaTx,
    scope: DriverScope,
    input: CreateReservationInput,
  ): Promise<{ hallId: string; hallDayId: string | null }> {
    if (input.announcementId) {
      const a = await tx.announcement.findFirst({
        where: { id: input.announcementId, tenantId: scope.tenantId, status: 'ACTIVE', deletedAt: null },
        select: { hallId: true, hallDayId: true },
      });
      if (!a) throw new DomainError('NOT_FOUND');
      return { hallId: a.hallId, hallDayId: a.hallDayId };
    }
    const u = await tx.loadUnit.findFirst({
      where: { id: input.unitId, tenantId: scope.tenantId },
      select: { announcement: { select: { hallId: true, hallDayId: true } } },
    });
    if (!u) throw new DomainError('NOT_FOUND');
    return { hallId: u.announcement.hallId, hallDayId: u.announcement.hallDayId };
  }

  private async selectUnit(
    tx: PrismaTx,
    tenantId: string,
    input: CreateReservationInput,
    loaderTypeId: string,
  ): Promise<UnitRow> {
    if (input.unitId) {
      const rows = await tx.$queryRaw<UnitRow[]>(Prisma.sql`
        SELECT u.id, u.seq, u.allocation::text AS "allocation", u.state::text AS "state", u."announcementId"
        FROM load_units u
        JOIN announcements a ON a.id = u."announcementId"
        WHERE u.id = ${input.unitId}::uuid AND a."tenantId" = ${tenantId}::uuid
          AND a.status = 'ACTIVE' AND a."deletedAt" IS NULL
          AND u.state = 'OPEN'
        FOR UPDATE OF u`);
      if (rows.length === 0) {
        const exists = await tx.reservation.count({
          where: { unitId: input.unitId, status: { in: [...ACTIVE_STATUSES] } },
        });
        throw new DomainError(exists > 0 ? 'UNIT_TAKEN' : 'NO_UNIT_AVAILABLE');
      }
      return rows[0]!;
    }
    const rows = await tx.$queryRaw<UnitRow[]>(Prisma.sql`
      SELECT u.id, u.seq, u.allocation::text AS "allocation", u.state::text AS "state", u."announcementId"
      FROM load_units u
      JOIN announcements a ON a.id = u."announcementId"
      WHERE a.id = ${input.announcementId}::uuid AND a."tenantId" = ${tenantId}::uuid
        AND a.status = 'ACTIVE' AND a."deletedAt" IS NULL
        AND u.state = 'OPEN'
        AND (a."loaderTypeId" = ${loaderTypeId}::uuid OR a."loaderType2Id" = ${loaderTypeId}::uuid)
      ORDER BY u.seq
      LIMIT 1 FOR UPDATE OF u SKIP LOCKED`);
    if (rows.length === 0) throw new DomainError('NO_UNIT_AVAILABLE');
    return rows[0]!;
  }

  private async groupContains(tx: PrismaTx, membersSnapshot: Prisma.JsonValue, driverId: string): Promise<boolean> {
    if (!Array.isArray(membersSnapshot)) return false;
    return membersSnapshot.some(
      (g) => g && typeof g === 'object' && Array.isArray((g as { memberIds?: unknown }).memberIds) && (g as { memberIds: unknown[] }).memberIds.includes(driverId),
    );
  }

  // ───────────────────────── GET /driver/reservations ─────────────────────────
  async list(user: AuthUser, view: 'active' | 'history'): Promise<DriverReservationDto[]> {
    const scope = scopedDriver(user);
    const statuses = view === 'history' ? ARCHIVED_STATUSES : ACTIVE_STATUSES;
    const rows = await this.prisma.reservation.findMany({
      where: { tenantId: scope.tenantId, driverId: scope.driverId, status: { in: [...statuses] } },
      include: reservationInclude,
      orderBy: { reservedAt: 'desc' },
      take: 200,
    });
    const out: DriverReservationDto[] = [];
    for (const r of rows) out.push(await driverReservationDtoFromFull(this.db, r));
    return out;
  }

  // ───────────────────────── POST /driver/reservations/:id/cancel-request ─────────────────────────
  async cancelRequest(user: AuthUser, id: string, input: CancelRequestInput): Promise<DriverReservationDto> {
    const scope = scopedDriver(user);
    await this.prisma.$transaction(
      async (tx) => {
        const r = await tx.reservation.findFirst({ where: { id, tenantId: scope.tenantId, driverId: scope.driverId } });
        if (!r) throw new DomainError('NOT_FOUND');
        if (r.status === 'CANCEL_REQUESTED') throw new DomainError('CANCEL_PENDING');
        if (r.status !== 'RESERVED' && r.status !== 'ARRIVED') throw new DomainError('INVALID_STATE', { status: r.status });
        const upd = await tx.reservation.updateMany({
          where: { id: r.id, status: { in: ['RESERVED', 'ARRIVED'] } },
          data: { status: 'CANCEL_REQUESTED', statusBeforeCancelRequest: r.status },
        });
        if (upd.count !== 1) throw new DomainError('INVALID_STATE');
        try {
          await tx.cancelRequest.create({
            data: {
              tenantId: scope.tenantId,
              reservationId: r.id,
              driverId: scope.driverId,
              carrierId: r.carrierId,
              reason: input.reason,
              status: 'PENDING',
            },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new DomainError('CANCEL_PENDING');
          throw e;
        }
        await tx.queueEvent.create({
          data: {
            tenantId: scope.tenantId,
            hallDayId: r.hallDayId,
            carrierId: r.carrierId,
            type: 'CANCEL_REQUESTED',
            payload: { reservationId: r.id, driverId: scope.driverId, reason: input.reason } satisfies Prisma.InputJsonObject,
            actorId: user.id,
          },
        });
        await this.audit.log(
          { action: 'reservation.cancel_request', entity: 'Reservation', entityId: r.id, after: { status: 'CANCEL_REQUESTED' }, reason: input.reason, tenantId: scope.tenantId },
          tx,
        );
        await this.notifyCarrierOperators(tx, scope.tenantId, r.carrierId, 'درخواست لغو مجوز', 'راننده برای لغو یک مجوز درخواست داده است.', {
          reservationId: r.id,
          permitNo: r.permitNo,
        });
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return driverReservationDto(this.db, id);
  }

  private async notifyCarrierOperators(
    tx: PrismaTx,
    tenantId: string,
    carrierId: string,
    title: string,
    body: string,
    data: Prisma.InputJsonObject,
  ): Promise<void> {
    const operators = await tx.user.findMany({ where: { tenantId, carrierId, role: 'CARRIER_OPERATOR' }, select: { id: true } });
    if (operators.length === 0) return;
    await tx.notification.createMany({
      data: operators.map((o) => ({ tenantId, userId: o.id, type: 'CANCEL_REQUEST', title, body, data })),
    });
  }
}

export { dateOnlyIso, hasActivePenalty };
