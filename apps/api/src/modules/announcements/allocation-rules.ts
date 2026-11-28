import type {
  Absorption,
  Allocation,
  AnnouncementEditBlock,
  AnnouncementUnitCounts,
  HallCategory,
  UnitState,
} from '@cb/shared';

/**
 * Pure business rules of announcements / load units (no I/O). Unit-tested in allocation-rules.spec.ts.
 */

export interface AllocationChangeRow {
  from: Allocation;
  to: Allocation;
}

export interface UnitRuleInput {
  allocation: Allocation;
  state: UnitState;
  /** Allocation history of the unit, oldest first. */
  changes: readonly AllocationChangeRow[];
}

/** Unit states that mean a driver holds (or held) the unit — the announcement is "engaged". */
export const ENGAGED_UNIT_STATES: readonly UnitState[] = ['RESERVED', 'CONSUMED', 'HELD'];

/** Allocation the unit was created with. */
export function baseAllocation(u: Pick<UnitRuleInput, 'allocation' | 'changes'>): Allocation {
  return u.changes[0]?.from ?? u.allocation;
}

/** BR-10: a freed unit may go back to the allocation it had right before it was freed. */
export function revertTarget(u: Pick<UnitRuleInput, 'allocation' | 'changes'>): Allocation | null {
  if (u.allocation !== 'FREE') return null;
  for (let i = u.changes.length - 1; i >= 0; i -= 1) {
    const c = u.changes[i]!;
    if (c.to === 'FREE') return c.from === 'FREE' ? null : c.from;
  }
  return null;
}

export type AllocationDecision =
  | { ok: true; noop: boolean }
  | { ok: false; reason: 'UNIT_NOT_OPEN' | 'TRANSITION_NOT_ALLOWED' };

/**
 * BR-10: only an OPEN (unreserved) unit can change allocation, and only
 *   GROUP|TIMED → FREE, or FREE → the allocation it had before being freed.
 * ASSUMPTION(Q-E-3): direct GROUP ↔ TIMED changes and "promoting" a unit created as FREE are not allowed
 * (they would move load between the bulk rotation and the bag queue, which BR-10 does not describe).
 */
export function checkAllocationChange(u: UnitRuleInput, to: Allocation): AllocationDecision {
  if (u.state !== 'OPEN') return { ok: false, reason: 'UNIT_NOT_OPEN' };
  if (u.allocation === to) return { ok: true, noop: true };
  if (to === 'FREE') return { ok: true, noop: false };
  if (revertTarget(u) === to) return { ok: true, noop: false };
  return { ok: false, reason: 'TRANSITION_NOT_ALLOWED' };
}

export function allowedTargets(u: UnitRuleInput): Allocation[] {
  if (u.state !== 'OPEN') return [];
  if (u.allocation !== 'FREE') return ['FREE'];
  const back = revertTarget(u);
  return back ? [back] : [];
}

/**
 * Allocation of units at creation (US-B3 / BR-11).
 * ASSUMPTION(Q-E-1): GROUP units only in a BULK hall and TIMED units only in a BAG hall; FREE anywhere.
 */
export function resolveCreateAllocation(
  hall: { category: HallCategory; defaultAllocation: Allocation },
  requested: Allocation | undefined,
  isFreeOutsideDestinations: boolean,
): { ok: true; allocation: Allocation } | { ok: false } {
  if (isFreeOutsideDestinations) return { ok: true, allocation: 'FREE' };
  const a = requested ?? hall.defaultAllocation;
  if (a === 'GROUP' && hall.category !== 'BULK') return { ok: false };
  if (a === 'TIMED' && hall.category !== 'BAG') return { ok: false };
  return { ok: true, allocation: a };
}

/** D12 consumption of an announcement: trucks (non-cancelled units) × weightToKg. */
export function quotaKg(trucks: number, weightToKg: number): bigint {
  return BigInt(trucks) * BigInt(weightToKg);
}

export function countUnits(units: readonly { state: UnitState; n?: number }[]): AnnouncementUnitCounts {
  const c: AnnouncementUnitCounts = { total: 0, open: 0, issued: 0, held: 0, cancelled: 0 };
  for (const u of units) {
    const n = u.n ?? 1;
    if (u.state === 'CANCELLED') {
      c.cancelled += n;
      continue;
    }
    c.total += n;
    if (u.state === 'OPEN') c.open += n;
    else if (u.state === 'HELD') c.held += n;
    else c.issued += n;
  }
  return c;
}

export function absorptionOf(status: string, c: AnnouncementUnitCounts): Absorption {
  if (status === 'CANCELLED') return 'CANCELLED';
  if (c.issued === 0) return 'NONE';
  return c.issued >= c.total ? 'FULL' : 'PARTIAL';
}

/**
 * Whether the announcement may still be edited.
 * ASSUMPTION(Q-E-4): once any unit is reserved/consumed/held, or a driver chose the announcement as a bag
 * priority, NO field is editable (drivers committed to what they saw); cancel it only while nothing is engaged.
 */
export function editBlock(
  status: string,
  c: AnnouncementUnitCounts,
  priorities: number,
): AnnouncementEditBlock | null {
  if (status !== 'ACTIVE') return 'NOT_ACTIVE';
  if (c.issued + c.held > 0) return 'HAS_RESERVATIONS';
  if (priorities > 0) return 'HAS_PRIORITIES';
  return null;
}

/** ASSUMPTION(Q-E-4): cancel only an ACTIVE announcement with no reserved/consumed/held unit. */
export function canCancel(status: string, c: AnnouncementUnitCounts): boolean {
  return status === 'ACTIVE' && c.issued + c.held === 0;
}

/**
 * Units to add / cancel when truckCount changes on edit (only OPEN units may be cancelled;
 * the highest sequence numbers go first).
 */
export function planTruckCountChange(
  units: readonly { id: string; seq: number; state: UnitState }[],
  newCount: number,
): { add: number[]; cancel: string[] } {
  const live = units.filter((u) => u.state !== 'CANCELLED');
  const maxSeq = units.reduce((m, u) => Math.max(m, u.seq), 0);
  const diff = newCount - live.length;
  if (diff >= 0) return { add: Array.from({ length: diff }, (_, i) => maxSeq + i + 1), cancel: [] };
  const open = live.filter((u) => u.state === 'OPEN').sort((a, b) => b.seq - a.seq);
  if (open.length < -diff) throw new Error('not enough open units to cancel');
  return { add: [], cancel: open.slice(0, -diff).map((u) => u.id) };
}
