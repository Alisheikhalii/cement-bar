import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_COLUMNS,
  ANNOUNCEMENT_COLUMNS,
  PERMIT_COLUMNS,
  announcementInputSchema,
  buildListQuery,
  driverDecisionSchema,
  hallScheduleReplaceSchema,
  parseRange,
  unitAllocationChangeSchema,
  type ColumnSpec,
} from '../src';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('column configs', () => {
  for (const [name, cols] of Object.entries({ ANNOUNCEMENT_COLUMNS, PERMIT_COLUMNS, AGGREGATE_COLUMNS })) {
    it(`${name}: unique ids, sort/filter only on field columns, enum columns have labels`, () => {
      const list = cols as readonly ColumnSpec[];
      expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
      for (const c of list) {
        if (c.sortable || c.filter) expect(c.source.kind, c.id).toBe('field');
        if (c.type === 'enum') expect(c.enumLabels, c.id).toBeDefined();
        expect(c.label.length, c.id).toBeGreaterThan(0);
      }
      expect(list.some((c) => c.defaultVisible)).toBe(true);
    });
  }
  it('announcement columns cover the spec list (§4.2 has 65 data columns + weightTo)', () => {
    expect(ANNOUNCEMENT_COLUMNS.length).toBeGreaterThanOrEqual(66);
  });
});

describe('list query helpers', () => {
  it('builds query strings with filters and export columns', () => {
    const q = buildListQuery(
      { page: 2, pageSize: 50, sort: { id: 'number', desc: true }, filters: { status: 'ACTIVE', carrierName: '' }, extra: { view: 'active' } },
      'xlsx',
      ['number', 'hall'],
    );
    const sp = new URLSearchParams(q);
    expect(sp.get('sort')).toBe('number:desc');
    expect(sp.get('f_status')).toBe('ACTIVE');
    expect(sp.has('f_carrierName')).toBe(false);
    expect(sp.get('view')).toBe('active');
    expect(sp.get('format')).toBe('xlsx');
    expect(sp.get('cols')).toBe('number,hall');
  });
  it('parses ranges', () => {
    expect(parseRange('10..20')).toEqual({ from: '10', to: '20' });
    expect(parseRange('..20')).toEqual({ from: undefined, to: '20' });
    expect(parseRange('7')).toEqual({ exact: '7' });
  });
});

const validAnnouncement = {
  announceDate: '2026-11-27',
  announceTime: '08:00',
  hallId: U(1),
  productId: U(2),
  packagingTypeId: U(3),
  cargoValue: 1_000_000_000,
  loadingLocationId: U(4),
  loaderTypeId: U(5),
  truckCount: 10,
  weightFromKg: 25_000,
  weightToKg: 28_000,
  destFareType: 'عادی',
  farePerTruck: 150_000_000,
  description: 'سیمان تیپ ۲',
};

describe('announcementInputSchema', () => {
  it('accepts a minimal valid form and applies defaults', () => {
    const r = announcementInputSchema.parse(validAnnouncement);
    expect(r.fareCalc).toBe('PER_TRUCK');
    expect(r.isFreeOutsideDestinations).toBe(false);
    expect(r.extra).toEqual({ loadingType: undefined });
  });
  it('rejects scope ids smuggled in the body (strict)', () => {
    expect(announcementInputSchema.safeParse({ ...validAnnouncement, carrierId: U(9) }).success).toBe(false);
  });
  it('rejects weightFrom > weightTo and missing fare for the chosen calc', () => {
    expect(announcementInputSchema.safeParse({ ...validAnnouncement, weightFromKg: 30_000 }).success).toBe(false);
    expect(announcementInputSchema.safeParse({ ...validAnnouncement, fareCalc: 'PER_TON' }).success).toBe(false);
  });
  it('rejects fractional money (rial must be integer)', () => {
    expect(announcementInputSchema.safeParse({ ...validAnnouncement, cargoValue: 10.5 }).success).toBe(false);
  });
});

describe('other contracts', () => {
  it('driver rejection requires a note', () => {
    expect(driverDecisionSchema.safeParse({ decision: 'REJECT' }).success).toBe(false);
    expect(driverDecisionSchema.safeParse({ decision: 'APPROVE' }).success).toBe(true);
  });
  it('hall schedule: ordered times, unique weekdays', () => {
    const item = { weekday: 0, t0: '06:00', priorityEnd: '06:30', hallEnd: '14:00' };
    expect(hallScheduleReplaceSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(hallScheduleReplaceSchema.safeParse({ items: [item, item] }).success).toBe(false);
    expect(hallScheduleReplaceSchema.safeParse({ items: [{ ...item, hallEnd: '05:00' }] }).success).toBe(false);
  });
  it('allocation change requires a reason', () => {
    expect(unitAllocationChangeSchema.safeParse({ to: 'FREE' }).success).toBe(false);
    expect(unitAllocationChangeSchema.safeParse({ to: 'FREE', reason: 'مقصد خارج از فهرست' }).success).toBe(true);
  });
});
