import { describe, expect, it } from 'vitest';
import type { DriverLoadDto } from '@cb/shared';
import { parseQueueSseEvent } from '@/lib/useQueueEvents';
import { filterLoads, filterTurnsByStatus, loadStatus, movePriority, togglePriority } from './helpers';

function load(over: Partial<DriverLoadDto>): DriverLoadDto {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    number: 12,
    carrierId: 'c1',
    carrierName: 'باربری نمونه',
    hallId: 'h1',
    hallTitle: 'سالن کیسه‌ای',
    hallCategory: 'BAG',
    productTitle: 'سیمان پاکتی',
    packagingTitle: 'کیسه ۵۰ کیلویی',
    loaderTitles: ['کفی'],
    destinationTitle: 'شیراز',
    originTitle: 'نی‌ریز',
    announceDate: '2026-11-28',
    announceTime: '07:00',
    truckCount: 10,
    weightFromKg: 25000,
    weightToKg: 27000,
    fareRial: '34500000',
    allocation: 'TIMED',
    totalUnits: 10,
    openUnits: 5,
    reservedUnits: 5,
    fullyReserved: false,
    myReservedUnitId: null,
    isReservable: true,
    blockReason: null,
    ...over,
  };
}

describe('priority helpers', () => {
  it('adds up to three distinct announcements and removes an existing one', () => {
    let ids: string[] = [];
    ids = togglePriority(ids, 'a');
    ids = togglePriority(ids, 'b');
    ids = togglePriority(ids, 'c');
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(togglePriority(ids, 'd')).toEqual(['a', 'b', 'c']);
    expect(togglePriority(ids, 'b')).toEqual(['a', 'c']);
  });

  it('moves a priority and ignores out-of-range moves', () => {
    expect(movePriority(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(movePriority(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(movePriority(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(movePriority(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
    expect(movePriority(['a'], 0, 1)).toEqual(['a']);
  });
});

describe('filterTurnsByStatus', () => {
  const turns = [
    { id: '1', status: 'WAITING' as const },
    { id: '2', status: 'ALLOCATED' as const },
    { id: '3', status: 'NOT_ALLOCATED' as const },
  ];

  it('returns everything for ALL and only the selected status otherwise', () => {
    expect(filterTurnsByStatus(turns, 'ALL').map((t) => t.id)).toEqual(['1', '2', '3']);
    expect(filterTurnsByStatus(turns, 'ALLOCATED').map((t) => t.id)).toEqual(['2']);
    expect(filterTurnsByStatus(turns, 'CANCELLED')).toEqual([]);
  });
});

describe('filterLoads', () => {
  const loads = [
    load({ id: '1', allocation: 'TIMED', destinationTitle: 'شیراز', carrierName: 'حمل سریع' }),
    load({ id: '2', allocation: 'FREE', destinationTitle: 'سیرجان', carrierName: 'ب' }),
    load({ id: '3', allocation: 'GROUP', destinationTitle: 'آباده', carrierName: 'ج' }),
  ];

  it('filters by allocation', () => {
    expect(filterLoads(loads, { allocation: 'FREE', q: '' }).map((x) => x.id)).toEqual(['2']);
    expect(filterLoads(loads, { allocation: 'ALL', q: '' })).toHaveLength(3);
  });

  it('searches destination, carrier and product with Persian normalization', () => {
    expect(filterLoads(loads, { allocation: 'ALL', q: 'شيراز' }).map((x) => x.id)).toEqual(['1']);
    expect(filterLoads(loads, { allocation: 'ALL', q: 'حمل' }).map((x) => x.id)).toEqual(['1']);
    expect(filterLoads(loads, { allocation: 'ALL', q: '۱۲' }).map((x) => x.id)).toEqual([]);
    expect(filterLoads(loads, { allocation: 'ALL', q: '12' })).toHaveLength(3);
  });
});

describe('loadStatus', () => {
  it('prefers my reservation over the reserved tag and the allocation label', () => {
    expect(loadStatus(load({ myReservedUnitId: 'u1', fullyReserved: true })).kind).toBe('MINE');
    expect(loadStatus(load({ fullyReserved: true })).kind).toBe('FULL');
    expect(loadStatus(load({ allocation: 'GROUP' }))).toMatchObject({ kind: 'ALLOCATION', tone: 'purple' });
  });
});

describe('parseQueueSseEvent', () => {
  it('builds the shared event shape from the named event and JSON body', () => {
    const ev = parseQueueSseEvent(
      'unit.reserved',
      JSON.stringify({ tenantId: 't1', hallId: 'h1', at: '2026-11-28T07:00:00.000Z', payload: { unitId: 'u1' } }),
    );
    expect(ev).toEqual({
      type: 'unit.reserved',
      tenantId: 't1',
      hallId: 'h1',
      userId: undefined,
      at: '2026-11-28T07:00:00.000Z',
      payload: { unitId: 'u1' },
    });
  });

  it('ignores malformed payloads', () => {
    expect(parseQueueSseEvent('notification', 'not-json')).toBeNull();
    expect(parseQueueSseEvent('notification', 'null')).toBeNull();
    expect(parseQueueSseEvent('notification', JSON.stringify({ payload: [] }))).toMatchObject({
      type: 'notification',
      payload: {},
    });
  });
});
