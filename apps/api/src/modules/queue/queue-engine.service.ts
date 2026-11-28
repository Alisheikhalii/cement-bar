/**
 * Queue engine orchestration (SPEC §3): bag allocation and the bulk rotation runner.
 *
 * Every method takes an open transaction and performs its state changes + queue_events inside it.
 * SSE events are RETURNED (never published here) so callers publish only after commit.
 */
import { Injectable } from '@nestjs/common';
import type { BulkDay, BulkWindow, Hall, HallDay } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  ENGINE_VERSION,
  allocateBag,
  initialBulkCursor,
  nextHeadGroup,
  stepBulk,
  type BagAllocateInput,
  type BulkConfig,
  type BulkCursor,
  type BulkGroup,
  type BulkOpenWindow,
  type BulkStepInput,
} from '@cb/engine';
import type { QueueSseEvent } from '@cb/shared';
import { localDate } from '@cb/shared';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import type { PrismaTx } from '../../common/prisma/prisma.service';
import {
  advisoryLock,
  bulkPolicy,
  bulkWindowDto,
  counterRange,
  dateOnlyIso,
  isoToDbDate,
  loaderGroupMatches,
  parseGroupsSnapshot,
  readBulkSettings,
  settingsOf,
  sha256,
  syncHallDayStatus,
  timedPolicy,
  writeBulkSettings,
  type GroupSnapshot,
} from './queue-support';

const MAX_ADVANCE_STEPS = 500;

const sse = (type: QueueSseEvent['type'], tenantId: string, hallId: string, payload: Record<string, unknown>): QueueSseEvent => ({
  type,
  tenantId,
  hallId,
  at: new Date().toISOString(),
  payload,
});

@Injectable()
export class QueueEngineService {
  constructor(private readonly clock: ClockService) {}

  syncHallDay(tx: PrismaTx, day: HallDay, now: Date): Promise<HallDay> {
    return syncHallDayStatus(tx, day, now);
  }

  // ═══════════════════════════ BAG ALLOCATION (SPEC §3.3, BR-K4) ═══════════════════════════
  /**
   * Runs the one-per-day idempotent bag allocation. Returns SSE events (unit.reserved) to publish
   * after commit. No-op when an allocation run already exists or the day is halted/cancelled.
   */
  async allocateBagTx(tx: PrismaTx, hallDay: HallDay, now: Date): Promise<QueueSseEvent[]> {
    const hall = await tx.hall.findUnique({ where: { id: hallDay.hallId } });
    if (!hall) throw new DomainError('NOT_FOUND');
    await advisoryLock(tx, `alloc:${hallDay.id}`);

    const existing = await tx.allocationRun.findUnique({ where: { hallDayId: hallDay.id }, select: { id: true } });
    if (existing) return [];
    if (hallDay.status === 'HALTED' || hallDay.status === 'CANCELLED') return [];

    const tenantId = hallDay.tenantId;
    const units = await tx.loadUnit.findMany({
      where: {
        state: 'OPEN',
        allocation: 'TIMED',
        tenantId,
        announcement: { is: { hallId: hall.id, status: 'ACTIVE', deletedAt: null, tenantId } },
      },
      select: {
        id: true,
        seq: true,
        announcementId: true,
        announcement: { select: { id: true, carrierId: true, loaderTypeId: true, loaderType2Id: true } },
      },
      orderBy: [{ announcementId: 'asc' }, { seq: 'asc' }],
    });
    const unitById = new Map(units.map((u) => [u.id, u]));
    const stock: Record<string, string[]> = {};
    for (const u of units) (stock[u.announcementId] ??= []).push(u.id);

    const turns = await tx.bagTurn.findMany({
      where: { hallDayId: hallDay.id, status: 'WAITING' },
      include: { priorities: { orderBy: { rank: 'asc' }, select: { announcementId: true } } },
      orderBy: { turnNo: 'asc' },
    });
    const driverIds = turns.map((t) => t.driverId);
    const vehicles = driverIds.length
      ? await tx.vehicle.findMany({
          where: { driverId: { in: driverIds }, active: true },
          select: { driverId: true, loaderTypeId: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const loaderByDriver = new Map<string, string>();
    for (const v of vehicles) if (!loaderByDriver.has(v.driverId)) loaderByDriver.set(v.driverId, v.loaderTypeId);

    // Ann-Loader index: a priority only counts when the announcement's loader group matches the driver's vehicle.
    const compat = new Map<string, { loaderTypeId: string; loaderType2Id: string | null }>();
    for (const u of units) compat.set(u.announcementId, u.announcement);

    const input: BagAllocateInput = {
      turns: turns.map((t) => {
        const loader = loaderByDriver.get(t.driverId);
        const priorities = t.priorities
          .map((p) => p.announcementId)
          .filter((annId) => {
            const a = compat.get(annId);
            return a ? loader !== undefined && loaderGroupMatches(a, loader) : false;
          });
        return { turnNo: t.turnNo, driverId: t.driverId, priorities };
      }),
      stock,
    };
    const result = allocateBag(input);

    const startedAt = now;
    const assignedDriverIds = new Set(result.assignments.map((a) => a.driverId));
    const notAllocated = new Set(result.notAllocated);
    const permitNos = await counterRange(tx, tenantId, 'permit', result.assignments.length);

    const run = await tx.allocationRun.create({
      data: {
        tenantId,
        hallDayId: hallDay.id,
        input: input as unknown as Prisma.InputJsonValue,
        output: result as unknown as Prisma.InputJsonValue,
        inputHash: sha256(input),
        outputHash: sha256(result),
        engineVersion: ENGINE_VERSION,
        startedAt,
        finishedAt: this.clock.now(),
      },
    });

    const events: QueueSseEvent[] = [];
    const allocatedByDriver = new Map<string, { reservationId: string; announcementId: string; unitId: string }>();
    for (const [i, assignment] of result.assignments.entries()) {
      const unit = unitById.get(assignment.unitId);
      if (!unit) continue;
      const reservation = await tx.reservation.create({
        data: {
          tenantId,
          permitNo: permitNos[i]!,
          unitId: assignment.unitId,
          driverId: assignment.driverId,
          carrierId: unit.announcement.carrierId,
          source: 'TIMED',
          hallDayId: hallDay.id,
          allocationRunId: run.id,
          status: 'RESERVED',
          reservedAt: now,
        },
      });
      const upd = await tx.loadUnit.updateMany({
        where: { id: assignment.unitId, state: 'OPEN' },
        data: { state: 'RESERVED', currentReservationId: reservation.id, version: { increment: 1 } },
      });
      if (upd.count !== 1) throw new DomainError('UNIT_TAKEN');
      allocatedByDriver.set(assignment.driverId, {
        reservationId: reservation.id,
        announcementId: assignment.announcementId,
        unitId: assignment.unitId,
      });
      await tx.queueEvent.create({
        data: {
          tenantId,
          hallDayId: hallDay.id,
          carrierId: unit.announcement.carrierId,
          type: 'RESERVED',
          payload: {
            reservationId: reservation.id,
            permitNo: permitNos[i]!,
            unitId: assignment.unitId,
            announcementId: assignment.announcementId,
            driverId: assignment.driverId,
            source: 'TIMED',
            rank: assignment.rank,
            allocationRunId: run.id,
          } satisfies Prisma.InputJsonObject,
        },
      });
      events.push(
        sse('unit.reserved', tenantId, hall.id, {
          announcementId: assignment.announcementId,
          unitId: assignment.unitId,
          carrierId: unit.announcement.carrierId,
          driverId: assignment.driverId,
        }),
      );
    }

    if (assignedDriverIds.size) {
      await tx.bagTurn.updateMany({
        where: { hallDayId: hallDay.id, driverId: { in: [...assignedDriverIds] }, status: 'WAITING' },
        data: { status: 'ALLOCATED' },
      });
    }
    if (notAllocated.size) {
      await tx.bagTurn.updateMany({
        where: { hallDayId: hallDay.id, driverId: { in: [...notAllocated] }, status: 'WAITING' },
        data: { status: 'NOT_ALLOCATED' },
      });
    }

    // Leftover TIMED units: policy KEEP (default) or AUTO_FREE.
    const policy = await timedPolicy(tx, hall.id);
    if (policy.leftoverAfterAllocation === 'AUTO_FREE') {
      const actorId = await this.systemActorId(tx, tenantId);
      for (const unitIds of Object.values(result.remainingStock)) {
        if (!unitIds.length) continue;
        const rows = await tx.loadUnit.findMany({
          where: { id: { in: unitIds }, allocation: 'TIMED', state: 'OPEN' },
          select: { id: true, seq: true, announcementId: true },
        });
        for (const u of rows) {
          const ann = unitById.get(u.id)!.announcement;
          await tx.loadUnit.update({
            where: { id: u.id },
            data: { allocation: 'FREE', version: { increment: 1 } },
          });
          await tx.loadUnitAllocationChange.create({
            data: { tenantId, unitId: u.id, from: 'TIMED', to: 'FREE', reason: 'leftoverAfterAllocation=AUTO_FREE', actorId },
          });
          await tx.queueEvent.create({
            data: {
              tenantId,
              hallDayId: hallDay.id,
              carrierId: ann.carrierId,
              type: 'UNIT_FREED',
              payload: { unitId: u.id, announcementId: u.announcementId, seq: u.seq, from: 'TIMED', to: 'FREE', reason: 'AUTO_FREE' },
            },
          });
        }
      }
    }

    await tx.queueEvent.create({
      data: {
        tenantId,
        hallDayId: hallDay.id,
        type: 'ALLOCATION_RUN',
        payload: {
          allocationRunId: run.id,
          assignments: result.assignments.length,
          notAllocated: result.notAllocated.length,
          engineVersion: ENGINE_VERSION,
        } satisfies Prisma.InputJsonObject,
      },
    });

    // Notify allocated drivers (US-C4).
    const allocatedIds = [...allocatedByDriver.keys()];
    if (allocatedIds.length) {
      const drivers = await tx.driver.findMany({ where: { id: { in: allocatedIds } }, select: { id: true, userId: true } });
      await tx.notification.createMany({
        data: drivers.map((d) => ({
          tenantId,
          userId: d.userId,
          type: 'BAG_ALLOCATED',
          title: 'نتیجه تخصیص بار کیسه‌ای',
          body: 'برای شما یک بار کیسه‌ای تخصیص یافت.',
          data: { hallDayId: hallDay.id, reservationId: allocatedByDriver.get(d.id)?.reservationId ?? null },
        })),
      });
    }

    const finalStatus: HallDay['status'] = now >= hallDay.hallEndAt ? 'CLOSED' : 'OPEN';
    await tx.hallDay.updateMany({
      where: { id: hallDay.id, status: { in: ['OPEN', 'ALLOCATING'] } },
      data: { status: finalStatus },
    });
    return events;
  }

  // ═══════════════════════════ BULK ROTATION (SPEC §3.4) ═══════════════════════════
  /**
   * Ensures today's `bulk_day` for (carrier, hall) when the carrier has an OPEN GROUP unit (BR-F9).
   * Snapshots groups/members, picks the head from the persisted rotation, advances `nextHeadGroupId`
   * for tomorrow, and initialises the free cursor on the first scheduled day.
   */
  async ensureBulkDayTx(tx: PrismaTx, carrierId: string, hallDay: HallDay, _now: Date): Promise<BulkDay | null> {
    const tenantId = hallDay.tenantId;
    const hall = await tx.hall.findUnique({ where: { id: hallDay.hallId } });
    if (!hall) return null;

    let rotation = await tx.bulkRotationState.findUnique({ where: { carrierId_hallId: { carrierId, hallId: hall.id } } });
    if (!rotation) {
      rotation = await tx.bulkRotationState.create({
        data: {
          tenantId,
          carrierId,
          hallId: hall.id,
          cursorRemaining: [],
          settings: writeBulkSettings({ maxLoadsPerDriverPerDay: 2, leftoverAtHallEnd: 'CARRY', cursorRound: 1, startHeadGroupId: null }),
        },
      });
    }

    const existing = await tx.bulkDay.findUnique({ where: { carrierId_hallDayId: { carrierId, hallDayId: hallDay.id } } });
    if (existing) return existing;

    const openUnits = await this.countOpenGroupUnits(tx, tenantId, carrierId, hall.id);
    if (openUnits <= 0) return null; // not a scheduled day (BR-F9)

    const groups = await this.snapshotGroups(tx, tenantId, carrierId, hall.id, hallDay.date);
    if (groups.length === 0) return null;

    const settings = readBulkSettings(rotation.settings);
    const currentHead = rotation.nextHeadGroupId;
    const headForDay =
      (currentHead && groups.some((g) => g.id === currentHead) ? currentHead : null) ??
      settings.startHeadGroupId ??
      groups[0]!.id;
    const headGroupId = groups.some((g) => g.id === headForDay) ? headForDay : groups[0]!.id;
    const nextHead = nextHeadGroup(groups, headGroupId);

    const stateBefore = {
      nextHeadGroupId: rotation.nextHeadGroupId,
      cursorGroupId: rotation.cursorGroupId,
      cursorRemaining: rotation.cursorRemaining,
      cursorRound: settings.cursorRound,
    };
    const day = await tx.bulkDay.create({
      data: {
        tenantId,
        carrierId,
        hallDayId: hallDay.id,
        headGroupId,
        membersSnapshot: groups as unknown as Prisma.InputJsonValue,
        stateBefore: stateBefore as Prisma.InputJsonObject,
        status: 'OPEN',
      },
    });

    const cursorInit = rotation.cursorInitialized
      ? null
      : initialBulkCursor(groups, headGroupId);
    await tx.bulkRotationState.update({
      where: { id: rotation.id },
      data: {
        nextHeadGroupId: nextHead,
        version: { increment: 1 },
        ...(cursorInit
          ? { cursorGroupId: cursorInit.groupId, cursorRemaining: [...cursorInit.remaining], cursorInitialized: true }
          : {}),
        settings: writeBulkSettings({ ...settings, cursorRound: cursorInit ? cursorInit.round : settings.cursorRound }),
      },
    });
    await tx.queueEvent.create({
      data: {
        tenantId,
        hallDayId: hallDay.id,
        carrierId,
        type: 'BULK_DAY_OPENED',
        payload: { bulkDayId: day.id, headGroupId, nextHeadGroupId: nextHead, groups: groups.length } satisfies Prisma.InputJsonObject,
      },
    });
    return day;
  }

  private countOpenGroupUnits(tx: PrismaTx, tenantId: string, carrierId: string, hallId: string): Promise<number> {
    return tx.loadUnit.count({
      where: {
        allocation: 'GROUP',
        state: 'OPEN',
        tenantId,
        announcement: { is: { carrierId, hallId, status: 'ACTIVE', deletedAt: null } },
      },
    });
  }

  private async snapshotGroups(
    tx: PrismaTx,
    tenantId: string,
    carrierId: string,
    hallId: string,
    dateIso: string,
  ): Promise<GroupSnapshot[]> {
    const dayDate = isoToDbDate(dateIso);
    const groups = await tx.bulkGroup.findMany({
      where: { tenantId, carrierId, hallId, active: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        members: {
          where: { effectiveFrom: { lte: dayDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: dayDate } }] },
          orderBy: { createdAt: 'asc' },
          select: { driverId: true },
        },
      },
    });
    return groups.map((g) => ({ id: g.id, memberIds: g.members.map((m) => m.driverId) }));
  }

  /**
   * Advances the carrier's rotation for one hall-day until the state machine settles. Idempotent under
   * the (carrier, hallDay) advisory lock and the unique(bulkDayId, seq) constraint (AC-5).
   */
  async advanceBulkTx(
    tx: PrismaTx,
    carrierId: string,
    hallDay: HallDay,
    now: Date,
    opts: { forcedCloseWindowId?: string } = {},
  ): Promise<QueueSseEvent[]> {
    const tenantId = hallDay.tenantId;
    const hall = await tx.hall.findUnique({ where: { id: hallDay.hallId } });
    if (!hall) return [];
    await advisoryLock(tx, `bulk:${carrierId}:${hallDay.id}`);

    const bulkDay = await this.ensureBulkDayTx(tx, carrierId, hallDay, now);
    if (!bulkDay) return [];

    const rotation = await tx.bulkRotationState.findUniqueOrThrow({ where: { carrierId_hallId: { carrierId, hallId: hall.id } } });
    const settings = settingsOf(rotation);
    const groupsRaw = parseGroupsSnapshot(bulkDay.membersSnapshot);
    const groups: BulkGroup[] = groupsRaw.map((g) => ({ id: g.id, memberIds: g.memberIds }));
    const titleRows = await tx.bulkGroup.findMany({
      where: { id: { in: groups.map((g) => g.id) } },
      select: { id: true, title: true },
    });
    const titleById = new Map(titleRows.map((g) => [g.id, g.title]));
    const policy = await bulkPolicy(tx, hall.id);
    const config: BulkConfig = {
      t0: hallDay.t0At.getTime(),
      hallEnd: hallDay.hallEndAt.getTime(),
      headMinutes: policy.headMinutes,
      freeMinutes: policy.freeMinutes,
      maxLoadsPerDriverPerDay: settings.maxLoadsPerDriverPerDay,
    };

    let bulkDayStatus = bulkDay.status;
    if (bulkDayStatus !== 'HALTED' && now >= hallDay.hallEndAt) bulkDayStatus = 'CLOSED';
    const halted = hallDay.status === 'HALTED' || bulkDayStatus === 'HALTED';

    let cursor: BulkCursor = {
      groupId: rotation.cursorGroupId,
      remaining: rotation.cursorRemaining,
      round: settings.cursorRound,
    };

    let windows = await tx.bulkWindow.findMany({ where: { bulkDayId: bulkDay.id }, orderBy: { seq: 'asc' } });
    let lastWindowSeq = windows.reduce((m, w) => Math.max(m, w.seq), 0);
    const openUnits = await this.countOpenGroupUnits(tx, tenantId, carrierId, hall.id);
    const events: QueueSseEvent[] = [];
    let idle: string | null = null;

    for (let guard = 0; guard < MAX_ADVANCE_STEPS; guard += 1) {
      const openWindow = windows.find((w) => w.closedAt === null) ?? null;
      const reservedSet = openWindow ? await this.reservedInWindow(tx, openWindow.id) : new Set<string>();
      const compatibleByDriver = await this.compatibleByDriver(tx, tenantId, carrierId, hall.id, openWindow);
      const loadsToday = await this.loadsToday(tx, tenantId, bulkDay.id);

      const input: BulkStepInput = {
        now: now.getTime(),
        groups,
        headGroupId: bulkDay.headGroupId,
        cursor,
        config,
        window: openWindow ? toOpenWindow(openWindow, reservedSet) : null,
        loadsToday,
        compatibleByDriver,
        openUnits,
        halted,
        lastWindowSeq,
        forcedClose:
          openWindow && opts.forcedCloseWindowId === openWindow.id ? { reason: 'MANUAL', at: now.getTime() } : null,
      };
      const step = stepBulk(input);

      if (step.open) {
        const plan = step.open;
        try {
          const created = await tx.bulkWindow.create({
            data: {
              tenantId,
              bulkDayId: bulkDay.id,
              seq: plan.seq,
              kind: plan.kind,
              round: plan.round,
              groupId: plan.groupId,
              eligible: [...plan.eligible],
              opensAt: new Date(plan.opensAt),
              closesAt: new Date(plan.closesAt),
            },
          });
          windows = [...windows, created];
          lastWindowSeq = created.seq;
          cursor = step.cursor;
          events.push(
            sse('window.changed', tenantId, hall.id, {
              carrierId,
              window: bulkWindowDto(created, titleById.get(created.groupId) ?? created.groupId, 0),
            }),
          );
          await tx.queueEvent.create({
            data: {
              tenantId,
              hallDayId: hallDay.id,
              carrierId,
              type: 'WINDOW_OPENED',
              payload: {
                bulkDayId: bulkDay.id,
                windowId: created.id,
                seq: created.seq,
                kind: created.kind,
                round: created.round,
                groupId: created.groupId,
                eligible: created.eligible.length,
              } satisfies Prisma.InputJsonObject,
            },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') break; // already applied
          throw e;
        }
        continue;
      }

      if (step.close && openWindow) {
        const close = step.close;
        const upd = await tx.bulkWindow.updateMany({
          where: { id: openWindow.id, closedAt: null },
          data: {
            closedAt: new Date(close.closedAt),
            closeReason: close.reason,
            burned: [...close.burned],
            carried: [...close.carried],
            skipped: [...close.skipped],
          },
        });
        if (upd.count === 0) break; // closed by a concurrent call
        cursor = step.cursor;
        windows = windows.map((w) => (w.id === openWindow.id ? { ...w, closedAt: new Date(close.closedAt), closeReason: close.reason } : w));
        await tx.queueEvent.create({
          data: {
            tenantId,
            hallDayId: hallDay.id,
            carrierId,
            type: 'WINDOW_CLOSED',
            payload: {
              bulkDayId: bulkDay.id,
              windowId: openWindow.id,
              seq: close.seq,
              reason: close.reason,
              burned: close.burned.length,
              carried: close.carried.length,
              skipped: close.skipped.length,
            } satisfies Prisma.InputJsonObject,
          },
        });
        if (close.burned.length) {
          await tx.queueEvent.createMany({
            data: close.burned.map((driverId) => ({
              tenantId,
              hallDayId: hallDay.id,
              carrierId,
              type: 'TURN_BURNED',
              payload: { bulkDayId: bulkDay.id, windowId: openWindow.id, seq: close.seq, driverId } satisfies Prisma.InputJsonObject,
            })),
          });
        }
        events.push(
          sse('window.changed', tenantId, hall.id, {
            carrierId,
            window: await this.windowDtoWithReserved(tx, { ...openWindow, closedAt: new Date(close.closedAt), closeReason: close.reason }, titleById),
          }),
        );
        continue;
      }

      idle = step.idle;
      cursor = step.cursor;
      break;
    }

    // Persist the cursor (idempotent on replay).
    await tx.bulkRotationState.update({
      where: { id: rotation.id },
      data: {
        cursorGroupId: cursor.groupId,
        cursorRemaining: [...cursor.remaining],
        settings: writeBulkSettings({ ...settings, cursorRound: cursor.round }),
        version: { increment: 1 },
      },
    });

    if (idle === 'HALL_END' && bulkDay.status !== 'CLOSED') {
      await this.closeBulkDayTx(tx, bulkDay, hall, cursor, settings, now, events);
    }
    return events;
  }

  /** HALL_END: close the bulk day, store state_after, and apply the carrier's leftover policy (BR-F11). */
  private async closeBulkDayTx(
    tx: PrismaTx,
    bulkDay: BulkDay,
    hall: Hall,
    cursor: BulkCursor,
    settings: { leftoverAtHallEnd: 'CARRY' | 'FREE' },
    now: Date,
    events: QueueSseEvent[],
  ): Promise<void> {
    const tenantId = bulkDay.tenantId;
    const rotation = await tx.bulkRotationState.findUnique({ where: { carrierId_hallId: { carrierId: bulkDay.carrierId, hallId: hall.id } } });
    const stateAfter = {
      nextHeadGroupId: rotation?.nextHeadGroupId ?? null,
      cursorGroupId: cursor.groupId,
      cursorRemaining: cursor.remaining,
      cursorRound: cursor.round,
    };
    await tx.bulkDay.updateMany({
      where: { id: bulkDay.id, status: 'OPEN' },
      data: { status: 'CLOSED', stateAfter: stateAfter as Prisma.InputJsonObject },
    });
    await tx.queueEvent.create({
      data: {
        tenantId,
        hallDayId: bulkDay.hallDayId,
        carrierId: bulkDay.carrierId,
        type: 'BULK_DAY_CLOSED',
        payload: stateAfter satisfies Prisma.InputJsonObject,
      },
    });

    if (settings.leftoverAtHallEnd === 'FREE') {
      const actorId = await this.systemActorId(tx, tenantId);
      const leftover = await tx.loadUnit.findMany({
        where: {
          allocation: 'GROUP',
          state: 'OPEN',
          tenantId,
          announcement: { is: { carrierId: bulkDay.carrierId, hallId: hall.id, status: 'ACTIVE', deletedAt: null } },
        },
        select: { id: true, seq: true, announcementId: true, announcement: { select: { carrierId: true } } },
      });
      for (const u of leftover) {
        await tx.loadUnit.update({ where: { id: u.id }, data: { allocation: 'FREE', version: { increment: 1 } } });
        await tx.loadUnitAllocationChange.create({
          data: { tenantId, unitId: u.id, from: 'GROUP', to: 'FREE', reason: 'leftoverAtHallEnd=FREE', actorId },
        });
        await tx.queueEvent.create({
          data: {
            tenantId,
            hallDayId: bulkDay.hallDayId,
            carrierId: bulkDay.carrierId,
            type: 'UNIT_FREED',
            payload: { unitId: u.id, announcementId: u.announcementId, seq: u.seq, from: 'GROUP', to: 'FREE', reason: 'HALL_END' },
          },
        });
        events.push(
          sse('unit.freed', tenantId, hall.id, {
            announcementId: u.announcementId,
            unitId: u.id,
            carrierId: u.announcement.carrierId,
          }),
        );
      }
    }
    void now;
  }

  // ───────── bulk input helpers ─────────
  /** System actor for automatic conversions (allocation changes require actorId; no FK on the column). */
  private async systemActorId(tx: PrismaTx, tenantId: string): Promise<string> {
    const factory = await tx.user.findFirst({ where: { tenantId, role: 'FACTORY_OPERATOR' }, select: { id: true } });
    return factory?.id ?? '00000000-0000-0000-0000-000000000000';
  }

  private async reservedInWindow(tx: PrismaTx, windowId: string): Promise<Set<string>> {
    const rows = await tx.reservation.findMany({
      where: { bulkWindowId: windowId, status: { not: 'CANCELLED' } },
      select: { driverId: true },
    });
    return new Set(rows.map((r) => r.driverId));
  }

  private async loadsToday(tx: PrismaTx, tenantId: string, bulkDayId: string): Promise<Record<string, number>> {
    const rows = await tx.reservation.findMany({
      where: { tenantId, status: { not: 'CANCELLED' }, bulkWindow: { is: { bulkDayId } } },
      select: { driverId: true },
    });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.driverId] = (counts[r.driverId] ?? 0) + 1;
    return counts;
  }

  private async compatibleByDriver(
    tx: PrismaTx,
    tenantId: string,
    carrierId: string,
    hallId: string,
    window: BulkWindow | null,
  ): Promise<Record<string, number>> {
    if (!window || window.eligible.length === 0) return {};
    // Only units that could have been taken DURING this window count towards "burned" (BR-F5c): a GROUP
    // load published after the window closed must leave the eligible members `skipped`, not burned.
    const units = await tx.loadUnit.findMany({
      where: {
        allocation: 'GROUP',
        state: 'OPEN',
        tenantId,
        createdAt: { lte: window.closesAt },
        announcement: { is: { carrierId, hallId, status: 'ACTIVE', deletedAt: null } },
      },
      select: { announcement: { select: { loaderTypeId: true, loaderType2Id: true } } },
    });
    const perLoader = new Map<string, number>();
    for (const u of units) {
      perLoader.set(u.announcement.loaderTypeId, (perLoader.get(u.announcement.loaderTypeId) ?? 0) + 1);
      if (u.announcement.loaderType2Id) {
        perLoader.set(u.announcement.loaderType2Id, (perLoader.get(u.announcement.loaderType2Id) ?? 0) + 1);
      }
    }
    const vehicles = await tx.vehicle.findMany({
      where: { driverId: { in: [...window.eligible] }, active: true },
      select: { driverId: true, loaderTypeId: true },
      orderBy: { createdAt: 'desc' },
    });
    const loaderByDriver = new Map<string, string>();
    for (const v of vehicles) if (!loaderByDriver.has(v.driverId)) loaderByDriver.set(v.driverId, v.loaderTypeId);
    const out: Record<string, number> = {};
    for (const driverId of window.eligible) {
      const loader = loaderByDriver.get(driverId);
      out[driverId] = await Promise.resolve(loader ? (perLoader.get(loader) ?? 0) : 0);
    }
    return out;
  }

  private async windowDtoWithReserved(tx: PrismaTx, w: BulkWindow, titles: Map<string, string>) {
    const reserved = await tx.reservation.count({ where: { bulkWindowId: w.id, status: { not: 'CANCELLED' } } });
    return bulkWindowDto(w, titles.get(w.groupId) ?? w.groupId, reserved);
  }

}

function toOpenWindow(w: BulkWindow, reserved: Set<string>): BulkOpenWindow {
  return {
    seq: w.seq,
    kind: w.kind,
    round: w.round,
    groupId: w.groupId,
    eligible: w.eligible,
    opensAt: w.opensAt.getTime(),
    closesAt: w.closesAt.getTime(),
    reserved: [...reserved],
  };
}

// re-export helpers used across services
export { dateOnlyIso };
export const localDateOf = (d: Date): string => localDate(d);
