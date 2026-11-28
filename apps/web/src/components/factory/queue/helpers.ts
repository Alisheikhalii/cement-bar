/** Pure helpers of the factory queue screens (bulk fairness report); unit tested. */
import { enDigits, type BulkFairnessRowDto, type BulkWindowKind } from '@cb/shared';

export interface FairnessGroup {
  key: string;
  date: string;
  carrierName: string;
  groupTitle: string;
  windowSeq: number;
  round: number;
  kind: BulkWindowKind;
  rows: BulkFairnessRowDto[];
}

/** Groups rows that share date + carrier + window (seq/round/kind) + group, preserving arrival order. */
export function groupFairnessRows(rows: readonly BulkFairnessRowDto[]): FairnessGroup[] {
  const map = new Map<string, FairnessGroup>();
  for (const r of rows) {
    const key = `${r.date}|${r.carrierName}|${r.windowSeq}|${r.round}|${r.kind}|${r.groupTitle}`;
    const existing = map.get(key);
    if (existing) {
      existing.rows.push(r);
      continue;
    }
    map.set(key, {
      key,
      date: r.date,
      carrierName: r.carrierName,
      groupTitle: r.groupTitle,
      windowSeq: r.windowSeq,
      round: r.round,
      kind: r.kind,
      rows: [r],
    });
  }
  return [...map.values()];
}

/** Normalizes Persian/Arabic letter variants and ZWNJ so search is forgiving. */
export function normalizeFa(s: string): string {
  return s
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/‌/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface FairnessFilters {
  carrierName: string;
  groupTitle: string;
  driverSearch: string;
}

/** Client-side filter of a fairness row by carrier, group and driver name/plate search. */
export function matchesFairnessFilters(row: BulkFairnessRowDto, f: FairnessFilters): boolean {
  if (f.carrierName && row.carrierName !== f.carrierName) return false;
  if (f.groupTitle && row.groupTitle !== f.groupTitle) return false;
  const needle = normalizeFa(f.driverSearch);
  if (!needle) return true;
  if (normalizeFa(row.driverName).includes(needle)) return true;
  if (!row.plate) return false;
  return normalizeFa(enDigits(row.plate)).includes(normalizeFa(enDigits(f.driverSearch.trim())));
}

/** Unique, sorted option list of a string field across rows. */
export function uniqueValues(rows: readonly BulkFairnessRowDto[], pick: (r: BulkFairnessRowDto) => string): string[] {
  return [...new Set(rows.map(pick))].sort((a, b) => a.localeCompare(b, 'fa'));
}
