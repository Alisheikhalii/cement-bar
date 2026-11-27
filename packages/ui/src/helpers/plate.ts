import { enDigits } from '@cb/shared';

export const PLATE_PART_LENGTH = { two: 2, three: 3, iran: 2 } as const;
export type PlateDigitPart = keyof typeof PLATE_PART_LENGTH;

/** Keep only digits (Persian/Arabic normalized to Latin) and cut to the part's length. */
export function sanitizePlateDigits(raw: string, part: PlateDigitPart): string {
  return enDigits(raw).replace(/\D/g, '').slice(0, PLATE_PART_LENGTH[part]);
}

/** Normalize free numeric input: Persian/Arabic digits → Latin, drop separators. */
export function normalizeNumeric(raw: string, allowDecimal = false): string {
  const latin = enDigits(raw).replace(/[٬,\s]/g, '').replace(/٫/g, '.');
  return allowDecimal ? latin.replace(/[^\d.]/g, '') : latin.replace(/\D/g, '');
}
