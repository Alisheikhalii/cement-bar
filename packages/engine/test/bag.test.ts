import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocateBag, type BagAllocateInput } from '../src/bag';

const turn = (turnNo: number, driverId: string, priorities: string[]) => ({ turnNo, driverId, priorities });

describe('allocateBag — table cases', () => {
  it('assigns priorities in turn order, not registration order', () => {
    const input: BagAllocateInput = {
      turns: [turn(2, 'd2', ['a']), turn(1, 'd1', ['a'])],
      stock: { a: ['u1'] },
    };
    const result = allocateBag(input);
    expect(result.assignments).toEqual([
      { driverId: 'd1', unitId: 'u1', announcementId: 'a', rank: 1 },
    ]);
    expect(result.notAllocated).toEqual(['d2']);
  });

  it('falls through to the next priority when the first has no units', () => {
    const result = allocateBag({
      turns: [turn(1, 'd1', ['a', 'b', 'c'])],
      stock: { a: [], b: ['b1', 'b2'], c: ['c1'] },
    });
    expect(result.assignments).toEqual([{ driverId: 'd1', unitId: 'b1', announcementId: 'b', rank: 2 }]);
    expect(result.remainingStock).toEqual({ a: [], b: ['b2'], c: ['c1'] });
  });

  it('consumes stock FIFO per announcement', () => {
    const result = allocateBag({
      turns: [turn(1, 'd1', ['a']), turn(2, 'd2', ['a']), turn(3, 'd3', ['a'])],
      stock: { a: ['u1', 'u2'] },
    });
    expect(result.assignments.map((a) => a.unitId)).toEqual(['u1', 'u2']);
    expect(result.notAllocated).toEqual(['d3']);
  });

  it('ignores priorities that point at unknown announcements', () => {
    const result = allocateBag({ turns: [turn(1, 'd1', ['ghost', 'a'])], stock: { a: ['u1'] } });
    expect(result.assignments).toEqual([{ driverId: 'd1', unitId: 'u1', announcementId: 'a', rank: 2 }]);
  });

  it('does not mutate the input stock', () => {
    const stock = { a: ['u1'] };
    allocateBag({ turns: [turn(1, 'd1', ['a'])], stock });
    expect(stock.a).toEqual(['u1']);
  });

  it('reports every unallocated driver exactly once', () => {
    const result = allocateBag({
      turns: [turn(1, 'd1', []), turn(2, 'd2', ['x']), turn(3, 'd3', ['x'])],
      stock: {},
    });
    expect(result.assignments).toEqual([]);
    expect(result.notAllocated).toEqual(['d1', 'd2', 'd3']);
  });
});

describe('allocateBag — determinism', () => {
  it('produces the same result for the same input', () => {
    const input: BagAllocateInput = {
      turns: [turn(3, 'c', ['a', 'b']), turn(1, 'a', ['b']), turn(2, 'b', ['a'])],
      stock: { a: ['a1', 'a2'], b: ['b1'] },
    };
    expect(allocateBag(input)).toEqual(allocateBag(input));
  });

  it('is stable in turn order regardless of the array order given', () => {
    const turns = [turn(1, 'a', ['x']), turn(2, 'b', ['x']), turn(3, 'c', ['x']), turn(4, 'd', ['y'])];
    const stock = { x: ['x1'], y: ['y1'] };
    const a = allocateBag({ turns, stock });
    const b = allocateBag({ turns: [...turns].reverse(), stock });
    expect(a).toEqual(b);
  });
});

describe('allocateBag — property: no overbooking (AC-3/AC-6)', () => {
  const arb = fc.record({
    stock: fc.dictionary(fc.constantFrom('a', 'b', 'c', 'd'), fc.array(fc.uuid(), { maxLength: 8 })),
    turns: fc.array(
      fc.record({
        turnNo: fc.integer({ min: 1, max: 50 }),
        driverId: fc.uuid(),
        priorities: fc.uniqueArray(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 3 }),
      }),
      { maxLength: 30 },
    ),
  });

  it('never assigns a unit twice and never exceeds stock', () => {
    fc.assert(
      fc.property(arb, ({ stock, turns }) => {
        const numbered = turns.map((t, i) => ({ ...t, turnNo: i + 1 }));
        const result = allocateBag({ turns: numbered, stock });
        const assignedUnits = result.assignments.map((a) => a.unitId);
        expect(new Set(assignedUnits).size).toBe(assignedUnits.length);
        for (const [announcementId, units] of Object.entries(stock)) {
          const used = result.assignments.filter((a) => a.announcementId === announcementId).length;
          expect(used).toBeLessThanOrEqual(units.length);
        }
        expect(result.assignments.length + result.notAllocated.length).toBe(numbered.length);
        const drivers = result.assignments.map((a) => a.driverId);
        expect(new Set(drivers).size).toBe(drivers.length);
      }),
    );
  });
});
