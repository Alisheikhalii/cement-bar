import { Injectable } from '@nestjs/common';
import type { Carrier, Prisma, User } from '@prisma/client';
import {
  jalaliYearMonth,
  type CarrierCreateInput,
  type CarrierDetailDto,
  type CarrierDto,
  type CarrierQuotaDto,
  type CarrierQuotaUpsertInput,
  type CarrierUpdateInput,
  type CarrierUserCreateInput,
  type CarrierUserDto,
  type TableRow,
} from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedTenant } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import type { ParsedList } from '../../common/list/list-query';
import { PrismaService, TX_TIMEOUT_MS, type PrismaTx } from '../../common/prisma/prisma.service';
import { QuotaService } from '../../common/quota/quota.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { ci, isoOrNull } from './factory.util';

/** Number of past quota months returned by GET /:id/quotas. */
const QUOTA_HISTORY_MONTHS = 24;

export function toCarrierDto(c: Carrier): CarrierDto {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    phone: c.phone,
    address: c.address,
    nationalId: c.nationalId,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
  };
}

function toUserDto(u: User): CarrierUserDto {
  return {
    id: u.id,
    username: u.username ?? '',
    displayName: u.displayName,
    active: u.status === 'ACTIVE',
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: isoOrNull(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
  };
}

const OPERATOR = { role: 'CARRIER_OPERATOR' as const, deletedAt: null };

@Injectable()
export class CarriersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  /** Loads a live carrier of the caller's tenant or throws NOT_FOUND (also for other tenants — IDOR). */
  async findOwned(user: AuthUser, id: string, db: PrismaTx = this.prisma): Promise<Carrier> {
    const c = await db.carrier.findFirst({ where: { id, ...scopedTenant(user), deletedAt: null } });
    if (!c) throw new DomainError('NOT_FOUND');
    return c;
  }

  async list(user: AuthUser, p: ParsedList): Promise<{ rows: TableRow[]; total: number }> {
    const where: Prisma.CarrierWhereInput = {
      ...scopedTenant(user),
      deletedAt: null,
      AND: p.where as Prisma.CarrierWhereInput[],
      ...(p.q ? { OR: [{ name: ci(p.q) }, { code: ci(p.q) }, { phone: ci(p.q) }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.carrier.findMany({
        where,
        orderBy: [...(p.orderBy as Prisma.CarrierOrderByWithRelationInput[]), { code: 'asc' }],
        skip: p.skip,
        take: p.take,
        include: { _count: { select: { users: { where: OPERATOR }, drivers: { where: { deletedAt: null } } } } },
      }),
      this.prisma.carrier.count({ where }),
    ]);
    const rows = items.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      phone: c.phone,
      status: c.status,
      operators: c._count.users,
      drivers: c._count.drivers,
      nationalId: c.nationalId,
      createdAt: c.createdAt.toISOString(),
    }));
    return { rows, total };
  }

  /** Small id/name list for selects (daily-file upload, filters). */
  async options(user: AuthUser): Promise<Pick<CarrierDto, 'id' | 'code' | 'name' | 'status'>[]> {
    return this.prisma.carrier.findMany({
      where: { ...scopedTenant(user), deletedAt: null },
      select: { id: true, code: true, name: true, status: true },
      orderBy: { code: 'asc' },
    });
  }

  async detail(user: AuthUser, id: string): Promise<CarrierDetailDto> {
    const c = await this.findOwned(user, id);
    const [operators, driversCount] = await Promise.all([
      this.prisma.user.findMany({ where: { carrierId: c.id, tenantId: c.tenantId, ...OPERATOR }, orderBy: { createdAt: 'asc' } }),
      this.prisma.driver.count({ where: { carrierId: c.id, deletedAt: null } }),
    ]);
    return { ...toCarrierDto(c), operators: operators.map(toUserDto), driversCount };
  }

  async create(user: AuthUser, input: CarrierCreateInput): Promise<CarrierDto> {
    const { tenantId } = scopedTenant(user);
    const created = await this.prisma.$transaction(
      async (tx) => {
        const c = await tx.carrier.create({
          data: {
            tenantId,
            code: input.code,
            name: input.name,
            phone: input.phone ?? null,
            address: input.address ?? null,
            nationalId: input.nationalId ?? null,
            createdBy: user.id,
          },
        });
        await this.audit.log({ action: 'carrier.created', entity: 'Carrier', entityId: c.id, after: toCarrierDto(c) }, tx);
        return c;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return toCarrierDto(created);
  }

  /**
   * Updates profile fields and/or status. Suspension (D11) blocks only this carrier's operators:
   * login/refresh already reject them (assertAccountUsable); here their live sessions are revoked too,
   * so an access token issued before the suspension stops working immediately.
   */
  async update(user: AuthUser, id: string, patch: Partial<CarrierUpdateInput>): Promise<CarrierDto> {
    const { before, after } = await this.prisma.$transaction(
      async (tx) => {
        const b = await this.findOwned(user, id, tx);
        const a = await tx.carrier.update({ where: { id: b.id }, data: patch });
        const action =
          patch.status && patch.status !== b.status
            ? patch.status === 'SUSPENDED'
              ? 'carrier.suspended'
              : 'carrier.activated'
            : 'carrier.updated';
        await this.audit.log({ action, entity: 'Carrier', entityId: a.id, before: toCarrierDto(b), after: toCarrierDto(a) }, tx);
        return { before: b, after: a };
      },
      { timeout: TX_TIMEOUT_MS },
    );
    if (before.status !== 'SUSPENDED' && after.status === 'SUSPENDED') await this.revokeOperators(after.id);
    return toCarrierDto(after);
  }

  /**
   * Soft delete.
   * ASSUMPTION(Q-D-1): only carriers that never had drivers or announcements can be deleted (otherwise
   * history would point at a hidden carrier); use suspension instead. Operators' sessions are revoked.
   */
  async remove(user: AuthUser, id: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const c = await this.findOwned(user, id, tx);
        const [drivers, announcements] = await Promise.all([
          tx.driver.count({ where: { carrierId: c.id } }),
          tx.announcement.count({ where: { carrierId: c.id } }),
        ]);
        if (drivers > 0 || announcements > 0) throw new DomainError('INVALID_STATE', { drivers, announcements });
        await tx.carrier.update({ where: { id: c.id }, data: { deletedAt: this.clock.now() } });
        await this.audit.log({ action: 'carrier.deleted', entity: 'Carrier', entityId: c.id, before: toCarrierDto(c) }, tx);
      },
      { timeout: TX_TIMEOUT_MS },
    );
    await this.revokeOperators(id);
  }

  private async revokeOperators(carrierId: string): Promise<void> {
    const ops = await this.prisma.user.findMany({ where: { carrierId, role: 'CARRIER_OPERATOR' }, select: { id: true } });
    for (const o of ops) await this.sessions.revokeUserFamilies(o.id, 'disabled');
  }

  // ───────── operator users ─────────
  async listUsers(user: AuthUser, carrierId: string): Promise<CarrierUserDto[]> {
    const c = await this.findOwned(user, carrierId);
    const users = await this.prisma.user.findMany({ where: { carrierId: c.id, tenantId: c.tenantId, ...OPERATOR }, orderBy: { createdAt: 'asc' } });
    return users.map(toUserDto);
  }

  /** New operators must change the initial password at first login. Usernames are global (login key). */
  async createUser(user: AuthUser, carrierId: string, input: CarrierUserCreateInput): Promise<CarrierUserDto> {
    const passwordHash = await this.passwords.hash(input.password);
    const created = await this.prisma.$transaction(
      async (tx) => {
        const c = await this.findOwned(user, carrierId, tx);
        const u = await tx.user.create({
          data: {
            tenantId: c.tenantId,
            role: 'CARRIER_OPERATOR',
            carrierId: c.id,
            username: input.username.toLowerCase(),
            displayName: input.displayName,
            passwordHash,
            mustChangePassword: true,
            createdBy: user.id,
          },
        });
        await this.audit.log({ action: 'carrier_user.created', entity: 'User', entityId: u.id, after: { ...toUserDto(u), carrierId: c.id } }, tx);
        return u;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return toUserDto(created);
  }

  private async findOperator(tx: PrismaTx, user: AuthUser, carrierId: string, userId: string): Promise<User> {
    const c = await this.findOwned(user, carrierId, tx);
    const u = await tx.user.findFirst({ where: { id: userId, carrierId: c.id, tenantId: c.tenantId, ...OPERATOR } });
    if (!u) throw new DomainError('NOT_FOUND');
    return u;
  }

  /** Sets a temporary password (must be changed at next login), clears lockout, revokes the user's sessions. */
  async resetPassword(user: AuthUser, carrierId: string, userId: string, newPassword: string): Promise<void> {
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction(
      async (tx) => {
        const u = await this.findOperator(tx, user, carrierId, userId);
        await tx.user.update({
          where: { id: u.id },
          data: { passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null },
        });
        await this.audit.log({ action: 'carrier_user.password_reset', entity: 'User', entityId: u.id }, tx);
      },
      { timeout: TX_TIMEOUT_MS },
    );
    await this.sessions.revokeUserFamilies(userId, 'password_changed');
  }

  async setUserActive(user: AuthUser, carrierId: string, userId: string, active: boolean): Promise<CarrierUserDto> {
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const u = await this.findOperator(tx, user, carrierId, userId);
        const a = await tx.user.update({ where: { id: u.id }, data: { status: active ? 'ACTIVE' : 'DISABLED' } });
        await this.audit.log(
          {
            action: active ? 'carrier_user.activated' : 'carrier_user.deactivated',
            entity: 'User',
            entityId: u.id,
            before: { status: u.status },
            after: { status: a.status },
          },
          tx,
        );
        return a;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    if (!active) await this.sessions.revokeUserFamilies(userId, 'disabled');
    return toUserDto(updated);
  }

  // ───────── quotas (D12) ─────────
  /** Current Jalali month first (even without a row), then up to 24 defined months, newest first. */
  async listQuotas(user: AuthUser, carrierId: string): Promise<CarrierQuotaDto[]> {
    const c = await this.findOwned(user, carrierId);
    const current = jalaliYearMonth(this.clock.now());
    const rows = await this.prisma.carrierQuota.findMany({
      where: { carrierId: c.id, tenantId: c.tenantId },
      orderBy: { yearMonth: 'desc' },
      take: QUOTA_HISTORY_MONTHS,
    });
    const months = [...new Set([current, ...rows.map((r) => r.yearMonth)])].sort().reverse();
    const byMonth = new Map(rows.map((r) => [r.yearMonth, r]));
    return Promise.all(
      months.map(async (ym) => {
        const u = await this.quota.usage(c.tenantId, c.id, ym);
        return {
          yearMonth: ym,
          tonnageLimitKg: u.limitKg === null ? null : u.limitKg.toString(),
          usedKg: u.usedKg.toString(),
          updatedAt: isoOrNull(byMonth.get(ym)?.updatedAt),
        };
      }),
    );
  }

  /**
   * Upsert of one month's limit. Takes the same advisory lock as QuotaService.assertCanConsume so a
   * limit change and a concurrent announcement are serialised.
   * ASSUMPTION(Q-D-3): months before the current Jalali month are read-only (history is not rewritten).
   * Lowering a limit below current usage is allowed; it only blocks further announcements.
   */
  async upsertQuota(user: AuthUser, carrierId: string, input: CarrierQuotaUpsertInput): Promise<CarrierQuotaDto> {
    const current = jalaliYearMonth(this.clock.now());
    if (input.yearMonth < current) throw new DomainError('INVALID_STATE', { yearMonth: input.yearMonth, current });
    const limit = BigInt(input.tonnageLimitKg);
    const saved = await this.prisma.$transaction(
      async (tx) => {
        const c = await this.findOwned(user, carrierId, tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quota:${c.id}:${input.yearMonth}`}))`;
        const before = await tx.carrierQuota.findUnique({ where: { carrierId_yearMonth: { carrierId: c.id, yearMonth: input.yearMonth } } });
        const q = await tx.carrierQuota.upsert({
          where: { carrierId_yearMonth: { carrierId: c.id, yearMonth: input.yearMonth } },
          create: { tenantId: c.tenantId, carrierId: c.id, yearMonth: input.yearMonth, tonnageLimitKg: limit, createdBy: user.id },
          update: { tonnageLimitKg: limit },
        });
        await this.audit.log(
          {
            action: before ? 'carrier_quota.updated' : 'carrier_quota.created',
            entity: 'CarrierQuota',
            entityId: q.id,
            before: before ? { yearMonth: before.yearMonth, tonnageLimitKg: before.tonnageLimitKg } : null,
            after: { carrierId: c.id, yearMonth: q.yearMonth, tonnageLimitKg: q.tonnageLimitKg },
          },
          tx,
        );
        return { q, tenantId: c.tenantId };
      },
      { timeout: TX_TIMEOUT_MS },
    );
    const u = await this.quota.usage(saved.tenantId, saved.q.carrierId, saved.q.yearMonth);
    return {
      yearMonth: saved.q.yearMonth,
      tonnageLimitKg: saved.q.tonnageLimitKg.toString(),
      usedKg: u.usedKg.toString(),
      updatedAt: saved.q.updatedAt.toISOString(),
    };
  }
}
