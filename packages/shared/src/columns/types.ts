/**
 * Table column contract (SPEC §2.4). One config drives:
 *  - the API list endpoint (which row keys to produce, which columns may be sorted/filtered),
 *  - the web DataTable (header, cell formatting, header filter),
 *  - the xlsx export (header text + value formatting).
 *
 * Rows travel as flat objects keyed by column id: `{ id, [col.id]: CellValue }`.
 * The API maps entities → rows; the web and the xlsx writer only read `row[col.id]`.
 */

/** JSON-safe cell value. Money (bigint) travels as a decimal string. Dates/times as ISO strings. */
export type CellValue = string | number | boolean | null;

export interface TableRow {
  id: string;
  [columnId: string]: CellValue;
}

export type ColumnType =
  | 'text'
  | 'number' // integer count
  | 'money' // rial, decimal string
  | 'weightKg' // integer kg, displayed in tonnes
  | 'date' // ISO local date "2026-11-27" → shown Jalali
  | 'time' // "HH:mm"
  | 'datetime' // ISO-8601 UTC instant → shown Jalali date + Tehran time
  | 'bool'
  | 'enum'; // value is an enum code, label from `enumLabels`

export type FilterKind = 'text' | 'number' | 'enum' | 'date' | 'bool';

export type ColumnSource =
  /** Prisma field on the root model or a to-one relation path, e.g. "truckCount", "carrier.name". Sortable/filterable. */
  | { kind: 'field'; path: string }
  /** Derived by the API (counts, joins, decrypted values …). Never sortable/filterable server-side. */
  | { kind: 'computed' }
  /** Key inside the entity's `extra` jsonb (rare spec columns). */
  | { kind: 'extra'; key: string }
  /** Depends on an out-of-scope v1 module (PRD §6.5): always null, shown as «—». */
  | { kind: 'unavailable' };

export interface ColumnSpec {
  id: string;
  /** Persian header (also the xlsx header). */
  label: string;
  type: ColumnType;
  source: ColumnSource;
  /** Only meaningful for `source.kind === 'field'`. */
  sortable?: boolean;
  /** Only meaningful for `source.kind === 'field'`. */
  filter?: FilterKind;
  enumLabels?: Readonly<Record<string, string>>;
  /** Shown by default (others are available in the column menu). Default false. */
  defaultVisible?: boolean;
  /** Hide in the mobile card layout. */
  hideOnMobile?: boolean;
}

export const defineColumns = <const T extends readonly ColumnSpec[]>(cols: T): T => cols;

/** Column ids that the server may sort/filter on (field-sourced, flagged). */
export function sortableColumns(cols: readonly ColumnSpec[]): ColumnSpec[] {
  return cols.filter((c) => c.source.kind === 'field' && c.sortable);
}
export function filterableColumns(cols: readonly ColumnSpec[]): ColumnSpec[] {
  return cols.filter((c) => c.source.kind === 'field' && c.filter);
}
export function defaultVisibility(cols: readonly ColumnSpec[]): Record<string, boolean> {
  return Object.fromEntries(cols.map((c) => [c.id, c.defaultVisible === true]));
}
