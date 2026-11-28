import { describe, expect, it } from 'vitest';
import { buildHallHours, type HallInput } from './hall-hours';

const hall: HallInput = {
  id: 'h1',
  title: 'سالن کیسه‌ای',
  category: 'BAG',
  terminalName: null,
  terminalCity: null,
};
const hall2: HallInput = {
  id: 'h2',
  title: 'سالن فله',
  category: 'BULK',
  terminalName: null,
  terminalCity: null,
};

describe('buildHallHours', () => {
  // 2026-11-28 is a Saturday (Iranian weekday 0).
  const today = '2026-11-28';

  it('projects the weekly schedule in Tehran time when no hall day exists', () => {
    const days = buildHallHours(
      today,
      2,
      [hall],
      [],
      [{ hallId: 'h1', weekday: 0, t0: '08:00', priorityEnd: '08:30', hallEnd: '12:00' }],
    );
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ date: today, weekday: 0 });
    expect(days[0]!.entries[0]).toMatchObject({
      source: 'SCHEDULE',
      status: null,
      t0At: '2026-11-28T04:30:00.000Z', // 08:00 Tehran (+03:30)
      priorityEndAt: '2026-11-28T05:00:00.000Z',
      hallEndAt: '2026-11-28T08:30:00.000Z',
    });
    expect(days[1]!.entries).toEqual([]); // Sunday: no schedule
  });

  it('a created hall day overrides the schedule and keeps its status', () => {
    const days = buildHallHours(
      today,
      1,
      [hall],
      [
        {
          hallId: 'h1',
          date: today,
          status: 'HALTED',
          t0At: new Date('2026-11-28T05:00:00Z'),
          priorityEndAt: null,
          hallEndAt: new Date('2026-11-28T09:00:00Z'),
        },
      ],
      [{ hallId: 'h1', weekday: 0, t0: '08:00', priorityEnd: null, hallEnd: '12:00' }],
    );
    expect(days[0]!.entries).toHaveLength(1);
    expect(days[0]!.entries[0]).toMatchObject({
      source: 'DAY',
      status: 'HALTED',
      t0At: '2026-11-28T05:00:00.000Z',
    });
  });

  it('ignores days of unknown (inactive) halls, rolls an overnight end to the next day, sorts by start', () => {
    const now = new Date('2026-11-28T05:00:00Z');
    const days = buildHallHours(
      today,
      1,
      [hall, hall2],
      [{ hallId: 'zzz', date: today, status: 'OPEN', t0At: now, priorityEndAt: null, hallEndAt: now }],
      [
        { hallId: 'h1', weekday: 0, t0: '22:00', priorityEnd: null, hallEnd: '02:00' },
        { hallId: 'h2', weekday: 0, t0: '07:00', priorityEnd: null, hallEnd: '09:00' },
      ],
    );
    const e = days[0]!.entries;
    expect(e.map((x) => x.hallId)).toEqual(['h2', 'h1']);
    expect(e[1]!.hallEndAt).toBe('2026-11-28T22:30:00.000Z'); // 02:00 Tehran on the next day
  });
});
