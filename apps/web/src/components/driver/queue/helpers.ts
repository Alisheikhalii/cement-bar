import {
  type Allocation,
  type BagTurnStatus,
  type DriverLoadDto,
  type ReservationStatus,
} from '@cb/shared';
import type { Tone } from '@cb/ui';
import { matchesQuery } from '../format';

export const MAX_PRIORITIES = 3;

export const TURN_TONE: Record<BagTurnStatus, Tone> = {
  WAITING: 'info',
  ALLOCATED: 'success',
  NOT_ALLOCATED: 'warning',
  CANCELLED: 'neutral',
};

export const RESERVATION_TONE: Record<ReservationStatus, Tone> = {
  RESERVED: 'info',
  ARRIVED: 'primary',
  LOADED: 'purple',
  EXITED: 'success',
  CANCEL_REQUESTED: 'warning',
  CANCELLED: 'danger',
  NO_SHOW: 'danger',
  RETURNED: 'neutral',
};

export const ALLOCATION_TONE: Record<Allocation, Tone> = {
  TIMED: 'primary',
  GROUP: 'purple',
  FREE: 'info',
};

/** Add an announcement to the priority draft (max 3); adding an existing id removes it. */
export function togglePriority(ids: readonly string[], id: string, max = MAX_PRIORITIES): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  if (ids.length >= max) return [...ids];
  return [...ids, id];
}

/** Move one priority one slot up (`delta = -1`) or down (`delta = 1`); out-of-range is a no-op. */
export function movePriority(ids: readonly string[], index: number, delta: -1 | 1): string[] {
  const next = [...ids];
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  const a = next[index];
  const b = next[target];
  if (a === undefined || b === undefined) return next;
  next[index] = b;
  next[target] = a;
  return next;
}

export function filterTurnsByStatus<T extends { status: BagTurnStatus }>(
  turns: readonly T[],
  status: BagTurnStatus | 'ALL',
): T[] {
  return status === 'ALL' ? [...turns] : turns.filter((t) => t.status === status);
}

export interface LoadFilter {
  allocation: Allocation | 'ALL';
  q: string;
}

/** Client-side refinement of the city-scoped load list (allocation + free-text search). */
export function filterLoads(loads: readonly DriverLoadDto[], filter: LoadFilter): DriverLoadDto[] {
  const q = filter.q.trim();
  return loads.filter((l) => {
    if (filter.allocation !== 'ALL' && l.allocation !== filter.allocation) return false;
    if (q === '') return true;
    return [
      l.destinationTitle,
      l.originTitle,
      l.carrierName,
      l.productTitle,
      l.packagingTitle,
      l.loaderTitles.join(' '),
      String(l.number),
    ].some((text) => matchesQuery(text, q));
  });
}

export type LoadStatusKind = 'MINE' | 'FULL' | 'ALLOCATION';

/** Which badge a load card shows (my reservation wins over the allocation label). */
export function loadStatus(load: DriverLoadDto): { kind: LoadStatusKind; allocation: Allocation; tone: Tone } {
  if (load.myReservedUnitId) return { kind: 'MINE', allocation: load.allocation, tone: 'success' };
  if (load.fullyReserved) return { kind: 'FULL', allocation: load.allocation, tone: 'neutral' };
  return { kind: 'ALLOCATION', allocation: load.allocation, tone: ALLOCATION_TONE[load.allocation] };
}
