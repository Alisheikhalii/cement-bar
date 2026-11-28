import {
  addDaysIso,
  DEFAULT_PAGE_SIZE,
  FILTER_PREFIX,
  localDateTimeToUtc,
  parseRange,
  XLSX_MAX_ROWS,
  type ColumnSpec,
} from '@cb/shared';
import { DomainError } from '../errors/domain-error';

/** Generic Prisma fragments (callers cast to their model's WhereInput/OrderByInput). */
export type WhereFragment = Record<string, unknown>;
export type OrderByFragment = Record<string, unknown>;

export interface ParsedList {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  format: 'json' | 'xlsx';
  /** Free-text search (each resource decides which fields it searches). */
  q?: string;
  /** Raw validated filter values by column id. */
  filters: Record<string, string>;
  /** AND-able Prisma where fragments built from the column filters. */
  where: WhereFragment[];
  /** Prisma orderBy built from `sort` (empty → caller's default). */
  orderBy: OrderByFragment[];
  /** xlsx: requested visible columns in order (validated). */
  cols?: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INT = /^-?\d+$/;
const SORT_RE = /^([A-Za-z0-9_]+):(asc|desc)$/;
const RESERVED = new Set(['page', 'pageSize', 'sort', 'q', 'format', 'cols']);

function invalid(field: string, message: string): never {
  throw new DomainError('VALIDATION_FAILED', { issues: [{ path: field, message }] });
}

/** "carrier.name" + leaf → { carrier: { name: leaf } } */
export function nestPath(path: string, leaf: unknown): Record<string, unknown> {
  return path
    .split('.')
    .reverse()
    .reduce<unknown>((acc, key) => ({ [key]: acc }), leaf) as Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return str(v[v.length - 1]);
  return typeof v === 'string' ? v : undefined;
}

function filterCondition(col: ColumnSpec, raw: string): unknown {
  const field = `${FILTER_PREFIX}${col.id}`;
  switch (col.filter) {
    case 'text': {
      const v = raw.trim();
      if (v.length > 100) invalid(field, 'too long');
      return { contains: v, mode: 'insensitive' };
    }
    case 'number': {
      const r = parseRange(raw);
      const num = (s: string | undefined) => {
        if (s === undefined) return undefined;
        if (!INT.test(s)) invalid(field, 'not an integer');
        return Number(s);
      };
      if (r.exact !== undefined) return { equals: num(r.exact) };
      return { gte: num(r.from), lte: num(r.to) };
    }
    case 'enum': {
      const allowed = Object.keys(col.enumLabels ?? {});
      const values = raw.split(',').filter(Boolean);
      if (!values.length || values.some((v) => !allowed.includes(v))) invalid(field, 'unknown value');
      return { in: values };
    }
    case 'date': {
      const r = parseRange(raw);
      const from = r.exact ?? r.from;
      const to = r.exact ?? r.to;
      for (const d of [from, to]) if (d !== undefined && !ISO_DATE.test(d)) invalid(field, 'invalid date');
      if (col.type === 'datetime') {
        // Local business days → UTC instants: [from 00:00, to+1 00:00)
        return {
          gte: from ? localDateTimeToUtc(from, '00:00') : undefined,
          lt: to ? localDateTimeToUtc(addDaysIso(to, 1), '00:00') : undefined,
        };
      }
      return { gte: from, lte: to }; // ISO local-date strings compare lexicographically
    }
    case 'bool':
      if (raw !== 'true' && raw !== 'false') invalid(field, 'expected true|false');
      return { equals: raw === 'true' };
    default:
      return invalid(field, 'not filterable');
  }
}

/**
 * Parses a list request (see @cb/shared list.ts) against a column config.
 * Only field-sourced columns flagged sortable/filterable are accepted; anything else → 400.
 * Resource-specific params must be listed in `allowParams` (e.g. ['view']) and are read by the caller.
 */
export function parseListQuery(
  raw: Record<string, unknown>,
  columns: readonly ColumnSpec[],
  opts: { allowParams?: string[] } = {},
): ParsedList {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const allow = new Set(opts.allowParams ?? []);

  const format = str(raw.format) ?? 'json';
  if (format !== 'json' && format !== 'xlsx') invalid('format', 'json|xlsx');
  const page = Number(str(raw.page) ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 100_000) invalid('page', 'invalid page');
  const pageSize = Number(str(raw.pageSize) ?? DEFAULT_PAGE_SIZE);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) invalid('pageSize', '1..200');

  const orderBy: OrderByFragment[] = [];
  const sort = str(raw.sort);
  if (sort) {
    const m = SORT_RE.exec(sort);
    const col = m ? byId.get(m[1]!) : undefined;
    if (!m || !col || col.source.kind !== 'field' || !col.sortable) invalid('sort', 'column is not sortable');
    orderBy.push(nestPath(col.source.path, m[2]));
  }

  const q = str(raw.q)?.trim() || undefined;
  if (q && q.length > 100) invalid('q', 'too long');

  const filters: Record<string, string> = {};
  const where: WhereFragment[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (RESERVED.has(key) || allow.has(key)) continue;
    if (!key.startsWith(FILTER_PREFIX)) invalid(key, 'unknown parameter');
    const id = key.slice(FILTER_PREFIX.length);
    const col = byId.get(id);
    const v = str(value);
    if (!col || col.source.kind !== 'field' || !col.filter) invalid(key, 'column is not filterable');
    if (v === undefined || v === '') continue;
    filters[id] = v;
    where.push(nestPath(col.source.path, filterCondition(col, v)));
  }

  let cols: string[] | undefined;
  const rawCols = str(raw.cols);
  if (rawCols) {
    cols = rawCols.split(',').filter(Boolean);
    if (cols.length > columns.length || cols.some((c) => !byId.has(c))) invalid('cols', 'unknown column');
  }

  const xlsx = format === 'xlsx';
  return {
    page,
    pageSize,
    skip: xlsx ? 0 : (page - 1) * pageSize,
    take: xlsx ? XLSX_MAX_ROWS : pageSize,
    format: format as 'json' | 'xlsx',
    q,
    filters,
    where,
    orderBy,
    cols,
  };
}
