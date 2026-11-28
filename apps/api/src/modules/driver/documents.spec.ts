import { describe, expect, it } from 'vitest';
import { dateOnlyIso, documentAlerts, documentLevel, documentStatus, isRealIsoDate } from './documents';

describe('documentLevel (Q-B5 thresholds)', () => {
  it.each([
    [400, 'success'],
    [61, 'success'],
    [60, 'warning'],
    [30, 'warning'],
    [15, 'warning'],
    [14, 'danger'],
    [0, 'danger'],
    [-1, 'expired'],
  ] as const)('%i days → %s', (days, level) => {
    expect(documentLevel(days)).toBe(level);
  });
});

describe('documentStatus', () => {
  it('computes days left against the given local today', () => {
    expect(documentStatus('SMART_CARD', '2026-12-28', '2026-11-28')).toEqual({
      kind: 'SMART_CARD',
      expiry: '2026-12-28',
      daysLeft: 30,
      level: 'warning',
    });
  });

  it('an expiry of today is still valid (0 days, danger), yesterday is expired', () => {
    expect(documentStatus('INSPECTION', '2026-11-28', '2026-11-28').level).toBe('danger');
    expect(documentStatus('INSPECTION', '2026-11-27', '2026-11-28').level).toBe('expired');
  });
});

describe('documentAlerts', () => {
  it('emits expired and expiring alerts, nothing for valid documents', () => {
    const today = '2026-11-28';
    const alerts = documentAlerts([
      documentStatus('HEALTH_CARD', '2027-06-01', today),
      documentStatus('SMART_CARD', '2026-12-10', today),
      documentStatus('INSPECTION', '2026-11-01', today),
    ]);
    expect(alerts).toEqual([
      { kind: 'DOCUMENT_EXPIRING', tone: 'danger', document: 'SMART_CARD', daysLeft: 12 },
      { kind: 'DOCUMENT_EXPIRED', tone: 'danger', document: 'INSPECTION', daysLeft: -27 },
    ]);
    expect(documentAlerts([documentStatus('SMART_CARD', '2027-01-07', today)])[0]?.tone).toBe('warning');
  });
});

describe('date helpers', () => {
  it('isRealIsoDate rejects impossible calendar dates', () => {
    expect(isRealIsoDate('2026-02-28')).toBe(true);
    expect(isRealIsoDate('2026-02-30')).toBe(false);
    expect(isRealIsoDate('2026-13-01')).toBe(false);
  });

  it('dateOnlyIso keeps the stored calendar date', () => {
    expect(dateOnlyIso(new Date('2026-11-28T00:00:00.000Z'))).toBe('2026-11-28');
  });
});
