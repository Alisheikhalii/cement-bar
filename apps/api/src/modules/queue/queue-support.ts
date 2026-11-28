/**
 * Shared helpers for the Phase 3 queue module: advisory locks, counters, policy resolution,
 * driver eligibility, hall-day lazy status and small DTO primitives.
 */
import { createHash } from 'node:crypto';
import type {
  Announcement,
  BulkRotationState,
  BulkWindow,
  Driver,
  Hall,
  HallDay,
  Vehicle,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  bulkCarrierSettings,
  bulkPolicyParams,
  freePolicyParams,
  timedPolicyParams,
  type BulkCarrierSettings,
  type BulkPolicyParams,
  type FreePolicyParams,
  type TimedPolicyParams,
} from '@cb/shared';
import type { ErrorCode } from '@cb/shared';
import type { PrismaTx } from '../../common/prisma/prisma.service';
import { DomainError } from '../../common/errors/domain-error';
import { localDate } from '@cb/shared';

export const MS_PER_MINUTE = 60_000;

/** sha256 of a JSON-serialisable value (allocation-run input/output hashes, BR-K5). */
export function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Session-scoped transaction advisory lock (serialises writers of the same logical key). */
export async function advisoryLock(tx: PrismaTx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Reserves `count` contiguous counter values and returns them in order. Atomic upsert (SPEC §3.3). */
export async function counterRange(tx: PrismaTx, tenantId: string, name: string, count: number): Promise<number[]> {
  if (count <= 0) return [];
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO counters ("tenantId", name, value) VALUES (${tenantId}::uuid, ${name}, ${count})
    ON CONFLICT ("tenantId", name) DO UPDATE SET value = counters.value + ${count}
    RETURNING value`;
  const end = rows[0]!.value;
  return Array.from({ length: count }, (_, i) => end - count + 1 + i);
}

export const dateOnlyIso = (d: Date): string => d.toISOString().slice(0, 10);
export const isoToDbDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** BR-01: the driver's loader type matches the announcement's loader group (primary or secondary). */
export function loaderGroupMatches(
  a: { loaderTypeId: string; loaderType2Id: string | null },
  loaderTypeId: string,
): boolean {
  return a.loaderTypeId === loaderTypeId || a.loaderType2Id === loaderTypeId;
}

export type EligibilityError = Extract<
  ErrorCode,
  'DRIVER_NOT_APPROVED' | 'DRIVER_BLOCKED' | 'DRIVER_PENALIZED' | 'DOCUMENTS_EXPIRED'
>;

/**
 * Static eligibility (BR-02/BR-03): approval status, an active vehicle, and document expiry when the
 * hall policy requires valid documents. Penalty is checked separately (it depends on `now`).
 */
export function eligibilityError(
  driver: Pick<Driver, 'status' | 'healthCardExpiry'>,
  vehicle: Pick<Vehicle, 'smartCardExpiry' | 'inspectionExpiry'> | null,
  requireValidDocuments: boolean,
  todayIso: string,
): EligibilityError | null {
  if (driver.status === 'BLOCKED') return 'DRIVER_BLOCKED';
  if (driver.status !== 'APPROVED') return 'DRIVER_NOT_APPROVED';
  if (!vehicle) return 'DRIVER_NOT_APPROVED';
  if (requireValidDocuments) {
    const expired =
      dateOnlyIso(driver.healthCardExpiry) < todayIso ||
      dateOnlyIso(vehicle.smartCardExpiry) < todayIso ||
      dateOnlyIso(vehicle.inspectionExpiry) < todayIso;
    if (expired) return 'DOCUMENTS_EXPIRED';
  }
  return null;
}

export async function hasActivePenalty(db: PrismaTx, tenantId: string, driverId: string, now: Date): Promise<boolean> {
  const p = await db.driverPenalty.findFirst({
    where: { tenantId, driverId, until: { gt: now } },
    select: { id: true },
  });
  return p !== null;
}

// ───────── policy resolution (latest version per hall+strategy; defaults from the schemas) ─────────
async function latestParams<T>(db: PrismaTx, hallId: string, strategy: string, schema: { parse: (v: unknown) => T }): Promise<T> {
  const row = await db.queuePolicy.findFirst({
    where: { hallId, strategy: strategy as never },
    orderBy: { version: 'desc' },
    select: { params: true },
  });
  return schema.parse(row?.params ?? {});
}

export const timedPolicy = (db: PrismaTx, hallId: string): Promise<TimedPolicyParams> =>
  latestParams(db, hallId, 'TIMED_PRIORITY_RESERVATION', timedPolicyParams);
export const bulkPolicy = (db: PrismaTx, hallId: string): Promise<BulkPolicyParams> =>
  latestParams(db, hallId, 'BULK_GROUP_ROTATION', bulkPolicyParams);
export const freePolicy = (db: PrismaTx, hallId: string): Promise<FreePolicyParams> =>
  latestParams(db, hallId, 'FREE_FIRST_COME', freePolicyParams);

// ───────── bulk carrier settings (BulkRotationState.settings JSON) ─────────
export interface BulkSettings extends BulkCarrierSettings {
  /** Internal: persisted free-queue round (schema has no dedicated column). */
  cursorRound: number;
  /** Internal: chosen initial head before the first scheduled day. */
  startHeadGroupId: string | null;
}

export function readBulkSettings(settings: Prisma.JsonValue | null | undefined): BulkSettings {
  const o = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
  const base = bulkCarrierSettings.parse({
    maxLoadsPerDriverPerDay: o.maxLoadsPerDriverPerDay,
    leftoverAtHallEnd: o.leftoverAtHallEnd,
  });
  return {
    ...base,
    cursorRound: typeof o.cursorRound === 'number' && o.cursorRound >= 1 ? Math.floor(o.cursorRound) : 1,
    startHeadGroupId: typeof o.startHeadGroupId === 'string' ? o.startHeadGroupId : null,
  };
}

export function writeBulkSettings(s: BulkSettings): Prisma.InputJsonObject {
  return {
    maxLoadsPerDriverPerDay: s.maxLoadsPerDriverPerDay,
    leftoverAtHallEnd: s.leftoverAtHallEnd,
    cursorRound: s.cursorRound,
    ...(s.startHeadGroupId ? { startHeadGroupId: s.startHeadGroupId } : {}),
  };
}

export function settingsOf(rotation: BulkRotationState): BulkSettings {
  return readBulkSettings(rotation.settings);
}

// ───────── hall day lazy status (never overrides HALTED/CANCELLED/CLOSED) ─────────
export async function syncHallDayStatus(tx: PrismaTx, day: HallDay, now: Date): Promise<HallDay> {
  if (day.status === 'SCHEDULED' && now >= day.t0At && now < day.hallEndAt) {
    const upd = await tx.hallDay.updateMany({ where: { id: day.id, status: 'SCHEDULED' }, data: { status: 'OPEN' } });
    if (upd.count === 1) return { ...day, status: 'OPEN' };
    // Another transaction already opened it; re-read so the caller does not see a stale status.
    return (await tx.hallDay.findUnique({ where: { id: day.id } })) ?? day;
  }
  if ((day.status === 'OPEN' || day.status === 'ALLOCATING') && now >= day.hallEndAt) {
    const upd = await tx.hallDay.updateMany({
      where: { id: day.id, status: { in: ['OPEN', 'ALLOCATING'] } },
      data: { status: 'CLOSED' },
    });
    if (upd.count === 1) return { ...day, status: 'CLOSED' };
    return (await tx.hallDay.findUnique({ where: { id: day.id } })) ?? day;
  }
  return day;
}

// ───────── driver context & eligibility ─────────
export interface DriverContext {
  driver: Driver;
  vehicle: Vehicle | null;
}

export async function loadDriverContext(db: PrismaTx, tenantId: string, driverId: string): Promise<DriverContext> {
  const driver = await db.driver.findFirst({ where: { id: driverId, tenantId, deletedAt: null } });
  if (!driver) throw new DomainError('NOT_FOUND');
  const vehicle = await db.vehicle.findFirst({
    where: { driverId, tenantId, active: true },
    orderBy: { createdAt: 'desc' },
  });
  return { driver, vehicle };
}

/** Static eligibility + active penalty; throws the matching DomainError (BR-02/BR-03/BR-09). */
export async function assertDriverEligible(
  db: PrismaTx,
  ctx: DriverContext,
  requireValidDocuments: boolean,
  now: Date,
): Promise<void> {
  const err = eligibilityError(ctx.driver, ctx.vehicle, requireValidDocuments, localDate(now));
  if (err) throw new DomainError(err);
  if (await hasActivePenalty(db, ctx.driver.tenantId, ctx.driver.id, now)) throw new DomainError('DRIVER_PENALIZED');
}

// ───────── small DTO primitives ─────────
export interface GroupSnapshot {
  id: string;
  memberIds: string[];
}

export function parseGroupsSnapshot(value: Prisma.JsonValue): GroupSnapshot[] {
  if (!Array.isArray(value)) return [];
  const out: GroupSnapshot[] = [];
  for (const g of value) {
    if (g && typeof g === 'object' && !Array.isArray(g)) {
      const o = g as Record<string, unknown>;
      if (typeof o.id === 'string' && Array.isArray(o.memberIds)) {
        out.push({ id: o.id, memberIds: o.memberIds.filter((x): x is string => typeof x === 'string') });
      }
    }
  }
  return out;
}

export function hallDayDto(day: HallDay) {
  return {
    id: day.id,
    date: day.date,
    status: day.status,
    t0At: day.t0At.toISOString(),
    priorityEndAt: day.priorityEndAt ? day.priorityEndAt.toISOString() : null,
    hallEndAt: day.hallEndAt.toISOString(),
    haltedReason: day.haltedReason,
  };
}

export interface WindowLike {
  id: string;
  seq: number;
  kind: 'HEAD' | 'FREE';
  round: number;
  groupId: string;
  eligible: string[];
  opensAt: Date;
  closesAt: Date;
  closedAt: Date | null;
  closeReason: BulkWindow['closeReason'];
  burned: string[];
  carried: string[];
  skipped: string[];
}

export function bulkWindowDto(w: WindowLike, groupTitle: string, reservedCount: number) {
  return {
    id: w.id,
    seq: w.seq,
    kind: w.kind,
    round: w.round,
    groupId: w.groupId,
    groupTitle,
    eligibleCount: w.eligible.length,
    reservedCount,
    burnedCount: w.burned.length,
    carriedCount: w.carried.length,
    skippedCount: w.skipped.length,
    opensAt: w.opensAt.toISOString(),
    closesAt: w.closesAt.toISOString(),
    closedAt: w.closedAt ? w.closedAt.toISOString() : null,
    closeReason: w.closeReason,
  };
}

export function titleOfAnnouncement(a: Pick<Announcement, 'number'> & { description?: string }): string {
  return a.description ?? `اعلام بار ${a.number}`;
}

/** A hall's bulk/live anchor: the first BULK hall of the tenant (v1 seeds exactly two halls). */
export async function firstBulkHall(tx: PrismaTx, tenantId: string): Promise<Hall | null> {
  return tx.hall.findFirst({
    where: { tenantId, category: 'BULK', active: true },
    orderBy: { createdAt: 'asc' },
  });
}
