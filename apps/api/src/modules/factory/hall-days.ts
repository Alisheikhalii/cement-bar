import { addDaysIso, iranWeekday, localDateTimeToUtc, type HallDaySkipReason } from '@cb/shared';

/** Pure helpers for materialising hall_days from the weekly schedule (no I/O, no clock). */

export interface ScheduleRow {
  weekday: number;
  t0: string;
  priorityEnd: string | null;
  hallEnd: string;
  active: boolean;
}

export interface DayTimes {
  t0At: Date;
  priorityEndAt: Date | null;
  hallEndAt: Date;
}

export interface PlannedDay extends DayTimes {
  date: string;
}

/** Local "HH:mm" times on a local ISO date (business tz) → UTC instants. */
export function dayTimes(date: string, t: { t0: string; priorityEnd?: string | null; hallEnd: string }): DayTimes {
  return {
    t0At: localDateTimeToUtc(date, t.t0),
    priorityEndAt: t.priorityEnd ? localDateTimeToUtc(date, t.priorityEnd) : null,
    hallEndAt: localDateTimeToUtc(date, t.hallEnd),
  };
}

/**
 * Plans days [from, from+days) from the weekly schedule. Existing days are never touched (EXISTS);
 * weekdays without an active schedule row are skipped (NO_SCHEDULE); days whose T0 is not in the
 * future are skipped (PAST) so a generated day can never open "in the past".
 */
export function planHallDays(
  schedules: readonly ScheduleRow[],
  from: string,
  days: number,
  existingDates: ReadonlySet<string>,
  now: Date,
): { create: PlannedDay[]; skipped: { date: string; reason: HallDaySkipReason }[] } {
  const byWeekday = new Map(schedules.filter((s) => s.active).map((s) => [s.weekday, s]));
  const create: PlannedDay[] = [];
  const skipped: { date: string; reason: HallDaySkipReason }[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDaysIso(from, i);
    if (existingDates.has(date)) {
      skipped.push({ date, reason: 'EXISTS' });
      continue;
    }
    const s = byWeekday.get(iranWeekday(date));
    if (!s) {
      skipped.push({ date, reason: 'NO_SCHEDULE' });
      continue;
    }
    const times = dayTimes(date, s);
    if (times.t0At.getTime() <= now.getTime()) {
      skipped.push({ date, reason: 'PAST' });
      continue;
    }
    create.push({ date, ...times });
  }
  return { create, skipped };
}

/** Hall category ↔ allocation coherence. ASSUMPTION(Q-D-5): BAG → TIMED|FREE, BULK → GROUP|FREE. */
export function isAllocationCompatible(category: 'BAG' | 'BULK', allocation: 'GROUP' | 'TIMED' | 'FREE'): boolean {
  return category === 'BAG' ? allocation !== 'GROUP' : allocation !== 'TIMED';
}

/** Strategy ↔ hall category coherence for queue policies (same rule as allocations). */
export function isStrategyCompatible(
  category: 'BAG' | 'BULK',
  strategy: 'TIMED_PRIORITY_RESERVATION' | 'BULK_GROUP_ROTATION' | 'FREE_FIRST_COME',
): boolean {
  if (strategy === 'FREE_FIRST_COME') return true;
  return category === 'BAG' ? strategy === 'TIMED_PRIORITY_RESERVATION' : strategy === 'BULK_GROUP_ROTATION';
}
