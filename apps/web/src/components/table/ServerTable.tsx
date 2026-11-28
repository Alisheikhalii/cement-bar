'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ColumnDef, SortingState, VisibilityState } from '@tanstack/react-table';
import { Download, RefreshCw } from 'lucide-react';
import {
  Button3D,
  DataTable,
  JalaliDatePicker,
  Select,
  TextInput,
  useToast,
  type Tone,
} from '@cb/ui';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  buildListQuery,
  defaultVisibility,
  faDigits,
  type ColumnSpec,
  type Paginated,
  type TableRow,
} from '@cb/shared';
import { fa } from '@/i18n/fa';
import { api, errorMessage } from '@/lib/api';
import { ErrorState } from '@/components/StateViews';
import { formatCell } from './cells';

/** React Query key prefix — invalidate with `queryClient.invalidateQueries({ queryKey: tableQueryKey(endpoint) })`. */
export const tableQueryKey = (endpoint: string) => ['table', endpoint] as const;

export interface ServerTableProps {
  /** API path without /api, e.g. "/carrier/announcements". */
  endpoint: string;
  columns: readonly ColumnSpec[];
  /** localStorage key for column visibility / page size (unique per table). */
  storageKey: string;
  /** Resource-specific params (e.g. { view: 'active' }); changing them resets to page 1. */
  params?: Record<string, string | undefined>;
  /** Extra non-config columns (e.g. row actions), appended at the end. */
  extraColumns?: ColumnDef<TableRow, unknown>[];
  toolbar?: ReactNode;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  rowTone?: (row: TableRow) => Tone;
  /** Filename hint for the export button label only (server names the file). */
  caption?: string;
  defaultSort?: { id: string; desc: boolean };
}

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode) — keep in memory only
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function HeaderFilterInput({ col, value, onChange }: { col: ColumnSpec; value: string; onChange: (v: string) => void }) {
  const id = `f-${col.id}`;
  switch (col.filter) {
    case 'enum':
    case 'bool': {
      const options =
        col.filter === 'bool'
          ? [
              { value: 'true', label: fa.table.yes },
              { value: 'false', label: fa.table.no },
            ]
          : Object.entries(col.enumLabels ?? {}).map(([v, label]) => ({ value: v, label }));
      return (
        <Select
          id={id}
          aria-label={col.label}
          value={value || '__all'}
          onValueChange={(v) => onChange(v === '__all' ? '' : v)}
          options={[{ value: '__all', label: fa.table.all }, ...options]}
        />
      );
    }
    case 'date': {
      const [from = '', to = ''] = value.includes('..') ? value.split('..') : [value, value];
      const set = (f: string, t: string) => onChange(f || t ? `${f}..${t}` : '');
      return (
        <div className="space-y-2">
          <label className="block text-label-md text-text-secondary" htmlFor={`${id}-from`}>
            {fa.table.from}
          </label>
          <JalaliDatePicker id={`${id}-from`} value={from} onChange={(v) => set(v, to)} />
          <label className="block text-label-md text-text-secondary" htmlFor={`${id}-to`}>
            {fa.table.to}
          </label>
          <JalaliDatePicker id={`${id}-to`} value={to} onChange={(v) => set(from, v)} />
        </div>
      );
    }
    case 'number':
      return (
        <div className="space-y-1">
          <TextInput id={id} dir="ltr" inputMode="numeric" aria-label={col.label} value={faDigits(value)} onChange={(e) => onChange(e.target.value)} />
          <p className="text-label-md text-text-muted">{fa.table.numberHint}</p>
        </div>
      );
    default:
      return (
        <TextInput
          id={id}
          aria-label={col.label}
          placeholder={fa.table.filterPlaceholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** Normalises Persian digits typed in number filters before sending. */
const toLatin = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/**
 * Server-driven table (US-C3): paging, sorting, per-column filters, column chooser (persisted),
 * page size, and xlsx export of the current filter + visible columns. Rows are TableRow objects
 * produced by the API from the shared column config.
 */
export function ServerTable(props: ServerTableProps) {
  const { endpoint, columns, storageKey, params, extraColumns, toolbar } = props;
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [sorting, setSorting] = useState<SortingState>(props.defaultSort ? [props.defaultSort] : []);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState<VisibilityState>(() => defaultVisibility(columns));
  const [exporting, setExporting] = useState(false);
  const debouncedFilters = useDebounced(filters, 400);

  // Load persisted prefs after mount (SSR-safe).
  useEffect(() => {
    setVisibility((v) => ({ ...v, ...readStore<VisibilityState>(`cb:table:${storageKey}:cols`, {}) }));
    setPageSize(readStore<number>(`cb:table:${storageKey}:size`, DEFAULT_PAGE_SIZE));
  }, [storageKey]);

  const paramsKey = JSON.stringify(params ?? {});
  useEffect(() => setPage(1), [paramsKey, debouncedFilters, pageSize, sorting]);

  const listParams = useMemo(
    () => ({
      page,
      pageSize,
      sort: sorting[0] ? { id: sorting[0].id, desc: sorting[0].desc } : null,
      filters: Object.fromEntries(Object.entries(debouncedFilters).map(([k, v]) => [k, toLatin(v.trim())])),
      extra: params,
    }),
    [page, pageSize, sorting, debouncedFilters, params],
  );

  const query = useQuery({
    queryKey: [...tableQueryKey(endpoint), listParams],
    queryFn: ({ signal }) => api.get<Paginated<TableRow>>(`${endpoint}?${buildListQuery(listParams)}`, { signal }),
    placeholderData: keepPreviousData,
  });

  const defs = useMemo<ColumnDef<TableRow, unknown>[]>(() => {
    const base = columns.map<ColumnDef<TableRow, unknown>>((col) => ({
      id: col.id,
      accessorFn: (r) => r[col.id],
      header: col.label,
      enableSorting: col.source.kind === 'field' && !!col.sortable,
      cell: (ctx) => formatCell(col, ctx.row.original[col.id]),
      meta: {
        label: col.label,
        hideOnMobile: col.hideOnMobile,
        filterActive: !!filters[col.id],
        filter:
          col.source.kind === 'field' && col.filter ? (
            <HeaderFilterInput col={col} value={filters[col.id] ?? ''} onChange={(v) => setFilters((f) => ({ ...f, [col.id]: v }))} />
          ) : undefined,
      },
    }));
    return [...base, ...(extraColumns ?? [])];
  }, [columns, extraColumns, filters]);

  const onVisibility = (v: VisibilityState) => {
    setVisibility(v);
    writeStore(`cb:table:${storageKey}:cols`, v);
  };

  async function exportXlsx() {
    setExporting(true);
    try {
      const visible = columns.filter((c) => visibility[c.id] !== false && (visibility[c.id] ?? c.defaultVisible)).map((c) => c.id);
      const qs = buildListQuery({ ...listParams, page: undefined, pageSize: undefined }, 'xlsx', visible);
      const { blob, filename } = await api.download(`${endpoint}?${qs}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename ?? `${storageKey}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.toast({ tone: 'danger', title: fa.table.exportFailed, description: errorMessage(e) });
    } finally {
      setExporting(false);
    }
  }

  const data = query.data;
  return (
    <DataTable<TableRow>
      columns={defs}
      data={data?.items ?? []}
      getRowId={(r) => r.id}
      loading={query.isPending}
      error={query.isError ? <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} /> : undefined}
      pagination={data ? { page, pageSize, total: data.total, onPageChange: setPage } : undefined}
      sorting={sorting}
      onSortingChange={setSorting}
      columnVisibility={visibility}
      onColumnVisibilityChange={onVisibility}
      selectable={props.selectable}
      selectedIds={props.selectedIds}
      onSelectedIdsChange={props.onSelectedIdsChange}
      rowTone={props.rowTone}
      caption={props.caption}
      toolbar={
        <div className="flex flex-wrap items-center gap-space-sm">
          {toolbar}
          <Button3D
            variant="neutral"
            size="sm"
            icon={<RefreshCw className="size-4" aria-hidden />}
            onClick={() => void query.refetch()}
            loading={query.isFetching && !query.isPending}
            aria-label={fa.table.refresh}
            title={fa.table.refresh}
          />
          <Button3D variant="neutral" size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => void exportXlsx()} loading={exporting}>
            {fa.table.export}
          </Button3D>
          <div className="flex items-center gap-2">
            <span className="text-label-md text-text-secondary">{fa.table.pageSize}</span>
            <div className="w-24">
              <Select
                aria-label={fa.table.pageSize}
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  writeStore(`cb:table:${storageKey}:size`, Number(v));
                }}
                options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: faDigits(n) }))}
              />
            </div>
          </div>
        </div>
      }
    />
  );
}
