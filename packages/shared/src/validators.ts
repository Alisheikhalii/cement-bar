import { enDigits } from './digits';

/** Iranian national code (کد ملی) checksum. */
export function isValidNationalId(raw: string): boolean {
  const code = enDigits(raw).trim();
  if (!/^\d{10}$/.test(code)) return false;
  if (/^(\d)\1{9}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits[9]!;
  const sum = digits.slice(0, 9).reduce((acc, d, i) => acc + d * (10 - i), 0);
  const r = sum % 11;
  return r < 2 ? check === r : check === 11 - r;
}

/** Iranian mobile: 09xxxxxxxxx (normalizes +98 / 0098 / 9xxxxxxxxx). Returns null if invalid. */
export function normalizeMobile(raw: string): string | null {
  let m = enDigits(raw).replace(/[\s-]/g, '');
  if (m.startsWith('+98')) m = '0' + m.slice(3);
  else if (m.startsWith('0098')) m = '0' + m.slice(4);
  else if (/^9\d{9}$/.test(m)) m = '0' + m;
  return /^09\d{9}$/.test(m) ? m : null;
}

/** IBAN (شبا) for Iran: "IR" + 24 digits, mod-97 check. */
export function isValidSheba(raw: string): boolean {
  const s = enDigits(raw).replace(/\s/g, '').toUpperCase();
  const full = s.startsWith('IR') ? s : `IR${s}`;
  if (!/^IR\d{24}$/.test(full)) return false;
  const rearranged = full.slice(4) + '1827' + full.slice(2, 4); // I=18 R=27
  let rem = 0;
  for (const ch of rearranged) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

export const PLATE_LETTERS = [
  'الف', 'ب', 'پ', 'ت', 'ث', 'ج', 'د', 'ز', 'س', 'ش', 'ص', 'ط', 'ع', 'ف', 'ق', 'ک', 'گ', 'ل', 'م', 'ن', 'و', 'ه', 'ی', 'ژ',
] as const;

export interface PlateParts {
  two: string; // 2 digits
  letter: string;
  three: string; // 3 digits
  iran: string; // 2 digits
}

/** Normalize plate parts → canonical "12ع345-67". Returns null if invalid. */
export function formatPlate(p: PlateParts): string | null {
  const two = enDigits(p.two);
  const three = enDigits(p.three);
  const iran = enDigits(p.iran);
  if (!/^\d{2}$/.test(two) || !/^\d{3}$/.test(three) || !/^\d{2}$/.test(iran)) return null;
  if (!(PLATE_LETTERS as readonly string[]).includes(p.letter)) return null;
  return `${two}${p.letter}${three}-${iran}`;
}

export function parsePlate(plate: string): PlateParts | null {
  const m = /^(\d{2})(\D+)(\d{3})-(\d{2})$/.exec(plate);
  if (!m) return null;
  return { two: m[1]!, letter: m[2]!, three: m[3]!, iran: m[4]! };
}

/** Days remaining from local ISO date `todayIso` until `isoDate` (negative if expired). */
export function daysUntil(isoDate: string, todayIso: string): number {
  const a = Date.parse(`${todayIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}
