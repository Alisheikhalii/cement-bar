import { describe, expect, it } from 'vitest';
import { bulkDaySimulator, config, groups20x6, memberId, simulate, T0, type SimDay } from './bulk-harness';

/**
 * Reference table of BULK_GROUP_ROTATION_SPEC §11 — 20 groups × 6 drivers, initial cursor on
 * group 2, everybody reserves immediately when their window opens (AC-4).
 */
describe('bulk reference table (§11)', () => {
  it('day 1: 48 loads → head 1, free 2..8, cursor 9', () => {
    const day = bulkDaySimulator({ groups: groups20x6(), cursorGroup: 2, headGroup: 1, loads: 48 });
    expect(day.headLoads).toBe(6);
    expect(day.windowsConsumed).toEqual([2, 3, 4, 5, 6, 7, 8].map((g) => ({ group: g, reserved: 6 })));
    expect(day.cursor).toEqual({ group: 'g9', remaining: 6, round: 1 });
    expect(day.burns).toEqual([]);
  });

  it('day 2: 43 loads → head 2, free 9..14 plus one to 15, cursor 15 with 5 left', () => {
    const day = bulkDaySimulator({ groups: groups20x6(), cursorGroup: 9, headGroup: 2, loads: 43 });
    expect(day.headLoads).toBe(6);
    expect(day.windowsConsumed).toEqual([
      ...[9, 10, 11, 12, 13, 14].map((g) => ({ group: g, reserved: 6 })),
      { group: 15, reserved: 1 },
    ]);
    expect(day.cursor).toEqual({ group: 'g15', remaining: 5, round: 1 });
    expect(day.burns).toEqual([]);
  });

  it('day 3: 41 loads → head 3, remaining 15 members then 16..20, cursor 1', () => {
    const day = bulkDaySimulator({ groups: groups20x6(), cursorGroup: 15, cursorRemaining: 5, headGroup: 3, loads: 41 });
    expect(day.headLoads).toBe(6);
    expect(day.windowsConsumed).toEqual([
      { group: 15, reserved: 5 },
      ...[16, 17, 18, 19, 20].map((g) => ({ group: g, reserved: 6 })),
    ]);
    expect(day.cursor).toEqual({ group: 'g1', remaining: 6, round: 2 });
  });

  it('overflow day: 130 loads / 120 drivers → round 2 reaches groups 2 and 3, cursor 3 with 2 left', () => {
    const day = bulkDaySimulator({ groups: groups20x6(), cursorGroup: 2, headGroup: 1, loads: 130 });
    expect(day.headLoads).toBe(6);
    expect(day.windowsConsumed).toEqual([
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((g) => ({ group: g, reserved: 6 })),
      { group: 2, reserved: 6 },
      { group: 3, reserved: 4 },
    ]);
    expect(day.windowsConsumed.filter((w) => w.group === 1)).toEqual([]);
    expect(day.cursor).toEqual({ group: 'g3', remaining: 2, round: 2 });
  });
});

/** Behaviour the table cannot show: punctuality, burning, halting and idempotency. */
describe('bulk day transitions', () => {
  const base = (overrides: Partial<SimDay> = {}): SimDay => ({
    groups: groups20x6(),
    cursorGroup: 2,
    headGroup: 1,
    loads: 6,
    now: T0,
    ...overrides,
  });

  it('opens the head window on [T0, T0+headMinutes]', () => {
    const sim = simulate(base({ loads: 6 }));
    expect(sim.windows[0]).toMatchObject({ kind: 'HEAD', groupId: 'g1', opensAt: T0, closesAt: T0 + 10 * 60_000 });
  });

  it('waits before T0', () => {
    const sim = simulate(base({ now: T0 - 1 }));
    expect(sim.windows).toEqual([]);
    expect(sim.idle).toBe('WAITING');
  });

  it('burns head members with a compatible load when the head window runs out of time', () => {
    const sim = simulate(base({ loads: 100, now: T0 + 10 * 60_000, autoReserve: false }));
    expect(sim.windows[0]).toMatchObject({ kind: 'HEAD' });
    expect(sim.burns[0]).toMatchObject({ reason: 'TIME', skipped: [] });
    expect(sim.burns[0]?.burned).toHaveLength(6);
    expect(sim.burns[0]?.burned[0]).toBe(memberId(1, 1));
  });

  it('does not burn a member with no compatible load', () => {
    const sim = simulate(base({ loads: 100, now: T0 + 10 * 60_000, autoReserve: false, compatible: 'none' }));
    expect(sim.burns[0]?.reason).toBe('TIME');
    expect(sim.burns[0]?.burned).toEqual([]);
    expect(sim.burns[0]?.skipped).toHaveLength(6);
  });

  it('carries un-reserved members when loads run out (nobody burns)', () => {
    const sim = simulate(base({ loads: 3 }));
    expect(sim.closes.some((c) => c.reason === 'EXHAUSTED')).toBe(true);
    expect(sim.cursor).toMatchObject({ groupId: 'g2', remaining: groups20x6()[1]?.memberIds });
    expect(sim.burns).toEqual([]);
    expect(sim.idle).toBe('NO_UNITS');
  });

  it('stops while no unit is available and resumes from the cursor when a new load arrives', () => {
    const day = bulkDaySimulator({ ...base({ loads: 48 }), addUnitsOnIdle: 2 });
    expect(day.resumedWindow).toMatchObject({ kind: 'FREE', groupId: 'g9' });
    expect(day.resumedReserved).toBe(2);
  });

  it("skips today's head group in the free queue in round 1 and round 2", () => {
    const sim = simulate(base({ loads: 130 }));
    const freeGroups = sim.windows.filter((w) => w.kind === 'FREE').map((w) => w.groupId);
    expect(freeGroups).not.toContain('g1');
    expect(sim.windows.find((w) => w.kind === 'FREE' && w.round === 2)?.groupId).toBe('g2');
  });

  it('closes early with ALL_RESERVED instead of waiting for the timer', () => {
    const sim = simulate(base({ loads: 12 }));
    expect(sim.closes.map((c) => c.reason).slice(0, 2)).toEqual(['ALL_RESERVED', 'EXHAUSTED']);
    expect(sim.closes[0]?.closedAt).toBe(T0);
  });

  it('is idempotent: re-running a tick on an applied state opens and closes nothing', () => {
    const day = bulkDaySimulator(base({ loads: 20 }));
    expect(day.replay).toEqual({ open: null, close: null, idle: 'NO_UNITS' });
  });

  it('halts without burning anyone', () => {
    const sim = simulate(base({ loads: 100, autoReserve: false, haltOnFirstWindow: true }));
    expect(sim.closes.at(-1)).toMatchObject({ reason: 'HALTED', burned: [] });
    expect(sim.idle).toBe('HALTED');
  });

  it('closes an operator-ended window as MANUAL, burning only members with a compatible load', () => {
    const burning = simulate(base({ loads: 100, autoReserve: false, manualCloseFirstWindow: true }));
    expect(burning.closes[0]).toMatchObject({ reason: 'MANUAL', skipped: [] });
    expect(burning.closes[0]?.burned).toHaveLength(6);

    const skipping = simulate(base({ loads: 100, autoReserve: false, manualCloseFirstWindow: true, compatible: 'none' }));
    expect(skipping.closes[0]?.burned).toEqual([]);
    expect(skipping.closes[0]?.skipped).toHaveLength(6);
  });

  it('ends the day at hallEnd and carries the remainder', () => {
    const sim = simulate(base({ loads: 100, autoReserve: false, jumpToHallEndAfterOpen: true }));
    expect(sim.closes.some((c) => c.reason === 'HALL_END')).toBe(true);
    expect(sim.idle).toBe('HALL_END');
  });

  it('drops members who already hit the daily cap from the eligibility', () => {
    const maxed = { [memberId(2, 1)]: 1, [memberId(2, 2)]: 1, [memberId(2, 3)]: 1 };
    const sim = simulate(base({ loads: 100, maxLoads: 1, initialLoads: maxed }));
    const firstFree = sim.windows.find((w) => w.kind === 'FREE' && w.groupId === 'g2');
    expect(firstFree?.eligible).toEqual([memberId(2, 4), memberId(2, 5), memberId(2, 6)]);
  });

  it("does not open a free window when every active group is today's head", () => {
    const sim = simulate({
      groups: [{ id: 'solo', memberIds: [memberId(1, 1), memberId(1, 2)] }],
      cursorGroup: null,
      headGroup: 1,
      loads: 10,
    });
    expect(sim.windows.filter((w) => w.kind === 'FREE')).toEqual([]);
    expect(sim.idle).toBe('NO_ELIGIBLE');
  });

  it('starts an uninitialized cursor on the group after the head', () => {
    const sim = simulate(base({ loads: 12, cursorGroup: null }));
    expect(sim.windows.find((w) => w.kind === 'FREE')?.groupId).toBe('g2');
  });

  it('uses the configured hall end and window lengths', () => {
    expect(config()).toMatchObject({ headMinutes: 10, freeMinutes: 5, maxLoadsPerDriverPerDay: 2 });
  });
});
