'use client';
import { useMemo, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '../cn';
import { uiStrings } from '../strings';
import type { Tone } from '../tokens';
import { Checkbox } from '../form/controls';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import { Pagination } from './Pagination';
import { ColumnMenu, HeaderFilter, MobileCard, SELECT_COLUMN_ID, SkeletonRows, columnLabel } from './DataTableParts';

export interface ServerPagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  /** Rendered instead of rows when present (error state). */
  error?: ReactNode;
  emptyText?: string;
  pagination?: ServerPagination;
  /** Controlled (server) sorting. When omitted the table sorts the current page client-side. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  /** Colour of the mobile card strip. */
  rowTone?: (row: T) => Tone;
  /** Controlled column visibility (e.g. persisted per user). Uncontrolled when omitted. */
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (v: VisibilityState) => void;
  toolbar?: ReactNode;
  caption?: string;
  className?: string;
}

function resolve<S>(u: Updater<S>, prev: S): S {
  return typeof u === 'function' ? (u as (p: S) => S)(prev) : u;
}

export function DataTable<T>(props: DataTableProps<T>) {
  const { data, getRowId, loading, error, emptyText, pagination, selectable, rowTone, toolbar, caption } = props;
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const [localVisibility, setLocalVisibility] = useState<VisibilityState>({});
  const visibility = props.columnVisibility ?? localVisibility;
  const setVisibility = (v: VisibilityState) => (props.onColumnVisibilityChange ?? setLocalVisibility)(v);
  const [localSelection, setLocalSelection] = useState<RowSelectionState>({});
  const serverSort = props.onSortingChange !== undefined;
  const sorting = props.sorting ?? localSorting;
  const selection = useMemo<RowSelectionState>(
    () => (props.selectedIds ? Object.fromEntries(props.selectedIds.map((id) => [id, true])) : localSelection),
    [props.selectedIds, localSelection],
  );

  const columns = useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!selectable) return props.columns;
    const select: ColumnDef<T, unknown> = {
      id: SELECT_COLUMN_ID,
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          aria-label={uiStrings.selectAll}
          checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? 'indeterminate' : false}
          onCheckedChange={(v) => table.toggleAllRowsSelected(v)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox aria-label={uiStrings.selectRow} checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(v)} />
      ),
    };
    return [select, ...props.columns];
  }, [selectable, props.columns]);

  const table = useReactTable({
    data,
    columns,
    getRowId: (r) => getRowId(r),
    state: { sorting, columnVisibility: visibility, rowSelection: selection },
    manualSorting: serverSort,
    manualPagination: true,
    enableRowSelection: !!selectable,
    onSortingChange: (u) => {
      const next = resolve(u, sorting);
      if (serverSort) props.onSortingChange?.(next);
      else setLocalSorting(next);
    },
    onColumnVisibilityChange: (u) => setVisibility(resolve(u, visibility)),
    onRowSelectionChange: (u) => {
      const next = resolve(u, selection);
      setLocalSelection(next);
      props.onSelectedIdsChange?.(Object.keys(next).filter((k) => next[k]));
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const visibleCount = table.getVisibleLeafColumns().length;
  const showEmpty = !loading && !error && rows.length === 0;

  return (
    <div className={cn('flex min-w-0 flex-col gap-space-sm', props.className)}>
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <div className="min-w-0 flex-1">{toolbar}</div>
        <ColumnMenu table={table} />
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-2xl bg-surface-card shadow-elevation-1 md:block">
        <table className="w-full border-collapse text-start text-body-md">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="bg-surface-container-low">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const meta = h.column.columnDef.meta;
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                      className="whitespace-nowrap px-space-md py-space-sm text-start text-label-md text-text-secondary"
                    >
                      <span className="inline-flex items-center gap-1">
                        {h.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={h.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1 rounded-md hover:text-primary-container"
                            title={sorted === 'asc' ? uiStrings.sortDesc : uiStrings.sortAsc}
                          >
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {sorted === 'asc' ? (
                              <ArrowUp className="size-3.5" aria-hidden />
                            ) : sorted === 'desc' ? (
                              <ArrowDown className="size-3.5" aria-hidden />
                            ) : (
                              <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />
                            )}
                          </button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                        {meta?.filter ? (
                          <HeaderFilter label={columnLabel(h.column)} filter={meta.filter} active={meta.filterActive} />
                        ) : null}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? <SkeletonRows columns={visibleCount} /> : null}
            {!loading && !error
              ? rows.map((row) => (
                  <tr
                    key={row.id}
                    data-state={row.getIsSelected() ? 'selected' : undefined}
                    className="border-t border-border-subtle transition-shadow hover:bg-surface hover:shadow-row-accent data-[state=selected]:bg-surface-container-low"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-space-md py-space-sm text-text-body">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              : null}
          </tbody>
        </table>
        {error ? <div className="p-space-md">{error}</div> : null}
        {showEmpty ? <EmptyState title={emptyText ?? uiStrings.empty} /> : null}
      </div>

      {/* Mobile cards */}
      <div className="md:hidden">
        {loading ? (
          <div className="flex flex-col gap-space-sm" role="status" aria-label={uiStrings.loading}>
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : error ? (
          error
        ) : showEmpty ? (
          <div className="rounded-2xl bg-surface-card shadow-elevation-1">
            <EmptyState title={emptyText ?? uiStrings.empty} />
          </div>
        ) : (
          <ul className="flex flex-col gap-space-sm">
            {rows.map((row) => (
              <MobileCard key={row.id} row={row} tone={rowTone?.(row.original) ?? 'primary'} />
            ))}
          </ul>
        )}
      </div>

      {pagination && !error ? <Pagination {...pagination} /> : null}
    </div>
  );
}
