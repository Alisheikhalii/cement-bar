/**
 * Server-side list conventions (US-C3). Query string of every list endpoint:
 *   page=1&pageSize=50&sort=<columnId>:asc|desc&q=<free text>&format=json|xlsx
 *   f_<columnId>=<value>          per-column filter (see FilterKind)
 *     text   → case-insensitive "contains"
 *     number → exact, or range "10..20" / "10.." / "..20"
 *     enum   → one value, or comma list "A,B"
 *     date   → exact ISO date, or range "2026-11-01..2026-11-30"
 *     bool   → "true" | "false"
 *   cols=<id,id,…>                 (xlsx only) visible columns to export, in order
 * Resource-specific params (e.g. `view=active`) are documented per endpoint.
 */
export const FILTER_PREFIX = 'f_';
export const DEFAULT_PAGE_SIZE = 50;
export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;
/** Hard cap for xlsx export rows. */
export const XLSX_MAX_ROWS = 50_000;

export interface ListParams {
  page?: number;
  pageSize?: number;
  sort?: { id: string; desc: boolean } | null;
  q?: string;
  filters?: Record<string, string>;
  /** Extra resource-specific params. */
  extra?: Record<string, string | undefined>;
}

/** Builds the query string (without "?") for a list endpoint. */
export function buildListQuery(p: ListParams, format: 'json' | 'xlsx' = 'json', cols?: string[]): string {
  const sp = new URLSearchParams();
  if (p.page) sp.set('page', String(p.page));
  if (p.pageSize) sp.set('pageSize', String(p.pageSize));
  if (p.sort) sp.set('sort', `${p.sort.id}:${p.sort.desc ? 'desc' : 'asc'}`);
  if (p.q) sp.set('q', p.q);
  for (const [k, v] of Object.entries(p.filters ?? {})) if (v !== '') sp.set(`${FILTER_PREFIX}${k}`, v);
  for (const [k, v] of Object.entries(p.extra ?? {})) if (v !== undefined && v !== '') sp.set(k, v);
  if (format === 'xlsx') {
    sp.set('format', 'xlsx');
    if (cols?.length) sp.set('cols', cols.join(','));
  }
  return sp.toString();
}

/** Parses "a..b" / "a.." / "..b" / "a" into bounds. */
export function parseRange(v: string): { from?: string; to?: string; exact?: string } {
  if (!v.includes('..')) return { exact: v };
  const [from, to] = v.split('..');
  return { from: from || undefined, to: to || undefined };
}
