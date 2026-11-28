import { Injectable } from '@nestjs/common';
import type { Driver, Prisma } from '@prisma/client';
import { addDaysIso, localDate, localDateTimeToUtc, type DriverBlockResultDto, type TableRow } from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedTenant } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import type { ParsedList } from '../../common/list/list-query';
import { PrismaService, TX_TIMEOUT_MS, type PrismaTx } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ci, isoOrNull } from './factory.util';

/** How many past block entries to inspect when restoring the pre-block status. */
const AUDIT_LOOKBACK = 20;

const toBlockDto = (d: Driver): DriverBlockResultDto => ({
  id: d.id,
  status: d.status,
  blockedUntil: isoOrNull(d.blockedUntil),
  blockReason: d.blockReason,
});

@Injectable()
export class FactoryDriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, p: ParsedList): Promise<{ rows: TableRow[]; total: number }> {
    const scope = scopedTenant(user);
    const where: Prisma.DriverWhereInput = {
      ...scope,
      deletedAt: null,
      AND: p.where as Prisma.DriverWhereInput[],
      ...(p.q
        ? {
            OR: [
              { firstName: ci(p.q) },
              { lastName: ci(p.q) },
              { user: { mobile: ci(p.q) } },
              { vehicles: { some: { active: true, plate: ci(p.q) } } },
            ],
          }
        : {}),
    };
    const [items, total, loaderTypes] = await Promise.all([
      this.prisma.driver.findMany({
        where,
        orderBy: [...(p.orderBy as Prisma.DriverOrderByWithRelationInput[]), { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        include: {
          user: { select: { mobile: true } },
          carrier: { select: { name: true } },
          vehicles: { where: { active: true }, take: 1, select: { plate: true, loaderTypeId: true } },
        },
      }),
      this.prisma.driver.count({ where }),
      this.prisma.loaderType.findMany({ where: scope, select: { id: true, title: true } }),
    ]);
    const loaderTitle = new Map(loaderTypes.map((l) => [l.id, l.title]));
    const rows = items.map((d) => {
      const v = d.vehicles[0];
      return {
        id: d.id,
        firstName: d.firstName,
        lastName: d.lastName,
        mobile: d.user.mobile,
        carrierName: d.carrier.name,
        status: d.status,
        plate: v?.plate ?? null,
        loaderType: v ? (loaderTitle.get(v.loaderTypeId) ?? null) : null,
        blockedUntil: isoOrNull(d.blockedUntil),
        blockReason: d.blockReason,
        createdAt: d.createdAt.toISOString(),
      };
    });
    return { rows, total };
  }

  /**
   * Blocks a driver tenant-wide (status BLOCKED → reservations are refused with DRIVER_BLOCKED).
   * `until` is the last blocked local day; omitted = indefinite. Re-blocking updates reason/until.
   * Rejected drivers cannot be blocked (they have no access anyway).
   */
  async block(user: AuthUser, id: string, input: { reason: string; until?: string }): Promise<DriverBlockResultDto> {
    const now = this.clock.now();
    if (input.until && input.until < localDate(now)) {
      throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'until', message: 'must not be in the past' }] });
    }
    const blockedUntil = input.until ? localDateTimeToUtc(addDaysIso(input.until, 1), '00:00') : null;
    const d = await this.prisma.$transaction(
      async (tx) => {
        const b = await tx.driver.findFirst({ where: { id, ...scopedTenant(user), deletedAt: null } });
        if (!b) throw new DomainError('NOT_FOUND');
        if (b.status === 'REJECTED') throw new DomainError('INVALID_STATE', { status: b.status });
        const a = await tx.driver.update({
          where: { id: b.id },
          data: { status: 'BLOCKED', blockedUntil, blockReason: input.reason },
        });
        await this.audit.log(
          { action: 'driver.blocked', entity: 'Driver', entityId: a.id, before: toBlockDto(b), after: toBlockDto(a), reason: input.reason },
          tx,
        );
        return a;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return toBlockDto(d);
  }

  /**
   * ASSUMPTION(Q-D-2): the schema stores no "status before block". It is recovered from the append-only
   * audit trail (latest `driver.blocked` entry whose `before.status` was not BLOCKED). If there is none
   * (e.g. blocked by another slice), a driver decided by a carrier (decidedAt) returns to APPROVED,
   * otherwise to PENDING.
   */
  private async statusBeforeBlock(tx: PrismaTx, d: Driver): Promise<'APPROVED' | 'PENDING'> {
    const entries = await tx.auditLog.findMany({
      where: { tenantId: d.tenantId, entity: 'Driver', entityId: d.id, action: 'driver.blocked' },
      orderBy: { at: 'desc' },
      take: AUDIT_LOOKBACK,
      select: { before: true },
    });
    for (const e of entries) {
      const s = (e.before as { status?: unknown } | null)?.status;
      if (s === 'APPROVED' || s === 'PENDING') return s;
    }
    return d.decidedAt ? 'APPROVED' : 'PENDING';
  }

  async unblock(user: AuthUser, id: string, note?: string): Promise<DriverBlockResultDto> {
    const d = await this.prisma.$transaction(
      async (tx) => {
        const b = await tx.driver.findFirst({ where: { id, ...scopedTenant(user), deletedAt: null } });
        if (!b) throw new DomainError('NOT_FOUND');
        if (b.status !== 'BLOCKED') throw new DomainError('INVALID_STATE', { status: b.status });
        const upd = await tx.driver.updateMany({
          where: { id: b.id, status: 'BLOCKED' },
          data: { status: await this.statusBeforeBlock(tx, b), blockedUntil: null, blockReason: null },
        });
        if (upd.count !== 1) throw new DomainError('INVALID_STATE');
        const a = await tx.driver.findUniqueOrThrow({ where: { id: b.id } });
        await this.audit.log(
          { action: 'driver.unblocked', entity: 'Driver', entityId: a.id, before: toBlockDto(b), after: toBlockDto(a), reason: note ?? null },
          tx,
        );
        return a;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return toBlockDto(d);
  }
}
