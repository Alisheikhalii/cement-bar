import { describe, expect, it } from 'vitest';
import { stepBulk, type BulkOpenWindow, type BulkStepInput } from '../src/bulk';
import { config, groups20x6, T0 } from './bulk-harness';

const openWindow = (overrides: Partial<BulkOpenWindow> = {}): BulkOpenWindow => ({
  seq: 1,
  kind: 'FREE',
  round: 1,
  groupId: 'g2',
  eligible: ['a', 'b'],
  opensAt: T0,
  closesAt: T0 + 5 * 60_000,
  reserved: [],
  ...overrides,
});

const input = (overrides: Partial<BulkStepInput> = {}): BulkStepInput => ({
  now: T0 + 60_000,
  groups: groups20x6(),
  headGroupId: 'g1',
  cursor: { groupId: 'g2', remaining: ['a', 'b'], round: 1 },
  config: config(),
  window: null,
  loadsToday: {},
  compatibleByDriver: { a: 1, b: 1 },
  openUnits: 10,
  halted: false,
  lastWindowSeq: 1,
  ...overrides,
});

describe('stepBulk edges', () => {
  it('ignores a forced close scheduled in the future', () => {
    const step = stepBulk(input({ window: openWindow(), forcedClose: { reason: 'MANUAL', at: T0 + 120_000 } }));
    expect(step).toEqual({ close: null, open: null, cursor: input().cursor, idle: 'WAITING' });
  });

  it('reports NO_ELIGIBLE when the head group is no longer active', () => {
    const step = stepBulk(input({ headGroupId: 'gone', lastWindowSeq: 0 }));
    expect(step.idle).toBe('NO_ELIGIBLE');
  });

  it('reports NO_ELIGIBLE without groups', () => {
    const step = stepBulk(input({ groups: [], headGroupId: null, lastWindowSeq: 1 }));
    expect(step.idle).toBe('NO_ELIGIBLE');
  });

  it('does not open the head window when there is no head', () => {
    const step = stepBulk(input({ headGroupId: null, lastWindowSeq: 0, cursor: { groupId: null, remaining: [], round: 1 } }));
    expect(step.open).toMatchObject({ kind: 'FREE', groupId: 'g1' });
  });

  it('starts on the first group when the cursor points at a removed group', () => {
    const step = stepBulk(input({ cursor: { groupId: 'removed', remaining: [], round: 1 } }));
    expect(step.open).toMatchObject({ kind: 'FREE', groupId: 'g2' });
  });

  it('advances the cursor onto the first group when a closed window named a removed group', () => {
    const step = stepBulk(
      input({
        window: openWindow({ groupId: 'removed', eligible: ['a', 'b'], reserved: ['a', 'b'] }),
        cursor: { groupId: 'removed', remaining: ['a', 'b'], round: 1 },
      }),
    );
    expect(step.close?.reason).toBe('ALL_RESERVED');
    expect(step.cursor).toMatchObject({ groupId: 'g1', round: 1 });
  });

  it('keeps the cursor members that were not part of the window', () => {
    const step = stepBulk(
      input({
        window: openWindow({ eligible: ['a', 'b'], reserved: ['a'] }),
        cursor: { groupId: 'g2', remaining: ['a', 'b', 'c'], round: 1 },
        openUnits: 0,
      }),
    );
    expect(step.close?.reason).toBe('EXHAUSTED');
    expect(step.close?.carried).toEqual(['b']);
    expect(step.cursor).toEqual({ groupId: 'g2', remaining: ['b', 'c'], round: 1 });
  });

  it('advances from the first group when the cursor was never initialized', () => {
    const step = stepBulk(
      input({
        window: openWindow({ eligible: ['a', 'b'], reserved: ['a', 'b'] }),
        cursor: { groupId: null, remaining: [], round: 1 },
      }),
    );
    expect(step.cursor).toEqual({ groupId: 'g1', remaining: groups20x6()[0]?.memberIds, round: 1 });
  });

  it('keeps the cursor when the carrier has no active groups left', () => {
    const cursor = { groupId: 'g2', remaining: [], round: 3 };
    const step = stepBulk(
      input({
        groups: [],
        window: openWindow({ eligible: ['a'], reserved: ['a'] }),
        cursor,
      }),
    );
    expect(step.cursor).toEqual(cursor);
  });
});
