'use client';
import type { ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { flexRender, type Column, type Row, type RowData, type Table } from '@tanstack/react-table';
import { Check, Columns3, Filter } from 'lucide-react';
import { cn } from '../cn';
import { uiStrings } from '../strings';
import { toneBg, type Tone } from '../tokens';
import { Skeleton } from './Skeleton';

declare module '@tanstack/react-table' {
  // Type params must match the library declaration for interface merging.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Plain-text label for column menu and mobile cards (falls back to a string header). */
    label?: string;
    hideOnMobile?: boolean;
    /** Filter control shown in a popover behind the header filter icon. */
    filter?: ReactNode;
    /** Marks the filter as active (filled icon). */
    filterActive?: boolean;
  }
}

export const SELECT_COLUMN_ID = '__select';

export function columnLabel<T>(column: Column<T, unknown>): string {
  const header = column.columnDef.header;
  return column.columnDef.meta?.label ?? (typeof header === 'string' ? header : column.id);
}

export function HeaderFilter({ label, filter, active }: { label: string; filter: ReactNode; active?: boolean }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          'inline-flex size-8 items-center justify-center rounded-lg hover:bg-surface-container',
          active ? 'text-primary-container' : 'text-text-muted',
        )}
        aria-label={label}
        title={label}
      >
        <Filter className={cn('size-3.5', active && 'fill-current')} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          className="z-50 w-64 animate-fade-in rounded-xl bg-surface-card p-space-sm shadow-elevation-3"
        >
          {filter}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ColumnMenu<T>({ table }: { table: Table<T> }) {
  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide() && c.id !== SELECT_COLUMN_ID);
  return (
    <Dropdown.Root dir="rtl">
      <Dropdown.Trigger className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-surface-container px-space-sm text-label-md text-primary-container shadow-bevel-neutral active:translate-y-1 active:shadow-none">
        <Columns3 className="size-4" aria-hidden />
        {uiStrings.columns}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-48 animate-fade-in rounded-xl bg-surface-card p-1 shadow-elevation-3"
        >
          {hideable.map((c) => (
            <Dropdown.CheckboxItem
              key={c.id}
              checked={c.getIsVisible()}
              onCheckedChange={(v) => c.toggleVisibility(v === true)}
              onSelect={(e) => e.preventDefault()}
              className="relative flex min-h-10 cursor-pointer select-none items-center rounded-lg pe-8 ps-space-sm text-body-md text-text-primary outline-none data-[highlighted]:bg-surface-container-low"
            >
              {columnLabel(c)}
              <Dropdown.ItemIndicator className="absolute end-2">
                <Check className="size-4 text-primary-container" aria-hidden />
              </Dropdown.ItemIndicator>
            </Dropdown.CheckboxItem>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export function SkeletonRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="border-b border-border-subtle">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className="px-space-md py-space-sm">
              <Skeleton className="w-3/4" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function MobileCard<T>({ row, tone }: { row: Row<T>; tone: Tone }) {
  const cells = row.getVisibleCells();
  const select = cells.find((c) => c.column.id === SELECT_COLUMN_ID);
  const rest = cells.filter((c) => c.column.id !== SELECT_COLUMN_ID && !c.column.columnDef.meta?.hideOnMobile);
  return (
    <li
      className={cn(
        'relative overflow-hidden rounded-2xl bg-surface-card p-space-md ps-space-lg shadow-elevation-1',
        row.getIsSelected() && 'ring-2 ring-primary-container',
      )}
    >
      <span aria-hidden className={cn('absolute inset-y-0 start-0 w-1.5', toneBg[tone])} />
      {select ? <div className="mb-space-xs">{flexRender(select.column.columnDef.cell, select.getContext())}</div> : null}
      <dl className="flex flex-col gap-space-xs">
        {rest.map((cell) => (
          <div key={cell.id} className="flex items-start justify-between gap-space-sm">
            <dt className="shrink-0 text-label-md text-text-muted">{columnLabel(cell.column)}</dt>
            <dd className="min-w-0 break-words text-end text-body-md text-text-primary">
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}
