import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addDaysIso,
  jalaliYearMonth,
  localDateTimeToUtc,
  zIsoDate,
  zYearMonth,
  type PermitView,
  type ReportCarrierOptionDto,
  type TableRow,
} from '@cb/shared';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import type { ParsedList } from '../../common/list/list-query';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QuotaService } from '../../common/quota/quota.service';
import { isUuid } from '../carrier/ids';
import { PermitRowsService } from '../carrier/permit-rows.service';

/** Scope ALWAYS derived from the session: tenantId, plus carrierId for carrier operators. */
export interface ReportScope {
  tenantId: string;
  carrierId?: string;
}

export interface DateRange {
  from?: string;
  to?: string;
}

function bad(path: string, message: string): never {
  throw new DomainError('VALIDATION_FAILED', { issues: [{ path, message }] });
}

/** Optional ISO local-date range params (`from`, `to`, inclusive business days). */
export function parseDateRange(q: Record<string, unknown>): DateRange {
  const out: DateRange = {};
  for (const k of ['from', 'to'] as const) {
    const v = q[k];
    if (v === undefined || v === '') continue;
    if (typeof v !== 'string' || !zIsoDate.safeParse(v).success) bad(k, 'invalid date');
    out[k] = v;
  }
  if (out.from && out.to && out.from > out.to) bad('to', 'to < from');
  return out;
}

/** Optional factory carrier filter — still tenant-scoped by the caller. */
export function parseCarrierFilter(v: unknown): string | undefined {
  if (v === undefined || v === '') return undefined;
  if (!isUuid(v)) bad('carrierId', 'invalid id');
  return v;
}

const page = <T>(rows: T[], p: ParsedList): T[] => rows.slice(p.skip, p.skip + p.take);

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly quota: QuotaService,
    private readonly permitRows: PermitRowsService,
  ) {}

  /** Issued permits (US-F9 / US-B11) with the full PERMIT_COLUMNS set. */
  permits(scope: ReportScope, p: ParsedList, view?: PermitView): Promise<{ rows: TableRow[]; total: number }> {
    return this.permitRows.list(this.permitRows.where(scope, p, view), p);
  }

  /**
   * Aggregate report (source spec §4.13): per carrier, the number of non-cancelled permits
   * reserved in [from, to] (Tehran business days) and the total fare of those permits.
   */
  async aggregate(scope: ReportScope, range: DateRange, p: ParsedList): Promise<{ rows: TableRow[]; total: number }> {
    // ASSUMPTION(Q-F-6): "non-cancelled" = every status except CANCELLED (NO_SHOW and RETURNED count).
    const carrierSql = scope.carrierId ? Prisma.sql`AND r."carrierId" = ${scope.carrierId}::uuid` : Prisma.empty;
    const fromSql = range.from ? Prisma.sql`AND r."reservedAt" >= ${localDateTimeToUtc(range.from, '00:00')}` : Prisma.empty;
    const toSql = range.to ? Prisma.sql`AND r."reservedAt" < ${localDateTimeToUtc(addDaysIso(range.to, 1), '00:00')}` : Prisma.empty;
    const sums = await this.prisma.$queryRaw<{ carrierId: string; cnt: bigint; total: bigint | null }[]>(Prisma.sql`
      SELECT r."carrierId" AS "carrierId",
             COUNT(*)::bigint AS cnt,
             SUM(CASE WHEN a."fareCalc" = 'PER_TRUCK' THEN a."farePerTruck"
                      ELSE (a."ratePerTon" * a."weightToKg"::bigint) / 1000 END)::bigint AS total
        FROM reservations r
        JOIN load_units u ON u.id = r."unitId"
        JOIN announcements a ON a.id = u."announcementId"
       WHERE r."tenantId" = ${scope.tenantId}::uuid
         AND r.status <> 'CANCELLED'
         ${carrierSql} ${fromSql} ${toSql}
       GROUP BY r."carrierId"`);
    const byCarrier = new Map(sums.map((s) => [s.carrierId, s]));
    const carriers = await this.prisma.carrier.findMany({
      where: { tenantId: scope.tenantId, deletedAt: null, ...(scope.carrierId ? { id: scope.carrierId } : {}) },
      orderBy: [{ code: 'asc' }],
    });
    const rows = carriers.map<TableRow>((c) => {
      const s = byCarrier.get(c.id);
      return {
        id: c.id,
        carrierCode: c.code,
        carrierName: c.name,
        permitCount: s ? Number(s.cnt) : 0,
        totalFare: (s?.total ?? 0n).toString(),
      };
    });
    return { rows: page(rows, p), total: rows.length };
  }

  /** Quota usage for one Jalali month (D12 formula via the shared QuotaService). */
  async quotaUsage(scope: ReportScope, yearMonthRaw: unknown, p: ParsedList): Promise<{ rows: TableRow[]; total: number }> {
    let yearMonth = jalaliYearMonth(this.clock.now());
    if (yearMonthRaw !== undefined && yearMonthRaw !== '') {
      const r = zYearMonth.safeParse(yearMonthRaw);
      if (!r.success) bad('yearMonth', 'expected YYYY-MM (Jalali)');
      yearMonth = r.data;
    }
    const usage = scope.carrierId
      ? [await this.quota.usage(scope.tenantId, scope.carrierId, yearMonth)]
      : await this.quota.usageAll(scope.tenantId, yearMonth);
    const carriers = new Map(
      (
        await this.prisma.carrier.findMany({
          where: { tenantId: scope.tenantId, id: { in: usage.map((u) => u.carrierId) } },
          select: { id: true, code: true, name: true },
        })
      ).map((c) => [c.id, c]),
    );
    const rows = usage
      .filter((u) => carriers.has(u.carrierId))
      .map<TableRow>((u) => {
        const c = carriers.get(u.carrierId)!;
        const remaining = u.limitKg === null ? null : u.limitKg - u.usedKg;
        const percent = u.limitKg && u.limitKg > 0n ? Number((u.usedKg * 100n) / u.limitKg) : null;
        return {
          id: c.id,
          carrierCode: c.code,
          carrierName: c.name,
          yearMonth,
          limitKg: u.limitKg === null ? null : Number(u.limitKg),
          usedKg: Number(u.usedKg),
          remainingKg: remaining === null ? null : Number(remaining),
          usedPercent: percent,
        };
      })
      .sort((a, b) => String(a.carrierCode).localeCompare(String(b.carrierCode)));
    return { rows: page(rows, p), total: rows.length };
  }

  async carrierOptions(tenantId: string): Promise<ReportCarrierOptionDto[]> {
    return this.prisma.carrier.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: 'asc' }],
    });
  }
}
