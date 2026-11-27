import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jalaliMonthRange } from '@cb/shared';
import { DomainError } from '../errors/domain-error';
import { PrismaService, type PrismaTx } from '../prisma/prisma.service';

export interface QuotaUsage {
  carrierId: string;
  yearMonth: string;
  /** null = no quota row for that month (→ announcing is blocked, D12). */
  limitKg: bigint | null;
  usedKg: bigint;
}

/**
 * Monthly carrier quota (BR-08 / AC-11 / DECISIONS D12) — the single implementation used by
 * announcements (enforcement), reports and dashboards.
 *
 * usedKg = Σ over the carrier's announcements whose announceDate falls in the Jalali month,
 *          status ∉ {DRAFT, CANCELLED}, not soft-deleted:
 *          weightToKg × (number of load units with state ≠ CANCELLED)
 */
@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  private usedSql(tenantId: string, yearMonth: string, carrierId?: string): Prisma.Sql {
    const { from, to } = jalaliMonthRange(yearMonth);
    const carrierFilter = carrierId ? Prisma.sql`AND a."carrierId" = ${carrierId}::uuid` : Prisma.empty;
    return Prisma.sql`
      SELECT a."carrierId" AS "carrierId",
             COALESCE(SUM(a."weightToKg"::bigint * u.cnt), 0)::bigint AS "usedKg"
        FROM announcements a
        JOIN (SELECT "announcementId", COUNT(*)::bigint AS cnt
                FROM load_units WHERE state <> 'CANCELLED' GROUP BY "announcementId") u
          ON u."announcementId" = a.id
       WHERE a."tenantId" = ${tenantId}::uuid
         ${carrierFilter}
         AND a.status NOT IN ('DRAFT', 'CANCELLED')
         AND a."deletedAt" IS NULL
         AND a."announceDate" BETWEEN ${from} AND ${to}
       GROUP BY a."carrierId"`;
  }

  async usage(tenantId: string, carrierId: string, yearMonth: string, tx?: PrismaTx): Promise<QuotaUsage> {
    const db = tx ?? this.prisma;
    const [rows, quota] = await Promise.all([
      db.$queryRaw<{ carrierId: string; usedKg: bigint }[]>(this.usedSql(tenantId, yearMonth, carrierId)),
      db.carrierQuota.findUnique({ where: { carrierId_yearMonth: { carrierId, yearMonth } } }),
    ]);
    return { carrierId, yearMonth, limitKg: quota?.tonnageLimitKg ?? null, usedKg: rows[0]?.usedKg ?? 0n };
  }

  /** Usage of every carrier of the tenant for one month (reports / factory dashboard). */
  async usageAll(tenantId: string, yearMonth: string): Promise<QuotaUsage[]> {
    const [rows, quotas, carriers] = await Promise.all([
      this.prisma.$queryRaw<{ carrierId: string; usedKg: bigint }[]>(this.usedSql(tenantId, yearMonth)),
      this.prisma.carrierQuota.findMany({ where: { tenantId, yearMonth } }),
      this.prisma.carrier.findMany({ where: { tenantId, deletedAt: null }, select: { id: true } }),
    ]);
    const used = new Map(rows.map((r) => [r.carrierId, r.usedKg]));
    const limit = new Map(quotas.map((q) => [q.carrierId, q.tonnageLimitKg]));
    return carriers.map((c) => ({
      carrierId: c.id,
      yearMonth,
      limitKg: limit.get(c.id) ?? null,
      usedKg: used.get(c.id) ?? 0n,
    }));
  }

  /**
   * Call INSIDE the transaction that creates/grows the announcement, BEFORE inserting units.
   * Serialises concurrent writers per (carrier, month) with a transaction-scoped advisory lock,
   * then throws QUOTA_NOT_SET / QUOTA_EXCEEDED if `addKg` does not fit.
   */
  async assertCanConsume(tx: PrismaTx, tenantId: string, carrierId: string, yearMonth: string, addKg: bigint): Promise<QuotaUsage> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quota:${carrierId}:${yearMonth}`}))`;
    const u = await this.usage(tenantId, carrierId, yearMonth, tx);
    if (u.limitKg === null) throw new DomainError('QUOTA_NOT_SET', { yearMonth });
    if (u.usedKg + addKg > u.limitKg) {
      throw new DomainError('QUOTA_EXCEEDED', {
        yearMonth,
        limitKg: u.limitKg.toString(),
        usedKg: u.usedKg.toString(),
        requestedKg: addKg.toString(),
      });
    }
    return u;
  }
}
