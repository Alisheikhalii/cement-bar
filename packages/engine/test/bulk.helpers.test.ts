import { describe, expect, it } from 'vitest';
import { initialBulkCursor, isWindowOpen, nextHeadGroup, type BulkGroup, type BulkOpenWindow } from '../src/bulk';
import { memberId } from './bulk-harness';

const groups = (): BulkGroup[] => [
  { id: 'a', memberIds: [memberId(1, 1), memberId(1, 2)] },
  { id: 'b', memberIds: [memberId(2, 1)] },
  { id: 'c', memberIds: [] },
];

describe('nextHeadGroup', () => {
  it('returns null without groups', () => {
    expect(nextHeadGroup([], null)).toBeNull();
  });

  it('starts from the first group when no head is set', () => {
    expect(nextHeadGroup(groups(), null)).toBe('a');
  });

  it('advances to the next group and wraps', () => {
    expect(nextHeadGroup(groups(), 'a')).toBe('b');
    expect(nextHeadGroup(groups(), 'c')).toBe('a');
  });

  it('falls back to the first group when the current head is gone', () => {
    expect(nextHeadGroup(groups(), 'missing')).toBe('a');
  });
});

describe('initialBulkCursor', () => {
  it('is empty without groups', () => {
    expect(initialBulkCursor([], 'a')).toEqual({ groupId: null, remaining: [], round: 1 });
  });

  it('sits on the group after the start head', () => {
    expect(initialBulkCursor(groups(), 'a')).toEqual({ groupId: 'b', remaining: [memberId(2, 1)], round: 1 });
  });

  it('sits on the first group when the start head is unknown', () => {
    expect(initialBulkCursor(groups(), 'missing').groupId).toBe('a');
    expect(initialBulkCursor(groups(), null).groupId).toBe('a');
  });

  it('wraps to the first group when the start head is the last one', () => {
    expect(initialBulkCursor(groups(), 'c').groupId).toBe('a');
  });
});

describe('isWindowOpen', () => {
  const window: BulkOpenWindow = {
    seq: 3,
    kind: 'FREE',
    round: 1,
    groupId: 'a',
    eligible: ['d1', 'd2'],
    opensAt: 1000,
    closesAt: 2000,
    reserved: ['d2'],
  };

  it('is open for an eligible driver inside the interval', () => {
    expect(isWindowOpen(window, 'd1', 1500)).toBe(true);
  });

  it('is closed before opening and at the closing instant', () => {
    expect(isWindowOpen(window, 'd1', 999)).toBe(false);
    expect(isWindowOpen(window, 'd1', 2000)).toBe(false);
  });

  it('rejects drivers outside the window or that already reserved', () => {
    expect(isWindowOpen(window, 'd3', 1500)).toBe(false);
    expect(isWindowOpen(window, 'd2', 1500)).toBe(false);
  });
});
