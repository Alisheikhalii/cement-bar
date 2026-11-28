import { Injectable } from '@nestjs/common';
import type { Allocation, AllocationChangeResultDto } from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedCarrier } from '../../common/auth/scoped';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService, TX_TIMEOUT_MS } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { checkAllocationChange } from './allocation-rules';
import { lockAnnouncement, lockUnits } from './announcement-data';
import { unitDto } from './announcement-query.service';

/** SPEC §2.5 queue_events types for BR-10 changes. */
export const UNIT_FREED = 'UNIT_FREED';
export const UNIT_REGROUPED = 'UNIT_REGROUPED';

/**
 * BR-10 allocation changes of an announcement's OPEN units (single or bulk, all-or-nothing).
 * Each changed unit gets a load_unit_allocation_changes row and a queue_events row; one audit entry per request.
 * Units already at the target are skipped (idempotent repeat).
 */
@Injectable()
export class UnitAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async change(
    user: AuthUser,
    announcementId: string,
    unitIds: string[],
    to: Allocation,
    reason: string,
  ): Promise<AllocationChangeResultDto> {
    const s = scopedCarrier(user);
    const wanted = [...new Set(unitIds)];
    return this.prisma.$transaction(
      async (tx) => {
        const ann = await lockAnnouncement(tx, s, announcementId);
        if (!ann) throw new DomainError('NOT_FOUND');
        if (ann.status !== 'ACTIVE') throw new DomainError('INVALID_STATE', { status: ann.status });
        const locked = await lockUnits(tx, announcementId, wanted);
        if (locked.length !== wanted.length) throw new DomainError('NOT_FOUND');
        const history = await tx.loadUnitAllocationChange.findMany({
          where: { unitId: { in: wanted }, tenantId: s.tenantId },
          orderBy: { at: 'asc' },
        });

        const toChange: { id: string; seq: number; from: Allocation }[] = [];
        const rejected: { unitId: string; seq: number; reason: string }[] = [];
        for (const u of locked) {
          const d = checkAllocationChange({ allocation: u.allocation, state: u.state, changes: history.filter((h) => h.unitId === u.id) }, to);
          if (!d.ok) rejected.push({ unitId: u.id, seq: u.seq, reason: d.reason });
          else if (!d.noop) toChange.push({ id: u.id, seq: u.seq, from: u.allocation });
        }
        if (rejected.length) throw new DomainError('INVALID_STATE', { units: rejected });

        if (toChange.length) {
          const ids = toChange.map((u) => u.id);
          const res = await tx.loadUnit.updateMany({
            where: { id: { in: ids }, announcementId, state: 'OPEN' },
            data: { allocation: to, version: { increment: 1 } },
          });
          if (res.count !== ids.length) throw new DomainError('CONFLICT');
          await tx.loadUnitAllocationChange.createMany({
            data: toChange.map((u) => ({ tenantId: s.tenantId, unitId: u.id, from: u.from, to, reason, actorId: user.id })),
          });
          await tx.queueEvent.createMany({
            data: toChange.map((u) => ({
              tenantId: s.tenantId,
              hallDayId: ann.hallDayId,
              carrierId: s.carrierId,
              type: to === 'FREE' ? UNIT_FREED : UNIT_REGROUPED,
              payload: { announcementId, hallId: ann.hallId, unitId: u.id, seq: u.seq, from: u.from, to, reason },
              actorId: user.id,
            })),
          });
          await this.audit.log(
            {
              action: 'load_unit.allocation_change',
              entity: 'announcement',
              entityId: announcementId,
              before: { units: toChange.map((u) => ({ id: u.id, seq: u.seq, allocation: u.from })) },
              after: { units: toChange.map((u) => ({ id: u.id, seq: u.seq, allocation: to })) },
              reason,
            },
            tx,
          );
        }
        const units = await tx.loadUnit.findMany({
          where: { announcementId },
          orderBy: { seq: 'asc' },
          include: { allocationChanges: { orderBy: { at: 'asc' } } },
        });
        return { changed: toChange.length, units: units.map(unitDto) };
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }
}
