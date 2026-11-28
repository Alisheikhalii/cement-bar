/**
 * Pure helpers and query keys for the carrier queue screens. Kept free of React so they can be unit
 * tested (vitest, node environment) without a DOM.
 */
import { toJalali, type CarrierBulkGroupDto } from '@cb/shared';

export const GROUPS_KEY = ['carrier', 'bulk', 'groups'] as const;
export const SETTINGS_KEY = ['carrier', 'bulk', 'settings'] as const;
export const LIVE_KEY = ['carrier', 'bulk', 'live'] as const;
export const CANCEL_KEY = ['carrier', 'cancel-requests'] as const;
export const APPROVED_DRIVERS_KEY = ['carrier', 'drivers', 'approved-options'] as const;

/** Reorders an id list by moving the item at `from` to `to` (used by the up/down buttons). */
export function moveInOrder(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(to, 0, item);
  return next;
}

/** Title of the first group that already contains `driverId`, ignoring `excludeGroupId`, if any. */
export function otherGroupTitle(
  groups: readonly CarrierBulkGroupDto[],
  driverId: string,
  excludeGroupId: string,
): string | null {
  for (const g of groups) {
    if (g.id === excludeGroupId) continue;
    if (g.members.some((m) => m.driverId === driverId)) return g.title;
  }
  return null;
}

/** "HH:mm" of an ISO instant in Tehran, Persian digits (window open/close times). */
export function windowTime(iso: string): string {
  return toJalali(iso, 'HH:mm');
}

/** Server cap bounds shared by the settings form and the schema (1..10 loads per driver per day). */
export const DAILY_CAP_MIN = 1;
export const DAILY_CAP_MAX = 10;
