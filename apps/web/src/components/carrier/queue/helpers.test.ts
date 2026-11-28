import { describe, expect, it } from 'vitest';
import type { CarrierBulkGroupDto } from '@cb/shared';
import { moveInOrder, otherGroupTitle, windowTime } from './helpers';

const member = (driverId: string) => ({ driverId, firstName: 'راننده', lastName: driverId, plate: null, loaderTitle: null });

const groups: CarrierBulkGroupDto[] = [
  { id: 'g1', title: 'گروه ۱', sortOrder: 0, active: true, memberCount: 1, members: [member('d1')] },
  { id: 'g2', title: 'گروه ۲', sortOrder: 1, active: true, memberCount: 1, members: [member('d2')] },
];

describe('moveInOrder', () => {
  it('moves an item down and up without mutating the input', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveInOrder(ids, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveInOrder(ids, 2, 1)).toEqual(['a', 'c', 'b']);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('returns an unchanged copy for out-of-range or no-op moves', () => {
    expect(moveInOrder(['a', 'b'], 0, 0)).toEqual(['a', 'b']);
    expect(moveInOrder(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
    expect(moveInOrder(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
  });
});

describe('otherGroupTitle', () => {
  it('finds the group that already contains the driver, ignoring the current group', () => {
    expect(otherGroupTitle(groups, 'd1', 'g2')).toBe('گروه ۱');
    expect(otherGroupTitle(groups, 'd1', 'g1')).toBeNull();
    expect(otherGroupTitle(groups, 'unknown', 'g1')).toBeNull();
  });
});

describe('windowTime', () => {
  it('shows the Tehran wall-clock time of an ISO instant with Persian digits', () => {
    expect(windowTime('2026-11-28T04:30:00.000Z')).toBe('۰۸:۰۰');
  });
});
