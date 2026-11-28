import {
  addDaysIso,
  iranWeekday,
  localDateTimeToUtc,
  type DriverHallHoursDayDto,
  type DriverHallHoursEntryDto,
  type HallCategory,
  type HallDayStatus,
} from '@cb/shared';

export interface HallInput {
  id: string;
  title: string;
  category: HallCategory;
  terminalName: string | null;
  terminalCity: string | null;
}
export interface HallDayInput {
  hallId: string;
  date: string;
  status: HallDayStatus;
  t0At: Date;
  priorityEndAt: Date | null;
  hallEndAt: Date;
}
export interface ScheduleInput {
  hallId: string;
  weekday: number;
  t0: string;
  priorityEnd: string | null;
  hallEnd: string;
}

/** "HH:mm" of a weekly schedule on local date `date`; an end at/before the start rolls over to the next day. */
function at(date: string, hhmm: string, notBefore?: Date): Date {
  const d = localDateTimeToUtc(date, hhmm);
  return notBefore && d.getTime() <= notBefore.getTime() ? localDateTimeToUtc(addDaysIso(date, 1), hhmm) : d;
}

/**
 * Pure: builds `days` consecutive local days starting at `today`. A created hall day (DAY) always wins over the
 * weekly schedule projection (SCHEDULE) for the same hall and date. Entries are sorted by start time.
 */
export function buildHallHours(
  today: string,
  days: number,
  halls: HallInput[],
  hallDays: HallDayInput[],
  schedules: ScheduleInput[],
): DriverHallHoursDayDto[] {
  const hallById = new Map(halls.map((h) => [h.id, h]));
  const dayKey = (hallId: string, date: string): string => `${hallId}|${date}`;
  const created = new Map(
    hallDays.filter((d) => hallById.has(d.hallId)).map((d) => [dayKey(d.hallId, d.date), d]),
  );
  const out: DriverHallHoursDayDto[] = [];

  for (let i = 0; i < days; i += 1) {
    const date = addDaysIso(today, i);
    const weekday = iranWeekday(date);
    const entries: DriverHallHoursEntryDto[] = [];
    for (const hall of halls) {
      const base = {
        hallId: hall.id,
        hallTitle: hall.title,
        category: hall.category,
        terminalName: hall.terminalName,
        terminalCity: hall.terminalCity,
      };
      const day = created.get(dayKey(hall.id, date));
      if (day) {
        entries.push({
          ...base,
          source: 'DAY',
          status: day.status,
          t0At: day.t0At.toISOString(),
          priorityEndAt: day.priorityEndAt?.toISOString() ?? null,
          hallEndAt: day.hallEndAt.toISOString(),
        });
        continue;
      }
      const s = schedules.find((x) => x.hallId === hall.id && x.weekday === weekday);
      if (!s) continue;
      const t0 = at(date, s.t0);
      entries.push({
        ...base,
        source: 'SCHEDULE',
        status: null,
        t0At: t0.toISOString(),
        priorityEndAt: s.priorityEnd ? at(date, s.priorityEnd, t0).toISOString() : null,
        hallEndAt: at(date, s.hallEnd, t0).toISOString(),
      });
    }
    entries.sort((a, b) => a.t0At.localeCompare(b.t0At) || a.hallTitle.localeCompare(b.hallTitle, 'fa'));
    out.push({ date, weekday, entries });
  }
  return out;
}
