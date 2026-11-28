/**
 * Carrier bulk management (US-B6/B7, BR-F1/F13): groups, membership, rotation settings, start-head,
 * live view, emergency halt and manual window close. All carrier identity comes from the session.
 */
import { Injectable } from '@nestjs/common';
import type { BulkDay, BulkRotationState, BulkWindow, Hall, HallDay, Prisma } from '@prisma/client';
import { initialBulkCursor } from '@cb/engine';
import {
  addDaysIso,
  localDate,
  type BulkGroupCreateInput,
  type BulkGroupMembersInput,
  type BulkGroupReorderInput,
  type BulkGroupUpdateInput,
  type BulkSettingsInput,
  type BulkStartHeadInput,
  type CarrierBulkGroupDriverDto,
  type CarrierBulkGroupDto,
  type CarrierBulkLiveDto,
  type CarrierBulkSettingsDto,
} from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedCarrier, type CarrierScope } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService, TX_TIMEOUT_MS, type PrismaTx } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { QueueEngineService } from './queue-engine.service';
import {
  bulkPolicy,
  bulkWindowDto,
  firstBulkHall,
  hallDayDto,
  isoToDbDate,
  parseGroupsSnapshot,
  readBulkSettings,
  syncHallDayStatus,
  writeBulkSettings,
  type BulkSettings,
  type WindowLike,
} from './queue-support';

@Injectable()
export class CarrierBulkService {
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

  // ───────────────────────── groups ─────────────────────────
  async groups(user: AuthUser): Promise<CarrierBulkGroupDto[]> {
    const scope = scopedCarrier(user);
    const today = localDate(this.clock.now());
    const groups = await this.prisma.bulkGroup.findMany({
      where: { tenantId: scope.tenantId, carrierId: scope.carrierId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return this.toGroupDtos(scope, groups.map((g) => ({ id: g.id, title: g.title, sortOrder: g.sortOrder, active: g.active })), today);
  }

  private async toGroupDtos(
    scope: CarrierScope,
    groups: { id: string; title: string; sortOrder: number; active: boolean }[],
    today: string,
  ): Promise<CarrierBulkGroupDto[]> {
    if (groups.length === 0) return [];
    const dayDate = isoToDbDate(today);
    const members = await this.prisma.bulkGroupMember.findMany({
      where: {
        groupId: { in: groups.map((g) => g.id) },
        tenantId: scope.tenantId,
        effectiveFrom: { lte: dayDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: dayDate } }],
      },
      orderBy: { createdAt: 'asc' },
      include: {
        driver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            vehicles: { where: { active: true }, take: 1, select: { plate: true, loaderTypeId: true } },
          },
        },
      },
    });
    const loaderIds = [...new Set(members.flatMap((m) => m.driver.vehicles.map((v) => v.loaderTypeId)))];
    const loaders = loaderIds.length
      ? await this.prisma.loaderType.findMany({ where: { id: { in: loaderIds } }, select: { id: true, title: true } })
      : [];
    const loaderTitle = new Map(loaders.map((l) => [l.id, l.title]));
    const byGroup = new Map<string, CarrierBulkGroupDriverDto[]>();
    for (const m of members) {
      const v = m.driver.vehicles[0];
      const list = byGroup.get(m.groupId) ?? [];
      list.push({
        driverId: m.driver.id,
        firstName: m.driver.firstName,
        lastName: m.driver.lastName,
        plate: v?.plate ?? null,
        loaderTitle: v ? (loaderTitle.get(v.loaderTypeId) ?? null) : null,
      });
      byGroup.set(m.groupId, list);
    }
    return groups.map((g) => {
      const list = byGroup.get(g.id) ?? [];
      return { id: g.id, title: g.title, sortOrder: g.sortOrder, active: g.active, memberCount: list.length, members: list };
    });
  }

  async createGroup(user: AuthUser, input: BulkGroupCreateInput): Promise<CarrierBulkGroupDto> {
    const scope = scopedCarrier(user);
    const hall = await firstBulkHall(this.db, scope.tenantId);
    if (!hall) throw new DomainError('NOT_FOUND');
    const group = await this.prisma.$transaction(
      async (tx) => {
        const max = await tx.bulkGroup.aggregate({ where: { tenantId: scope.tenantId, carrierId: scope.carrierId, hallId: hall.id }, _max: { sortOrder: true } });
        const g = await tx.bulkGroup.create({
          data: {
            tenantId: scope.tenantId,
            carrierId: scope.carrierId,
            hallId: hall.id,
            title: input.title,
            sortOrder: (max._max.sortOrder ?? -1) + 1,
            createdBy: user.id,
          },
        });
        await this.event(tx, scope, null, 'GROUP_CREATED', { groupId: g.id, title: g.title }, user.id);
        await this.audit.log({ action: 'bulk_group.create', entity: 'BulkGroup', entityId: g.id, after: { title: g.title }, tenantId: scope.tenantId }, tx);
        return g;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    const [dto] = await this.toGroupDtos(scope, [{ id: group.id, title: group.title, sortOrder: group.sortOrder, active: group.active }], localDate(this.clock.now()));
    return dto!;
  }

  async updateGroup(user: AuthUser, id: string, input: BulkGroupUpdateInput): Promise<CarrierBulkGroupDto> {
    const scope = scopedCarrier(user);
    const today = localDate(this.clock.now());
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const before = await tx.bulkGroup.findFirst({ where: { id, tenantId: scope.tenantId, carrierId: scope.carrierId, deletedAt: null } });
        if (!before) throw new DomainError('NOT_FOUND');
        const data: Prisma.BulkGroupUpdateInput = {};
        if (input.title !== undefined) data.title = input.title;
        if (input.active !== undefined) data.active = input.active;
        const after = await tx.bulkGroup.update({ where: { id }, data });
        if (input.active === false) {
          await this.closeMemberships(tx, id, today);
          await this.moveCursorOff(tx, scope, before.hallId, before.id);
        }
        await this.event(tx, scope, before.hallId, 'GROUP_UPDATED', { groupId: id, before: { title: before.title, active: before.active }, after: { title: after.title, active: after.active } }, user.id);
        await this.audit.log(
          { action: 'bulk_group.update', entity: 'BulkGroup', entityId: id, before: { title: before.title, active: before.active }, after: { title: after.title, active: after.active }, reason: input.reason ?? null, tenantId: scope.tenantId },
          tx,
        );
        return after;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    const [dto] = await this.toGroupDtos(scope, [{ id: updated.id, title: updated.title, sortOrder: updated.sortOrder, active: updated.active }], today);
    return dto!;
  }

  async deleteGroup(user: AuthUser, id: string): Promise<{ id: string }> {
    const scope = scopedCarrier(user);
    await this.prisma.$transaction(
      async (tx) => {
        const before = await tx.bulkGroup.findFirst({ where: { id, tenantId: scope.tenantId, carrierId: scope.carrierId, deletedAt: null } });
        if (!before) throw new DomainError('NOT_FOUND');
        await tx.bulkGroup.update({ where: { id }, data: { deletedAt: this.clock.now(), active: false } });
        await this.closeMemberships(tx, id, localDate(this.clock.now()));
        await this.moveCursorOff(tx, scope, before.hallId, before.id);
        await this.event(tx, scope, before.hallId, 'GROUP_DELETED', { groupId: id, title: before.title }, user.id);
        await this.audit.log({ action: 'bulk_group.delete', entity: 'BulkGroup', entityId: id, before: { title: before.title }, tenantId: scope.tenantId }, tx);
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return { id };
  }

  async reorderGroups(user: AuthUser, input: BulkGroupReorderInput): Promise<CarrierBulkGroupDto[]> {
    const scope = scopedCarrier(user);
    const today = localDate(this.clock.now());
    await this.prisma.$transaction(
      async (tx) => {
        const own = await tx.bulkGroup.findMany({ where: { tenantId: scope.tenantId, carrierId: scope.carrierId, deletedAt: null }, select: { id: true } });
        const ownIds = new Set(own.map((g) => g.id));
        if (input.ids.some((id) => !ownIds.has(id)) || new Set(input.ids).size !== input.ids.length) {
          throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'ids', message: 'unknown/duplicate group' }] });
        }
        for (const [i, id] of input.ids.entries()) await tx.bulkGroup.update({ where: { id }, data: { sortOrder: i } });
        await this.event(tx, scope, null, 'GROUP_REORDERED', { ids: input.ids }, user.id);
        await this.audit.log({ action: 'bulk_group.reorder', entity: 'BulkCarrierOperator', entityId: scope.carrierId, after: { ids: input.ids }, tenantId: scope.tenantId }, tx);
      },
      { timeout: TX_TIMEOUT_MS },
    );
    const groups = await this.prisma.bulkGroup.findMany({
      where: { tenantId: scope.tenantId, carrierId: scope.carrierId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }],
    });
    return this.toGroupDtos(scope, groups.map((g) => ({ id: g.id, title: g.title, sortOrder: g.sortOrder, active: g.active })), today);
  }

  /** Replaces a group's membership atomically, honouring "effective next day unless applyNow". */
  async setMembers(user: AuthUser, id: string, input: BulkGroupMembersInput): Promise<CarrierBulkGroupDto> {
    const scope = scopedCarrier(user);
    const now = this.clock.now();
    const today = localDate(now);
    const effIso = input.applyNow ? today : addDaysIso(today, 1);
    const effDate = isoToDbDate(effIso);
    const target = [...new Set(input.driverIds)];

    if (input.applyNow && !input.reason) {
      throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'reason', message: 'applyNow requires a reason' }] });
    }
    if (target.length) {
      const valid = await this.prisma.driver.count({
        where: { id: { in: target }, tenantId: scope.tenantId, carrierId: scope.carrierId, status: 'APPROVED', deletedAt: null },
      });
      if (valid !== target.length) throw new DomainError('INVALID_STATE', { reason: 'DRIVER_NOT_APPROVED_OR_FOREIGN' });
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          const group = await tx.bulkGroup.findFirst({ where: { id, tenantId: scope.tenantId, carrierId: scope.carrierId, deletedAt: null } });
          if (!group) throw new DomainError('NOT_FOUND');
          const todayDate = isoToDbDate(today);
          const currentRows = await tx.bulkGroupMember.findMany({
            where: { groupId: id, effectiveFrom: { lte: todayDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: todayDate } }] },
            select: { driverId: true },
          });
          const current = new Set(currentRows.map((r) => r.driverId));
          const targetSet = new Set(target);
          const removed = [...current].filter((d) => !targetSet.has(d));

          // Close this group's rows that are no longer wanted (effective at effDate).
          if (removed.length) {
            await tx.bulkGroupMember.updateMany({
              where: { groupId: id, driverId: { in: removed }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: effDate } }] },
              data: { effectiveTo: effDate },
            });
          }
          if (target.length) {
            // Close overlapping memberships in other groups and drop future planned ones.
            await tx.bulkGroupMember.updateMany({
              where: { driverId: { in: target }, groupId: { not: id }, effectiveFrom: { lt: effDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: effDate } }] },
              data: { effectiveTo: effDate },
            });
            await tx.bulkGroupMember.deleteMany({ where: { driverId: { in: target }, groupId: { not: id }, effectiveFrom: { gte: effDate } } });

            const have = await tx.bulkGroupMember.findMany({
              where: { groupId: id, driverId: { in: target }, effectiveFrom: { lte: effDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: effDate } }] },
              select: { driverId: true },
            });
            const haveSet = new Set(have.map((h) => h.driverId));
            const added = target.filter((d) => !haveSet.has(d));
            if (added.length) {
              await tx.bulkGroupMember.createMany({
                data: added.map((driverId) => ({
                  tenantId: scope.tenantId,
                  groupId: id,
                  driverId,
                  effectiveFrom: effDate,
                  reason: input.reason ?? null,
                  createdBy: user.id,
                })),
              });
              await this.event(tx, scope, group.hallId, 'GROUP_MEMBERS_CHANGED', { groupId: id, added, effectiveFrom: effIso, applyNow: !!input.applyNow }, user.id);
            }
          }
          if (removed.length) {
            await this.event(tx, scope, group.hallId, 'GROUP_MEMBERS_CHANGED', { groupId: id, removed, effectiveFrom: effIso, applyNow: !!input.applyNow }, user.id);
          }
          await this.audit.log(
            {
              action: 'bulk_group.members',
              entity: 'BulkGroup',
              entityId: id,
              before: { members: [...current] },
              after: { members: target, effectiveFrom: effIso },
              reason: input.reason ?? null,
              tenantId: scope.tenantId,
            },
            tx,
          );
        },
        { timeout: TX_TIMEOUT_MS },
      );
    } catch (e) {
      if (isExclusionViolation(e)) throw new DomainError('INVALID_STATE', { reason: 'MEMBERSHIP_OVERLAP' });
      throw e;
    }
    const g = await this.prisma.bulkGroup.findUniqueOrThrow({ where: { id } });
    const [full] = await this.toGroupDtos(scope, [{ id: g.id, title: g.title, sortOrder: g.sortOrder, active: g.active }], today);
    return full!;
  }

  /** Ends a group's current memberships tomorrow (freeing drivers to join another group). */
  private async closeMemberships(tx: PrismaTx, groupId: string, today: string): Promise<void> {
    const end = isoToDbDate(addDaysIso(today, 1));
    await tx.bulkGroupMember.updateMany({
      where: { groupId, OR: [{ effectiveTo: null }, { effectiveTo: { gt: end } }] },
      data: { effectiveTo: end },
    });
  }

  private async moveCursorOff(tx: PrismaTx, scope: CarrierScope, hallId: string, groupId: string): Promise<void> {
    const rotation = await tx.bulkRotationState.findUnique({ where: { carrierId_hallId: { carrierId: scope.carrierId, hallId } } });
    if (!rotation) return;
    const active = await tx.bulkGroup.findMany({
      where: { tenantId: scope.tenantId, carrierId: scope.carrierId, hallId, active: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }],
      select: { id: true },
    });
    const settings = readBulkSettings(rotation.settings);
    const nextHead =
      rotation.nextHeadGroupId === groupId ? (active.find((g) => g.id !== groupId)?.id ?? null) : rotation.nextHeadGroupId;
    let cursorGroupId = rotation.cursorGroupId;
    let cursorRemaining = rotation.cursorRemaining;
    if (cursorGroupId === groupId || !active.some((g) => g.id === cursorGroupId)) {
      const fallback = active[0]?.id ?? null;
      cursorGroupId = fallback;
      cursorRemaining = fallback ? (await tx.bulkGroupMember.findMany({ where: { groupId: fallback }, select: { driverId: true } })).map((m) => m.driverId) : [];
    }
    await tx.bulkRotationState.update({
      where: { id: rotation.id },
      data: { nextHeadGroupId: nextHead, cursorGroupId, cursorRemaining, version: { increment: 1 }, settings: writeBulkSettings(settings) },
    });
  }

  // ───────────────────────── settings ─────────────────────────
  async settings(user: AuthUser): Promise<CarrierBulkSettingsDto> {
    const scope = scopedCarrier(user);
    const hall = await firstBulkHall(this.db, scope.tenantId);
    if (!hall) throw new DomainError('NOT_FOUND');
    return this.settingsDto(scope, hall);
  }

  private async settingsDto(scope: CarrierScope, hall: Hall): Promise<CarrierBulkSettingsDto> {
    const rotation = await this.prisma.bulkRotationState.findUnique({ where: { carrierId_hallId: { carrierId: scope.carrierId, hallId: hall.id } } });
    const settings = readBulkSettings(rotation?.settings ?? null);
    const policy = await bulkPolicy(this.db, hall.id);
    return {
      maxLoadsPerDriverPerDay: settings.maxLoadsPerDriverPerDay,
      leftoverAtHallEnd: settings.leftoverAtHallEnd,
      startHeadGroupId: rotation?.nextHeadGroupId ?? settings.startHeadGroupId ?? null,
      headMinutes: policy.headMinutes,
      freeMinutes: policy.freeMinutes,
    };
  }

  async updateSettings(user: AuthUser, input: BulkSettingsInput): Promise<CarrierBulkSettingsDto> {
    const scope = scopedCarrier(user);
    const hall = await firstBulkHall(this.db, scope.tenantId);
    if (!hall) throw new DomainError('NOT_FOUND');
    await this.prisma.$transaction(
      async (tx) => {
        const rotation = await this.ensureRotation(tx, scope, hall);
        const current = readBulkSettings(rotation.settings);
        const next: BulkSettings = {
          ...current,
          maxLoadsPerDriverPerDay: input.maxLoadsPerDriverPerDay ?? current.maxLoadsPerDriverPerDay,
          leftoverAtHallEnd: input.leftoverAtHallEnd ?? current.leftoverAtHallEnd,
        };
        await tx.bulkRotationState.update({ where: { id: rotation.id }, data: { settings: writeBulkSettings(next), version: { increment: 1 } } });
        await this.event(tx, scope, hall.id, 'BULK_SETTINGS_CHANGED', { before: toSettingsSnapshot(current), after: toSettingsSnapshot(next) }, user.id);
        await this.audit.log(
          { action: 'bulk_settings.update', entity: 'BulkRotationState', entityId: rotation.id, before: toSettingsSnapshot(current), after: toSettingsSnapshot(next), tenantId: scope.tenantId },
          tx,
        );
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return this.settingsDto(scope, hall);
  }

  async startHead(user: AuthUser, input: BulkStartHeadInput): Promise<CarrierBulkSettingsDto> {
    const scope = scopedCarrier(user);
    const hall = await firstBulkHall(this.db, scope.tenantId);
    if (!hall) throw new DomainError('NOT_FOUND');
    await this.prisma.$transaction(
      async (tx) => {
        const anyDay = await tx.bulkDay.findFirst({ where: { tenantId: scope.tenantId, carrierId: scope.carrierId } });
        if (anyDay) throw new DomainError('INVALID_STATE', { reason: 'ROTATION_ALREADY_STARTED' });
        const group = await tx.bulkGroup.findFirst({ where: { id: input.headGroupId, tenantId: scope.tenantId, carrierId: scope.carrierId, hallId: hall.id, deletedAt: null } });
        if (!group) throw new DomainError('NOT_FOUND');
        const rotation = await this.ensureRotation(tx, scope, hall);
        const active = await tx.bulkGroup.findMany({
          where: { tenantId: scope.tenantId, carrierId: scope.carrierId, hallId: hall.id, active: true, deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }],
          include: { members: { select: { driverId: true } } },
        });
        const groups = active.map((g) => ({ id: g.id, memberIds: g.members.map((m) => m.driverId) }));
        const cursor = initialBulkCursor(groups, group.id);
        const settings = readBulkSettings(rotation.settings);
        await tx.bulkRotationState.update({
          where: { id: rotation.id },
          data: {
            nextHeadGroupId: group.id,
            cursorGroupId: cursor.groupId,
            cursorRemaining: [...cursor.remaining],
            cursorInitialized: true,
            settings: writeBulkSettings({ ...settings, cursorRound: cursor.round, startHeadGroupId: group.id }),
            version: { increment: 1 },
          },
        });
        await this.event(tx, scope, hall.id, 'HEAD_SET', { headGroupId: group.id, reason: input.reason ?? null }, user.id);
        await this.audit.log({ action: 'bulk.start_head', entity: 'BulkRotationState', entityId: rotation.id, after: { headGroupId: group.id }, reason: input.reason ?? null, tenantId: scope.tenantId }, tx);
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return this.settingsDto(scope, hall);
  }

  private async ensureRotation(tx: PrismaTx, scope: CarrierScope, hall: Hall): Promise<BulkRotationState> {
    const found = await tx.bulkRotationState.findUnique({ where: { carrierId_hallId: { carrierId: scope.carrierId, hallId: hall.id } } });
    if (found) return found;
    return tx.bulkRotationState.create({
      data: {
        tenantId: scope.tenantId,
        carrierId: scope.carrierId,
        hallId: hall.id,
        cursorRemaining: [],
        settings: writeBulkSettings({ maxLoadsPerDriverPerDay: 2, leftoverAtHallEnd: 'CARRY', cursorRound: 1, startHeadGroupId: null }),
      },
    });
  }

  // ───────────────────────── live / halt / close ─────────────────────────
  async live(user: AuthUser): Promise<CarrierBulkLiveDto> {
    const scope = scopedCarrier(user);
    const now = this.clock.now();
    const today = localDate(now);
    const hall = await firstBulkHall(this.db, scope.tenantId);
    if (!hall) throw new DomainError('NOT_FOUND');
    let day = await this.prisma.hallDay.findUnique({ where: { hallId_date: { hallId: hall.id, date: today } } });
    if (day) {
      day = await syncHallDayStatus(this.db, day, now);
      let events: Awaited<ReturnType<QueueEngineService['advanceBulkTx']>> = [];
      await this.prisma.$transaction(
        async (tx) => {
          const fresh = await tx.hallDay.findUniqueOrThrow({ where: { id: day!.id } });
          events = await this.engine.advanceBulkTx(tx, scope.carrierId, fresh, now);
        },
        { timeout: TX_TIMEOUT_MS },
      );
      await this.publisher.publishAll(events);
      day = await this.prisma.hallDay.findUnique({ where: { id: day.id } });
    }
    return this.buildLive(scope, hall, day, now);
  }

  private async buildLive(scope: CarrierScope, hall: Hall, day: HallDay | null, now: Date): Promise<CarrierBulkLiveDto> {
    const settings = await this.settingsDto(scope, hall);
    const rotation = await this.prisma.bulkRotationState.findUnique({ where: { carrierId_hallId: { carrierId: scope.carrierId, hallId: hall.id } } });
    const bulkDay = day
      ? await this.prisma.bulkDay.findUnique({ where: { carrierId_hallDayId: { carrierId: scope.carrierId, hallDayId: day.id } } })
      : null;
    const groups = bulkDay ? parseGroupsSnapshot(bulkDay.membersSnapshot) : [];
    const groupRows = groups.length
      ? await this.prisma.bulkGroup.findMany({ where: { id: { in: groups.map((g) => g.id) } }, select: { id: true, title: true } })
      : [];
    const titles = new Map(groupRows.map((g) => [g.id, g.title]));
    const windows = bulkDay
      ? await this.prisma.bulkWindow.findMany({ where: { bulkDayId: bulkDay.id }, orderBy: { seq: 'asc' } })
      : [];
    const reservedCounts = await this.reservedCounts(windows.map((w) => w.id));
    const recent = windows.slice(-20).map((w) => bulkWindowDto(w as WindowLike, titles.get(w.groupId) ?? '', reservedCounts.get(w.id) ?? 0));
    const openWindow = windows.find((w) => w.closedAt === null) ?? null;
    const eligibleDrivers = openWindow ? await this.driverDtos(scope, openWindow.eligible) : [];
    const activeWindow = openWindow
      ? { ...bulkWindowDto(openWindow as WindowLike, titles.get(openWindow.groupId) ?? '', reservedCounts.get(openWindow.id) ?? 0), eligibleDrivers }
      : null;
    const cursorRemaining = rotation?.cursorRemaining.length ?? 0;
    return {
      serverTime: now.toISOString(),
      hall: { id: hall.id, title: hall.title },
      day: day ? hallDayDto(day) : null,
      headGroup: bulkDay ? { id: bulkDay.headGroupId, title: titles.get(bulkDay.headGroupId) ?? '' } : null,
      cursor: rotation?.cursorGroupId
        ? { groupId: rotation.cursorGroupId, groupTitle: titles.get(rotation.cursorGroupId) ?? '', remainingCount: cursorRemaining, round: readBulkSettings(rotation.settings).cursorRound }
        : null,
      halted: day?.status === 'HALTED' || bulkDay?.status === 'HALTED',
      haltedReason: bulkDay?.haltedReason ?? day?.haltedReason ?? null,
      activeWindow,
      recentWindows: recent,
      settings,
    };
  }

  async halt(user: AuthUser, reason: string): Promise<CarrierBulkLiveDto> {
    const scope = scopedCarrier(user);
    const now = this.clock.now();
    const today = localDate(now);
    const hall = await firstBulkHall(this.db, scope.tenantId);
    if (!hall) throw new DomainError('NOT_FOUND');
    await this.prisma.$transaction(
      async (tx) => {
        const raw = await tx.hallDay.findUnique({ where: { hallId_date: { hallId: hall.id, date: today } } });
        if (!raw) throw new DomainError('INVALID_STATE', { reason: 'NO_HALL_DAY' });
        const day = await syncHallDayStatus(tx, raw, now);
        const bulkDay = await this.engine.ensureBulkDayTx(tx, scope.carrierId, day, now);
        if (!bulkDay) throw new DomainError('INVALID_STATE', { reason: 'NO_BULK_DAY' });
        const open = await tx.bulkWindow.findFirst({ where: { bulkDayId: bulkDay.id, closedAt: null }, orderBy: { seq: 'desc' } });
        if (open) {
          const reserved = new Set(
            (await tx.reservation.findMany({ where: { bulkWindowId: open.id, status: { not: 'CANCELLED' } }, select: { driverId: true } })).map((r) => r.driverId),
          );
          const carried = open.eligible.filter((d) => !reserved.has(d));
          await tx.bulkWindow.updateMany({
            where: { id: open.id, closedAt: null },
            data: { closedAt: now, closeReason: 'HALTED', burned: [], skipped: [], carried },
          });
          await this.event(tx, scope, hall.id, 'WINDOW_CLOSED', { windowId: open.id, seq: open.seq, reason: 'HALTED' }, user.id);
        }
        await tx.bulkDay.update({ where: { id: bulkDay.id }, data: { status: 'HALTED', haltedReason: reason } });
        await this.event(tx, scope, hall.id, 'BULK_HALTED', { bulkDayId: bulkDay.id, reason }, user.id);
        await this.audit.log({ action: 'bulk.halt', entity: 'BulkDay', entityId: bulkDay.id, before: { status: bulkDay.status }, after: { status: 'HALTED' }, reason, tenantId: scope.tenantId }, tx);
      },
      { timeout: TX_TIMEOUT_MS },
    );
    const day = await this.prisma.hallDay.findUnique({ where: { hallId_date: { hallId: hall.id, date: today } } });
    return this.buildLive(scope, hall, day, now);
  }

  async closeWindow(user: AuthUser, windowId: string, reason: string): Promise<CarrierBulkLiveDto> {
    const scope = scopedCarrier(user);
    const now = this.clock.now();
    const hall = await firstBulkHall(this.db, scope.tenantId);
    if (!hall) throw new DomainError('NOT_FOUND');
    let events: Awaited<ReturnType<QueueEngineService['advanceBulkTx']>> = [];
    await this.prisma.$transaction(
      async (tx) => {
        const window = await tx.bulkWindow.findFirst({
          where: { id: windowId, bulkDay: { is: { carrierId: scope.carrierId, tenantId: scope.tenantId } } },
          include: { bulkDay: { select: { hallDayId: true } } },
        });
        if (!window) throw new DomainError('NOT_FOUND');
        if (window.closedAt) throw new DomainError('INVALID_STATE', { reason: 'ALREADY_CLOSED' });
        const hd = await tx.hallDay.findUniqueOrThrow({ where: { id: window.bulkDay.hallDayId } });
        events = await this.engine.advanceBulkTx(tx, scope.carrierId, hd, now, { forcedCloseWindowId: windowId });
        await this.event(tx, scope, hd.hallId, 'MANUAL_CLOSE', { windowId, reason }, user.id);
        await this.audit.log({ action: 'bulk.window_close', entity: 'BulkWindow', entityId: windowId, before: { closedAt: null }, after: { closeReason: 'MANUAL' }, reason, tenantId: scope.tenantId }, tx);
      },
      { timeout: TX_TIMEOUT_MS },
    );
    await this.publisher.publishAll(events);
    const today = localDate(now);
    const day = await this.prisma.hallDay.findUnique({ where: { hallId_date: { hallId: hall.id, date: today } } });
    return this.buildLive(scope, hall, day, now);
  }

  // ───────────────────────── helpers ─────────────────────────
  private async driverDtos(scope: CarrierScope, driverIds: string[]): Promise<CarrierBulkGroupDriverDto[]> {
    if (driverIds.length === 0) return [];
    const drivers = await this.prisma.driver.findMany({
      where: { id: { in: driverIds }, tenantId: scope.tenantId },
      select: { id: true, firstName: true, lastName: true, vehicles: { where: { active: true }, take: 1, select: { plate: true, loaderTypeId: true } } },
    });
    const loaderIds = [...new Set(drivers.flatMap((d) => d.vehicles.map((v) => v.loaderTypeId)))];
    const loaders = loaderIds.length
      ? await this.prisma.loaderType.findMany({ where: { id: { in: loaderIds } }, select: { id: true, title: true } })
      : [];
    const loaderTitle = new Map(loaders.map((l) => [l.id, l.title]));
    const byId = new Map(
      drivers.map((d) => [
        d.id,
        { driverId: d.id, firstName: d.firstName, lastName: d.lastName, plate: d.vehicles[0]?.plate ?? null, loaderTitle: d.vehicles[0] ? (loaderTitle.get(d.vehicles[0].loaderTypeId) ?? null) : null },
      ]),
    );
    return driverIds.map((id) => byId.get(id)).filter((x): x is CarrierBulkGroupDriverDto => x !== undefined);
  }

  private async reservedCounts(windowIds: string[]): Promise<Map<string, number>> {
    if (windowIds.length === 0) return new Map();
    const rows = await this.prisma.reservation.groupBy({
      by: ['bulkWindowId'],
      where: { bulkWindowId: { in: windowIds }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.bulkWindowId!, r._count._all]));
  }

  private event(tx: PrismaTx, scope: CarrierScope, hallId: string | null, type: string, payload: Prisma.InputJsonObject, actorId: string): Promise<unknown> {
    return tx.queueEvent.create({
      data: { tenantId: scope.tenantId, carrierId: scope.carrierId, hallDayId: null, type, payload: { ...payload, hallId } as Prisma.InputJsonObject, actorId },
    });
  }
}

function toSettingsSnapshot(s: BulkSettings): Prisma.InputJsonObject {
  return { maxLoadsPerDriverPerDay: s.maxLoadsPerDriverPerDay, leftoverAtHallEnd: s.leftoverAtHallEnd };
}

function isExclusionViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('bulk_group_members_no_overlap') || msg.includes('23P01') || msg.includes('conflicting key value violates exclusion');
}

// keep BulkDay referenced for typing clarity across helpers
export type { BulkDay, BulkWindow };
