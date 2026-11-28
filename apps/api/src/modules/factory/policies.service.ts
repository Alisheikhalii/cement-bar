import { Injectable } from '@nestjs/common';
import type { Prisma, QueuePolicy } from '@prisma/client';
import { policyParamsByStrategy, type PolicyCreateInput, type PolicyDto, type StrategyCode } from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedTenant } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService, TX_TIMEOUT_MS } from '../../common/prisma/prisma.service';
import { parseWith } from '../../common/validation/zod';
import { AuditService } from '../audit/audit.service';
import { isStrategyCompatible } from './hall-days';
import type { ZodType } from 'zod';

function toDto(p: QueuePolicy & { hall: { title: string } }, current: boolean): PolicyDto {
  return {
    id: p.id,
    hallId: p.hallId,
    hallTitle: p.hall.title,
    strategy: p.strategy,
    version: p.version,
    params: (p.params ?? {}) as Record<string, unknown>,
    activeFrom: p.activeFrom.toISOString(),
    note: p.note,
    createdAt: p.createdAt.toISOString(),
    current,
  };
}

/**
 * Versioned queue policies: every POST inserts version max+1 for (hall, strategy); rows are never updated,
 * so the full history stays queryable and hall days can snapshot the version they ran with.
 */
@Injectable()
export class PoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, hallId?: string): Promise<PolicyDto[]> {
    const rows = await this.prisma.queuePolicy.findMany({
      where: { ...scopedTenant(user), ...(hallId ? { hallId } : {}) },
      include: { hall: { select: { title: true } } },
      orderBy: [{ hallId: 'asc' }, { strategy: 'asc' }, { version: 'desc' }],
    });
    const latest = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.hallId}:${r.strategy}`;
      latest.set(k, Math.max(latest.get(k) ?? 0, r.version));
    }
    return rows.map((r) => toDto(r, latest.get(`${r.hallId}:${r.strategy}`) === r.version));
  }

  async create(user: AuthUser, input: PolicyCreateInput): Promise<PolicyDto> {
    const strategy = input.strategy as StrategyCode;
    // Strict per-strategy schema: unknown keys rejected, defaults filled → stored params are complete.
    const schema: ZodType<Record<string, unknown>> = policyParamsByStrategy[strategy];
    const params = parseWith(schema, input.params) as Prisma.InputJsonObject;
    const created = await this.prisma.$transaction(
      async (tx) => {
        const hall = await tx.hall.findFirst({ where: { id: input.hallId, ...scopedTenant(user) } });
        if (!hall) throw new DomainError('NOT_FOUND');
        if (!isStrategyCompatible(hall.category, strategy)) {
          throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'strategy', message: 'incompatible with hall category' }] });
        }
        // Serialise version allocation per (hall, strategy); unique(hallId, strategy, version) is the backstop.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`policy:${hall.id}:${strategy}`}))`;
        const last = await tx.queuePolicy.findFirst({ where: { hallId: hall.id, strategy }, orderBy: { version: 'desc' }, select: { version: true } });
        const p = await tx.queuePolicy.create({
          data: {
            tenantId: hall.tenantId,
            hallId: hall.id,
            strategy,
            version: (last?.version ?? 0) + 1,
            params,
            activeFrom: this.clock.now(),
            note: input.note ?? null,
            createdBy: user.id,
          },
          include: { hall: { select: { title: true } } },
        });
        await this.audit.log(
          { action: 'policy.version_created', entity: 'QueuePolicy', entityId: p.id, after: { hallId: p.hallId, strategy, version: p.version, params } },
          tx,
        );
        return p;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return toDto(created, true);
  }
}
