import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TableRow } from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedTenant } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import type { ParsedList } from '../../common/list/list-query';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { ci } from './factory.util';

/** Read-only audit trail of the tenant + active session management. */
@Injectable()
export class AuditSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async listAudit(user: AuthUser, p: ParsedList): Promise<{ rows: TableRow[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {
      ...scopedTenant(user),
      AND: p.where as Prisma.AuditLogWhereInput[],
      ...(p.q ? { OR: [{ action: ci(p.q) }, { entity: ci(p.q) }, { entityId: ci(p.q) }, { reason: ci(p.q) }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [...(p.orderBy as Prisma.AuditLogOrderByWithRelationInput[]), { at: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const actorIds = [...new Set(items.map((i) => i.actorId).filter((x): x is string => !!x))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds }, ...scopedTenant(user) }, select: { id: true, displayName: true } })
      : [];
    const name = new Map(actors.map((a) => [a.id, a.displayName]));
    const rows = items.map((a) => ({
      id: a.id,
      at: a.at.toISOString(),
      actorName: a.actorId ? (name.get(a.actorId) ?? null) : null,
      actorRole: a.actorRole,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      reason: a.reason,
      ip: a.ip,
    }));
    return { rows, total };
  }

  private activeWhere(user: AuthUser): Prisma.SessionWhereInput {
    return { revokedAt: null, expiresAt: { gt: this.clock.now() }, user: { ...scopedTenant(user) } };
  }

  /** One row per active session family (rotation keeps exactly one non-revoked row per family). */
  async listSessions(user: AuthUser, p: ParsedList): Promise<{ rows: TableRow[]; total: number }> {
    const where: Prisma.SessionWhereInput = {
      ...this.activeWhere(user),
      AND: [
        ...(p.where as Prisma.SessionWhereInput[]),
        ...(p.q ? [{ OR: [{ user: { displayName: ci(p.q) } }, { user: { username: ci(p.q) } }, { user: { mobile: ci(p.q) } }] }] : []),
      ],
    };
    const [items, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        orderBy: [...(p.orderBy as Prisma.SessionOrderByWithRelationInput[]), { lastUsedAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        include: { user: { select: { displayName: true, username: true, mobile: true, role: true, carrier: { select: { name: true } } } } },
      }),
      this.prisma.session.count({ where }),
    ]);
    const rows = items.map((s) => ({
      id: s.id,
      userName: s.user.displayName,
      identifier: s.user.username ?? s.user.mobile,
      role: s.user.role,
      carrierName: s.user.carrier?.name ?? null,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      ip: s.ip,
      deviceInfo: s.deviceInfo,
    }));
    return { rows, total };
  }

  /** Revokes the whole family of an active session of the tenant (the user must log in again). */
  async revokeSession(user: AuthUser, sessionId: string): Promise<void> {
    const s = await this.prisma.session.findFirst({
      where: { id: sessionId, ...this.activeWhere(user) },
      select: { id: true, familyId: true, userId: true },
    });
    if (!s) throw new DomainError('NOT_FOUND');
    await this.sessions.revokeFamily(s.familyId, 'logout');
    await this.audit.log({ action: 'session.revoked_by_factory', entity: 'Session', entityId: s.familyId, after: { userId: s.userId } });
  }
}
