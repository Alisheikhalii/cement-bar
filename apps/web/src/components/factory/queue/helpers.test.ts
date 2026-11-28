import { describe, expect, it } from 'vitest';
import type { BulkFairnessRowDto } from '@cb/shared';
import { groupFairnessRows, matchesFairnessFilters, normalizeFa, uniqueValues } from './helpers';

const row = (over: Partial<BulkFairnessRowDto> = {}): BulkFairnessRowDto => ({
  date: '2026-11-28',
  carrierName: 'باربری الف',
  groupTitle: 'گروه ۱',
  windowSeq: 1,
  round: 1,
  kind: 'HEAD',
  driverName: 'علی رضایی',
  plate: '12ب345-67',
  announcementNumber: 100,
  destinationTitle: 'شیراز',
  reservedAt: '2026-11-28T05:00:00.000Z',
  ...over,
});

describe('groupFairnessRows', () => {
  it('groups rows of the same date, carrier, window and group', () => {
    const groups = groupFairnessRows([row(), row({ driverName: 'رضا محمدی' }), row({ windowSeq: 2, kind: 'FREE' })]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.rows).toHaveLength(2);
    expect(groups[0]?.kind).toBe('HEAD');
    expect(groups[1]?.windowSeq).toBe(2);
  });

  it('keeps distinct carriers and group titles apart', () => {
    const groups = groupFairnessRows([row(), row({ carrierName: 'باربری ب' }), row({ groupTitle: 'گروه ۲' })]);
    expect(groups).toHaveLength(3);
    expect(groups[0]?.carrierName).toBe('باربری الف');
  });
});

describe('matchesFairnessFilters', () => {
  it('filters by carrier and group', () => {
    expect(matchesFairnessFilters(row(), { carrierName: 'باربری الف', groupTitle: '', driverSearch: '' })).toBe(true);
    expect(matchesFairnessFilters(row(), { carrierName: 'باربری ب', groupTitle: '', driverSearch: '' })).toBe(false);
    expect(matchesFairnessFilters(row(), { carrierName: '', groupTitle: 'گروه ۲', driverSearch: '' })).toBe(false);
  });

  it('matches Persian/Arabic letter variants and the plate', () => {
    expect(matchesFairnessFilters(row({ driverName: 'ریحان' }), { carrierName: '', groupTitle: '', driverSearch: 'ريحان' })).toBe(true);
    expect(matchesFairnessFilters(row(), { carrierName: '', groupTitle: '', driverSearch: '12ب' })).toBe(true);
    expect(matchesFairnessFilters(row(), { carrierName: '', groupTitle: '', driverSearch: 'کرمان' })).toBe(false);
  });
});

describe('normalizeFa / uniqueValues', () => {
  it('normalizes ZWNJ, Arabic kaf/yeh and spaces', () => {
    expect(normalizeFa('نی‌ریز')).toBe('نی ریز');
    expect(normalizeFa('كرمان  یزد')).toBe('کرمان یزد');
  });

  it('returns unique values', () => {
    const values = uniqueValues([row(), row(), row({ carrierName: 'باربری ب' })], (r) => r.carrierName);
    expect(values).toHaveLength(2);
    expect(values).toContain('باربری الف');
    expect(values).toContain('باربری ب');
  });
});
