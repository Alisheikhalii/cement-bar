import { describe, expect, it } from 'vitest';
import {
  isValidNationalId,
  normalizeMobile,
  isValidSheba,
  formatPlate,
  parsePlate,
  daysUntil,
} from '../src/validators';
import { faDigits, enDigits, faNumber, formatRial } from '../src/digits';
import {
  localDate,
  localTime,
  localDateTimeToUtc,
  iranWeekday,
  addDaysIso,
  isoDateToJalali,
  jalaliYearMonth,
  tzOffsetMinutes,
} from '../src/time';
import { registerDriverSchema, loginSchema } from '../src/schemas';

describe('validators', () => {
  it('national id checksum', () => {
    expect(isValidNationalId('0499370899')).toBe(true);
    expect(isValidNationalId('۰۴۹۹۳۷۰۸۹۹')).toBe(true);
    expect(isValidNationalId('0499370898')).toBe(false);
    expect(isValidNationalId('1111111111')).toBe(false);
    expect(isValidNationalId('123')).toBe(false);
  });
  it('mobile normalization', () => {
    expect(normalizeMobile('+989171234567')).toBe('09171234567');
    expect(normalizeMobile('00989171234567')).toBe('09171234567');
    expect(normalizeMobile('9171234567')).toBe('09171234567');
    expect(normalizeMobile('۰۹۱۷۱۲۳۴۵۶۷')).toBe('09171234567');
    expect(normalizeMobile('0217123456')).toBeNull();
  });
  it('sheba mod97', () => {
    expect(isValidSheba('IR062960000000100324200001')).toBe(true);
    expect(isValidSheba('IR062960000000100324200002')).toBe(false);
    expect(isValidSheba('062960000000100324200001')).toBe(true);
  });
  it('plate format/parse roundtrip', () => {
    const f = formatPlate({ two: '65', letter: 'ع', three: '576', iran: '98' });
    expect(f).toBe('65ع576-98');
    expect(parsePlate(f!)).toEqual({ two: '65', letter: 'ع', three: '576', iran: '98' });
    expect(formatPlate({ two: '6', letter: 'ع', three: '576', iran: '98' })).toBeNull();
    expect(formatPlate({ two: '65', letter: 'X', three: '576', iran: '98' })).toBeNull();
  });
  it('daysUntil', () => {
    expect(daysUntil('2026-12-01', '2026-11-27')).toBe(4);
    expect(daysUntil('2026-11-20', '2026-11-27')).toBe(-7);
  });
});

describe('digits', () => {
  it('converts both ways', () => {
    expect(faDigits(1405)).toBe('۱۴۰۵');
    expect(enDigits('۱۴۰۵/٠٩')).toBe('1405/09');
    expect(faNumber(1250000)).toBe('۱٬۲۵۰٬۰۰۰');
    expect(faNumber(-1000n)).toBe('-۱٬۰۰۰');
    expect(formatRial('20000')).toBe('۲۰٬۰۰۰ ریال');
  });
});

describe('time (Asia/Tehran)', () => {
  const at = new Date('2026-11-27T03:00:00Z'); // 06:30 Tehran
  it('offset is +03:30', () => expect(tzOffsetMinutes(at)).toBe(210));
  it('local date/time', () => {
    expect(localDate(at)).toBe('2026-11-27');
    expect(localTime(at)).toBe('06:30');
    expect(localDate(new Date('2026-11-27T21:00:00Z'))).toBe('2026-11-28');
  });
  it('local → utc', () => {
    expect(localDateTimeToUtc('2026-11-27', '06:30').toISOString()).toBe('2026-11-27T03:00:00.000Z');
  });
  it('iran weekday (Fri 2026-11-27 = 6)', () => {
    expect(iranWeekday('2026-11-27')).toBe(6);
    expect(iranWeekday('2026-11-28')).toBe(0);
  });
  it('addDays and jalali', () => {
    expect(addDaysIso('2026-11-30', 2)).toBe('2026-12-02');
    expect(isoDateToJalali('2026-11-27')).toBe('۱۴۰۵/۰۹/۰۶');
    expect(jalaliYearMonth(at)).toBe('1405-09');
  });
});

describe('schemas', () => {
  it('login is strict', () => {
    expect(loginSchema.safeParse({ identifier: 'admin', password: 'x', role: 'X' }).success).toBe(false);
  });
  it('register driver normalizes mobile, plate, national id', () => {
    const r = registerDriverSchema.safeParse({
      mobile: '۰۹۱۷۱۲۳۴۵۶۷',
      password: 'secret123',
      firstName: 'امین',
      lastName: 'بهمنی',
      nationalId: '۰۴۹۹۳۷۰۸۹۹',
      licenseNo: '9500460721',
      licenseIssueDate: '2020-01-01',
      birthCityId: 1,
      healthCardExpiry: '2027-02-01',
      carrierId: '00000000-0000-4000-8000-000000000001',
      vehicle: {
        smartCardNo: '2995585',
        plate: { two: '65', letter: 'ع', three: '576', iran: '98' },
        loaderTypeId: '00000000-0000-4000-8000-000000000002',
        smartCardExpiry: '2027-01-01',
        inspectionExpiry: '2027-01-01',
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.mobile).toBe('09171234567');
      expect(r.data.nationalId).toBe('0499370899');
      expect(r.data.vehicle.plate).toBe('65ع576-98');
    }
  });
});
