import { describe, expect, it } from 'vitest';
import { dayTimes, isAllocationCompatible, isStrategyCompatible, planHallDays, type ScheduleRow } from './hall-days';

// 2026-11-28 is a Saturday (Iranian weekday 0).
const SAT = '2026-11-28';
const row = (weekday: number, active = true): ScheduleRow => ({ weekday, t0: '08:00', priorityEnd: '08:30', hallEnd: '12:00', active });

describe('dayTimes', () => {
  it('converts Tehran local times to UTC (+03:30)', () => {
    const t = dayTimes(SAT, { t0: '08:00', priorityEnd: '08:30', hallEnd: '12:00' });
    expect(t.t0At.toISOString()).toBe('2026-11-28T04:30:00.000Z');
    expect(t.priorityEndAt?.toISOString()).toBe('2026-11-28T05:00:00.000Z');
    expect(t.hallEndAt.toISOString()).toBe('2026-11-28T08:30:00.000Z');
    expect(dayTimes(SAT, { t0: '08:00', hallEnd: '09:00' }).priorityEndAt).toBeNull();
  });
});

describe('planHallDays', () => {
  const before = new Date('2026-11-27T00:00:00Z');

  it('creates one day per active weekday and skips the rest', () => {
    const r = planHallDays([row(0), row(1), row(2, false)], SAT, 7, new Set(), before);
    expect(r.create.map((d) => d.date)).toEqual(['2026-11-28', '2026-11-29']);
    expect(r.skipped).toHaveLength(5);
    expect(r.skipped.every((s) => s.reason === 'NO_SCHEDULE')).toBe(true);
  });

  it('never touches existing days (idempotent re-run)', () => {
    const first = planHallDays([row(0), row(1)], SAT, 2, new Set(), before);
    const again = planHallDays([row(0), row(1)], SAT, 2, new Set(first.create.map((d) => d.date)), before);
    expect(again.create).toEqual([]);
    expect(again.skipped).toEqual([
      { date: '2026-11-28', reason: 'EXISTS' },
      { date: '2026-11-29', reason: 'EXISTS' },
    ]);
  });

  it('skips a day whose T0 has already passed (server clock)', () => {
    const now = new Date('2026-11-28T04:30:00Z'); // exactly T0 of Saturday
    const r = planHallDays([row(0), row(1)], SAT, 2, new Set(), now);
    expect(r.skipped).toEqual([{ date: SAT, reason: 'PAST' }]);
    expect(r.create.map((d) => d.date)).toEqual(['2026-11-29']);
  });
});

describe('compatibility rules', () => {
  it('allocation', () => {
    expect(isAllocationCompatible('BAG', 'TIMED')).toBe(true);
    expect(isAllocationCompatible('BAG', 'GROUP')).toBe(false);
    expect(isAllocationCompatible('BULK', 'GROUP')).toBe(true);
    expect(isAllocationCompatible('BULK', 'TIMED')).toBe(false);
    expect(isAllocationCompatible('BULK', 'FREE')).toBe(true);
  });
  it('strategy', () => {
    expect(isStrategyCompatible('BAG', 'TIMED_PRIORITY_RESERVATION')).toBe(true);
    expect(isStrategyCompatible('BAG', 'BULK_GROUP_ROTATION')).toBe(false);
    expect(isStrategyCompatible('BULK', 'BULK_GROUP_ROTATION')).toBe(true);
    expect(isStrategyCompatible('BULK', 'FREE_FIRST_COME')).toBe(true);
    expect(isStrategyCompatible('BULK', 'TIMED_PRIORITY_RESERVATION')).toBe(false);
  });
});
