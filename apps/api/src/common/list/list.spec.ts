import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { ANNOUNCEMENT_COLUMNS, PERMIT_COLUMNS } from '@cb/shared';
import { DomainError } from '../errors/domain-error';
import { nestPath, parseListQuery } from './list-query';
import { buildXlsx, completeRows } from './list-response';

describe('parseListQuery', () => {
  it('defaults and paging', () => {
    const p = parseListQuery({}, ANNOUNCEMENT_COLUMNS);
    expect(p).toMatchObject({ page: 1, pageSize: 50, skip: 0, take: 50, format: 'json', where: [], orderBy: [] });
    expect(parseListQuery({ page: '3', pageSize: '20' }, ANNOUNCEMENT_COLUMNS)).toMatchObject({ skip: 40, take: 20 });
  });

  it('builds nested orderBy and filters from field columns', () => {
    const p = parseListQuery(
      { sort: 'carrierName:desc', f_carrierName: 'نصر', f_truckCount: '5..10', f_status: 'ACTIVE,CANCELLED', f_announceDate: '2026-11-01..2026-11-30' },
      ANNOUNCEMENT_COLUMNS,
    );
    expect(p.orderBy).toEqual([{ carrier: { name: 'desc' } }]);
    expect(p.where).toContainEqual({ carrier: { name: { contains: 'نصر', mode: 'insensitive' } } });
    expect(p.where).toContainEqual({ truckCount: { gte: 5, lte: 10 } });
    expect(p.where).toContainEqual({ status: { in: ['ACTIVE', 'CANCELLED'] } });
    expect(p.where).toContainEqual({ announceDate: { gte: '2026-11-01', lte: '2026-11-30' } });
  });

  it('datetime date filters become Tehran-day UTC ranges', () => {
    const p = parseListQuery({ f_reservedAt: '2026-11-27' }, PERMIT_COLUMNS);
    const cond = (p.where[0] as { reservedAt: { gte: Date; lt: Date } }).reservedAt;
    expect(cond.gte.toISOString()).toBe('2026-11-26T20:30:00.000Z');
    expect(cond.lt.toISOString()).toBe('2026-11-27T20:30:00.000Z');
  });

  it.each([
    [{ sort: 'hall:asc' }, 'computed column not sortable'],
    [{ f_hall: 'x' }, 'computed column not filterable'],
    [{ f_status: 'NOPE' }, 'unknown enum value'],
    [{ f_truckCount: 'abc' }, 'non-integer'],
    [{ tenantId: 'evil' }, 'unknown param (scope smuggling)'],
    [{ pageSize: '1000' }, 'page size cap'],
    [{ cols: 'number,evil' }, 'unknown export column'],
  ])('rejects %j (%s)', (raw: Record<string, string>, _why: string) => {
    expect(() => parseListQuery(raw, ANNOUNCEMENT_COLUMNS)).toThrow(DomainError);
  });

  it('allows declared resource params and xlsx export bounds', () => {
    const p = parseListQuery({ view: 'active', format: 'xlsx', cols: 'number,hall' }, ANNOUNCEMENT_COLUMNS, { allowParams: ['view'] });
    expect(p).toMatchObject({ format: 'xlsx', skip: 0, cols: ['number', 'hall'] });
    expect(p.take).toBeGreaterThan(1000);
  });

  it('nestPath', () => {
    expect(nestPath('unit.announcement.number', 'asc')).toEqual({ unit: { announcement: { number: 'asc' } } });
  });
});

describe('xlsx export', () => {
  it('writes an RTL sheet with Persian headers, Jalali dates and labels', async () => {
    const cols = ANNOUNCEMENT_COLUMNS.filter((c) => ['rowNo', 'number', 'announceDate', 'status', 'weightTo', 'regulatorStatus'].includes(c.id));
    const rows = completeRows([{ id: 'a', number: 7, announceDate: '2026-11-27', status: 'ACTIVE', weightTo: 28000 }], cols, 50);
    expect(rows[0]).toMatchObject({ rowNo: 51, regulatorStatus: null });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildXlsx(cols, rows, 'announcements'));
    const ws = wb.worksheets[0]!;
    expect(ws.views[0]?.rightToLeft).toBe(true);
    expect(ws.getRow(1).getCell(2).value).toBe('شماره اعلام بار');
    expect(ws.getRow(2).values).toEqual([undefined, 51, 7, '۱۴۰۵/۰۹/۰۶', 'فعال', 28]); // trailing empty cell omitted
  });
});
