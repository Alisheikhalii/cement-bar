import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma, type Role } from '@prisma/client';
import { ClockService } from '../../common/clock/clock.service';
import { requestContext } from '../../common/context/request-context';
import { PrismaService, type PrismaTx } from '../../common/prisma/prisma.service';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  /** Override actor when there is no authenticated user yet (e.g. login). */
  actor?: { id: string; role: Role; tenantId: string };
  tenantId?: string | null;
}

function toJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (v === undefined || v === null) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(v, (_k, val: unknown) => (typeof val === 'bigint' ? val.toString() : val)));
}

/** Append-only audit trail. Actor/ip/userAgent/requestId come from the request context. */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async log(entry: AuditEntry, tx?: PrismaTx): Promise<void> {
    const ctx = requestContext.get();
    const actor = entry.actor ?? ctx?.user;
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        tenantId: entry.tenantId ?? actor?.tenantId ?? null,
        actorId: actor?.id ?? null,
        actorRole: actor?.role ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        reason: entry.reason ?? null,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
        at: this.clock.now(),
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
