const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

/** Convert Latin digits to Persian digits for display. */
export function faDigits(input: string | number | bigint): string {
  return String(input).replace(/[0-9]/g, (d) => FA[Number(d)] ?? d);
}

/** Normalize Persian/Arabic digits to Latin (for inputs). */
export function enDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));
}

/** 1250000 → "۱٬۲۵۰٬۰۰۰" */
export function faNumber(n: number | bigint | string): string {
  const s = typeof n === 'string' ? enDigits(n) : n.toString();
  const neg = s.startsWith('-');
  const raw = neg ? s.slice(1) : s;
  let body = '';
  for (let i = 0; i < raw.length; i++) {
    if (i > 0 && (raw.length - i) % 3 === 0) body += '٬';
    body += raw[i];
  }
  return faDigits((neg ? '-' : '') + body);
}

export function formatRial(n: number | bigint | string): string {
  return `${faNumber(n)} ریال`;
}

/** kg → "۲۵ تن" (integer kg; shows up to 2 decimals) */
export function formatTon(kg: number): string {
  const t = kg / 1000;
  return `${faDigits(Number.isInteger(t) ? t : t.toFixed(2))} تن`;
}
