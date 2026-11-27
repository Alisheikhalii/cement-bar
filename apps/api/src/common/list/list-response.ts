import { StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  isoDateToJalali,
  toJalali,
  type CellValue,
  type ColumnSpec,
  type Paginated,
  type TableRow,
} from '@cb/shared';
import type { Response } from 'express';
import type { ParsedList } from './list-query';

/**
 * Fills the columns a mapper does not produce: `rowNo` (1-based across pages) and
 * `unavailable` columns (null). Mappers only return field/computed/extra values.
 */
export function completeRows(rows: TableRow[], columns: readonly ColumnSpec[], skip: number): TableRow[] {
  const hasRowNo = columns.some((c) => c.id === 'rowNo');
  const unavailable = columns.filter((c) => c.source.kind === 'unavailable').map((c) => c.id);
  return rows.map((r, i) => {
    const out: TableRow = { ...r };
    if (hasRowNo) out.rowNo = skip + i + 1;
    for (const id of unavailable) out[id] = null;
    return out;
  });
}

/** Read a value from `extra` jsonb for an `extra`-sourced column. */
export function extraValue(extra: unknown, key: string): CellValue {
  if (!extra || typeof extra !== 'object') return null;
  const v = (extra as Record<string, unknown>)[key];
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null;
}

/** Copies every `extra`-sourced column of `columns` from the entity's extra jsonb. */
export function extraCells(extra: unknown, columns: readonly ColumnSpec[]): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const c of columns) if (c.source.kind === 'extra') out[c.id] = extraValue(extra, c.source.key);
  return out;
}

function xlsxCell(col: ColumnSpec, v: CellValue): string | number | null {
  if (v === null || v === undefined || v === '') return null;
  switch (col.type) {
    case 'date':
      return typeof v === 'string' ? isoDateToJalali(v) : String(v);
    case 'datetime':
      return typeof v === 'string' ? toJalali(v, 'yyyy/MM/dd HH:mm') : String(v);
    case 'money': {
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : String(v);
    }
    case 'weightKg':
      return Number(v) / 1000;
    case 'number':
      return Number(v);
    case 'bool':
      return v === true || v === 'true' ? 'بله' : 'خیر';
    case 'enum':
      return col.enumLabels?.[String(v)] ?? String(v);
    default:
      return String(v);
  }
}

/** RTL workbook with Persian headers; money as integer rial, weight in tonnes. */
export async function buildXlsx(columns: readonly ColumnSpec[], rows: TableRow[], sheetName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date(0); // deterministic output; no host metadata
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({
    header: c.type === 'weightKg' ? `${c.label} (تن)` : c.label,
    key: c.id,
    width: Math.min(40, Math.max(12, c.label.length + 4)),
  }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c) => [c.id, xlsxCell(c, r[c.id] ?? null)])));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Standard list response. Use in a controller with `@Res({ passthrough: true }) res`:
 *
 *   const parsed = parseListQuery(query, COLUMNS, { allowParams: ['view'] });
 *   const { rows, total } = await this.service.list(user, parsed);   // rows WITHOUT rowNo/unavailable
 *   return respondList(res, parsed, COLUMNS, rows, total, 'announcements');
 *
 * json → Paginated<TableRow>; xlsx → attachment with the requested (or default-visible) columns.
 */
export async function respondList(
  res: Response,
  parsed: ParsedList,
  columns: readonly ColumnSpec[],
  rows: TableRow[],
  total: number,
  filename: string,
): Promise<Paginated<TableRow> | StreamableFile> {
  const complete = completeRows(rows, columns, parsed.skip);
  if (parsed.format === 'json') {
    return { items: complete, total, page: parsed.page, pageSize: parsed.pageSize };
  }
  const byId = new Map(columns.map((c) => [c.id, c]));
  const cols = parsed.cols
    ? parsed.cols.map((id) => byId.get(id)!)
    : columns.filter((c) => c.defaultVisible);
  const buf = await buildXlsx(cols, complete, filename);
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}.xlsx"`);
  res.setHeader('Cache-Control', 'no-store');
  return new StreamableFile(buf);
}
