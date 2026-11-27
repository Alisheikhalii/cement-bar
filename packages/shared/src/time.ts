import { endOfMonth as jEndOfMonth, format as jFormat, newDate as jNewDate } from 'date-fns-jalali';
import { faDigits } from './digits';

export const BUSINESS_TZ = 'Asia/Tehran';

function parts(at: Date, tz: string): Record<string, string> {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
}

/** Offset in minutes of `tz` at instant `at` (e.g. Tehran = +210). */
export function tzOffsetMinutes(at: Date, tz: string = BUSINESS_TZ): number {
  const p = parts(at, tz);
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** ISO local date "YYYY-MM-DD" of instant `at` in the business timezone. */
export function localDate(at: Date, tz: string = BUSINESS_TZ): string {
  const p = parts(at, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Local "HH:mm" of instant `at` in the business timezone. */
export function localTime(at: Date, tz: string = BUSINESS_TZ): string {
  const p = parts(at, tz);
  return `${p.hour}:${p.minute}`;
}

/** Combine local ISO date + "HH:mm" (business tz) → UTC instant. */
export function localDateTimeToUtc(date: string, hhmm: string, tz: string = BUSINESS_TZ): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off = tzOffsetMinutes(guess, tz);
  const result = new Date(guess.getTime() - off * 60000);
  const off2 = tzOffsetMinutes(result, tz);
  return off2 === off ? result : new Date(guess.getTime() - off2 * 60000);
}

/** Iranian weekday of a local ISO date: 0=Saturday … 6=Friday. */
export function iranWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sunday
  return (js + 1) % 7;
}

export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Build a host-local Date whose wall-clock equals the business-tz wall-clock of `at`. */
function wallClock(at: Date, tz: string): Date {
  const p = parts(at, tz);
  return new Date(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
}

/** Jalali display of an instant in business tz: "۱۴۰۵/۰۹/۰۵". */
export function toJalali(at: Date | string, pattern = 'yyyy/MM/dd', tz: string = BUSINESS_TZ): string {
  const inst = typeof at === 'string' ? new Date(at) : at;
  return faDigits(jFormat(wallClock(inst, tz), pattern));
}

/** Jalali display of a local ISO date "2026-11-27" → "۱۴۰۵/۰۹/۰۶". */
export function isoDateToJalali(date: string, pattern = 'yyyy/MM/dd'): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number) as [number, number, number];
  return faDigits(jFormat(new Date(y, m - 1, d), pattern));
}

/** Jalali year-month key "1405-09" for quotas (Latin digits). */
export function jalaliYearMonth(at: Date, tz: string = BUSINESS_TZ): string {
  return jFormat(wallClock(at, tz), 'yyyy-MM');
}

export function formatDateTimeFa(at: Date | string): string {
  return toJalali(at, 'yyyy/MM/dd HH:mm');
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Jalali year-month "1405-09" of a local ISO date "2026-11-27" (quota month of an announcement). */
export function isoDateToJalaliYearMonth(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number) as [number, number, number];
  return jFormat(new Date(y, m - 1, d), 'yyyy-MM');
}

/** Gregorian local ISO date range [from, to] (inclusive) covered by Jalali month "1405-09". */
export function jalaliMonthRange(yearMonth: string): { from: string; to: string } {
  const [jy, jm] = yearMonth.split('-').map(Number) as [number, number];
  const first = jNewDate(jy, jm - 1, 1);
  return { from: isoOf(first), to: isoOf(jEndOfMonth(first)) };
}
