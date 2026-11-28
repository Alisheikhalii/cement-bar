import { describe, expect, it } from 'vitest';
import {
  absorptionOf,
  allowedTargets,
  baseAllocation,
  canCancel,
  checkAllocationChange,
  editBlock,
  countUnits,
  planTruckCountChange,
  quotaKg,
  resolveCreateAllocation,
  revertTarget,
} from './allocation-rules';

describe('allocation rules (BR-10 / BR-11)', () => {
  const open = { state: 'OPEN' as const, changes: [] };

  it('GROUP/TIMED → FREE allowed on OPEN units only', () => {
    expect(checkAllocationChange({ ...open, allocation: 'GROUP' }, 'FREE')).toEqual({ ok: true, noop: false });
    expect(checkAllocationChange({ ...open, allocation: 'TIMED' }, 'FREE')).toEqual({ ok: true, noop: false });
    expect(checkAllocationChange({ allocation: 'TIMED', state: 'RESERVED', changes: [] }, 'FREE')).toEqual({
      ok: false,
      reason: 'UNIT_NOT_OPEN',
    });
    expect(checkAllocationChange({ allocation: 'GROUP', state: 'HELD', changes: [] }, 'FREE').ok).toBe(false);
  });

  it('same allocation is a no-op', () => {
    expect(checkAllocationChange({ ...open, allocation: 'FREE' }, 'FREE')).toEqual({ ok: true, noop: true });
  });

  it('FREE → back only to the allocation before freeing', () => {
    const freed = {
      allocation: 'FREE' as const,
      state: 'OPEN' as const,
      changes: [{ from: 'GROUP' as const, to: 'FREE' as const }],
    };
    expect(revertTarget(freed)).toBe('GROUP');
    expect(checkAllocationChange(freed, 'GROUP')).toEqual({ ok: true, noop: false });
    expect(checkAllocationChange(freed, 'TIMED')).toEqual({ ok: false, reason: 'TRANSITION_NOT_ALLOWED' });
    expect(allowedTargets(freed)).toEqual(['GROUP']);
  });

  it('created-FREE units cannot be promoted; GROUP ↔ TIMED is rejected', () => {
    expect(checkAllocationChange({ ...open, allocation: 'FREE' }, 'TIMED').ok).toBe(false);
    expect(checkAllocationChange({ ...open, allocation: 'GROUP' }, 'TIMED').ok).toBe(false);
    expect(allowedTargets({ ...open, allocation: 'FREE' })).toEqual([]);
    expect(allowedTargets({ allocation: 'GROUP', state: 'RESERVED', changes: [] })).toEqual([]);
  });

  it('base allocation and revert target follow the history', () => {
    const u = {
      allocation: 'FREE' as const,
      changes: [
        { from: 'TIMED' as const, to: 'FREE' as const },
        { from: 'FREE' as const, to: 'TIMED' as const },
        { from: 'TIMED' as const, to: 'FREE' as const },
      ],
    };
    expect(baseAllocation(u)).toBe('TIMED');
    expect(revertTarget(u)).toBe('TIMED');
    expect(baseAllocation({ allocation: 'GROUP', changes: [] })).toBe('GROUP');
    expect(revertTarget({ allocation: 'GROUP', changes: [] })).toBeNull();
  });

  it('creation allocation: hall default, explicit choice, BR-11 free flag, category guard', () => {
    const bag = { category: 'BAG' as const, defaultAllocation: 'TIMED' as const };
    const bulk = { category: 'BULK' as const, defaultAllocation: 'GROUP' as const };
    expect(resolveCreateAllocation(bag, undefined, false)).toEqual({ ok: true, allocation: 'TIMED' });
    expect(resolveCreateAllocation(bulk, undefined, false)).toEqual({ ok: true, allocation: 'GROUP' });
    expect(resolveCreateAllocation(bulk, 'FREE', false)).toEqual({ ok: true, allocation: 'FREE' });
    expect(resolveCreateAllocation(bulk, 'GROUP', true)).toEqual({ ok: true, allocation: 'FREE' });
    expect(resolveCreateAllocation(bag, 'GROUP', false)).toEqual({ ok: false });
    expect(resolveCreateAllocation(bulk, 'TIMED', false)).toEqual({ ok: false });
  });
});

describe('counts, absorption, quota', () => {
  it('D12 consumption is bigint trucks × weightToKg', () => {
    expect(quotaKg(10, 28_000)).toBe(280_000n);
    expect(quotaKg(500, 1_000_000)).toBe(500_000_000n);
  });

  it('counts by state and derives absorption', () => {
    const c = countUnits([
      { state: 'OPEN', n: 3 },
      { state: 'RESERVED' },
      { state: 'CONSUMED' },
      { state: 'CANCELLED', n: 2 },
      { state: 'HELD' },
    ]);
    expect(c).toEqual({ total: 6, open: 3, issued: 2, held: 1, cancelled: 2 });
    expect(absorptionOf('ACTIVE', c)).toBe('PARTIAL');
    expect(absorptionOf('ACTIVE', countUnits([{ state: 'OPEN' }]))).toBe('NONE');
    expect(absorptionOf('ACTIVE', countUnits([{ state: 'CONSUMED', n: 2 }]))).toBe('FULL');
    expect(absorptionOf('CANCELLED', c)).toBe('CANCELLED');
  });
});

describe('editBlock / canCancel', () => {
  const free = countUnits([{ state: 'OPEN', n: 2 }]);
  const engaged = countUnits([{ state: 'OPEN' }, { state: 'RESERVED' }]);
  it('blocks edits of non-active, engaged or prioritised announcements', () => {
    expect(editBlock('ACTIVE', free, 0)).toBeNull();
    expect(editBlock('CANCELLED', free, 0)).toBe('NOT_ACTIVE');
    expect(editBlock('ACTIVE', engaged, 0)).toBe('HAS_RESERVATIONS');
    expect(editBlock('ACTIVE', countUnits([{ state: 'HELD' }]), 0)).toBe('HAS_RESERVATIONS');
    expect(editBlock('ACTIVE', free, 1)).toBe('HAS_PRIORITIES');
  });
  it('cancel only when active and nothing engaged', () => {
    expect(canCancel('ACTIVE', free)).toBe(true);
    expect(canCancel('ACTIVE', engaged)).toBe(false);
    expect(canCancel('COMPLETED', free)).toBe(false);
  });
});

describe('planTruckCountChange', () => {
  const units = [
    { id: 'a', seq: 1, state: 'OPEN' as const },
    { id: 'b', seq: 2, state: 'OPEN' as const },
    { id: 'c', seq: 3, state: 'CANCELLED' as const },
    { id: 'd', seq: 4, state: 'OPEN' as const },
  ];
  it('adds after the highest seq (including cancelled ones)', () => {
    expect(planTruckCountChange(units, 5)).toEqual({ add: [5, 6], cancel: [] });
    expect(planTruckCountChange(units, 3)).toEqual({ add: [], cancel: [] });
  });
  it('cancels the highest open seqs first', () => {
    expect(planTruckCountChange(units, 1)).toEqual({ add: [], cancel: ['d', 'b'] });
  });
  it('refuses to cancel non-open units', () => {
    expect(() => planTruckCountChange([{ id: 'x', seq: 1, state: 'RESERVED' }], 0)).toThrow();
  });
});
