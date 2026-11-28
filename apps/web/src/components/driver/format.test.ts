import { describe, expect, it } from 'vitest';
import { alertContent, hallTime, matchesQuery, plateFa } from './format';

describe('alertContent', () => {
  it('includes the carrier reason for a rejected account', () => {
    expect(alertContent({ kind: 'REJECTED', tone: 'danger', reason: 'مدارک ناقص' }).body).toContain(
      'مدارک ناقص',
    );
  });

  it('falls back to a default text when no reason is stored', () => {
    expect(alertContent({ kind: 'BLOCKED', tone: 'danger', reason: null }).body).toContain(
      'علتی ثبت نشده است',
    );
  });

  it('names the document and the Persian day count for expiring documents', () => {
    const c = alertContent({
      kind: 'DOCUMENT_EXPIRING',
      tone: 'warning',
      document: 'SMART_CARD',
      daysLeft: 12,
    });
    expect(c.title).toContain('کارت هوشمند');
    expect(c.body).toContain('۱۲');
  });
});

describe('hallTime', () => {
  it('shows Tehran local time in Persian digits', () => {
    expect(hallTime('2026-11-28T04:30:00.000Z', '2026-11-28')).toBe('۰۸:۰۰');
  });

  it('marks an end that falls on the next local day', () => {
    expect(hallTime('2026-11-28T22:30:00.000Z', '2026-11-28')).toBe('۰۲:۰۰ (روز بعد)');
  });
});

describe('plateFa / matchesQuery', () => {
  it('formats a normalised plate', () => {
    expect(plateFa('65ع576-98')).toBe('۶۵ ع ۵۷۶ - ایران ۹۸');
  });

  it('matches Arabic/Persian letter variants and ignores ZWNJ', () => {
    expect(matchesQuery('باربری نی‌ریز', 'نی ریز')).toBe(true);
    expect(matchesQuery('متحده بختگان', 'كرمان')).toBe(false);
    expect(matchesQuery('ريحان', 'ریحان')).toBe(true);
  });
});

describe('errorField', () => {
  it('reads a domain field or the first zod issue path', async () => {
    const { errorField } = await import('./format');
    expect(errorField({ field: 'vehicle.plate' })).toBe('vehicle.plate');
    expect(errorField({ issues: [{ path: 'healthCardExpiry', message: 'x' }] })).toBe('healthCardExpiry');
    expect(errorField({ issues: [{ path: '', message: 'x' }] })).toBeUndefined();
    expect(errorField(undefined)).toBeUndefined();
  });
});
