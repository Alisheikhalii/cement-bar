import type { ReactNode } from 'react';
import {
  faDigits,
  faNumber,
  formatDateTimeFa,
  formatRial,
  formatTon,
  isoDateToJalali,
  type CellValue,
  type ColumnSpec,
} from '@cb/shared';
import { fa } from '@/i18n/fa';

/** Formats a TableRow cell by its column type (Persian digits, Jalali dates, rial, tonnes). */
export function formatCell(col: ColumnSpec, v: CellValue | undefined): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-text-muted">{fa.table.empty}</span>;
  switch (col.type) {
    case 'number':
      return faNumber(Number(v));
    case 'money':
      return formatRial(String(v));
    case 'weightKg':
      return formatTon(Number(v));
    case 'date':
      return isoDateToJalali(String(v));
    case 'time':
      return faDigits(String(v));
    case 'datetime':
      return formatDateTimeFa(String(v));
    case 'bool':
      return v === true || v === 'true' ? fa.table.yes : fa.table.no;
    case 'enum':
      return col.enumLabels?.[String(v)] ?? String(v);
    default:
      return faDigits(String(v));
  }
}
