import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PERMIT_TRANSITIONS, type PermitAction, type PermitView, type ReservationStatus, type TableRow } from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedCarrier } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import type { ParsedList } from '../../common/list/list-query';
import { PrismaService, TX_TIMEOUT_MS } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertUuid } from './ids';
import { PermitRowsService } from './permit-rows.service';
import { PERMIT_ACTION_TIMESTAMP, nextPermitStatus } from './permit-state';

export interface PermitActionResult {
  id: string;
  permitNo: number;
  from: ReservationStatus;
  status: ReservationStatus;
}

@Injectable()
export class CarrierPermitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly rows: PermitRowsService,
  ) {}

  list(user: AuthUser, p: ParsedList, view: PermitView | undefined): Promise<{ rows: TableRow[]; total: number }> {
    return this.rows.list(this.rows.where(scopedCarrier(user), p, view), p);
  }

  /**
   * Operational status change by the operator of the carrier that OWNS the load (PRD §5.5, T8).
   * The conditional UPDATE (status ∈ allowed `from`) makes concurrent/duplicate requests safe:
   * exactly one wins, the other gets INVALID_STATE.
   */
  async act(user: AuthUser, id: string, action: PermitAction, note: string | undefined): Promise<PermitActionResult> {
    const scope = scopedCarrier(user);
    const now = this.clock.now();
    return this.prisma.$transaction(
      async (tx) => {
        const r = await tx.reservation.findFirst({ where: { id: assertUuid(id), ...scope } });
        if (!r) throw new DomainError('NOT_FOUND');
        const to = nextPermitStatus(action, r.status);
        if (!to) throw new DomainError('INVALID_STATE', { status: r.status, action });
        const data: Prisma.ReservationUpdateManyMutationInput = { status: to };
        const stamp = PERMIT_ACTION_TIMESTAMP[action];
        if (stamp) data[stamp] = now;
        if (action === 'return') data.returnReason = note ?? null;
        const res = await tx.reservation.updateMany({
          where: { id: r.id, ...scope, status: { in: [...PERMIT_TRANSITIONS[action].from] } },
          data,
        });
        if (res.count !== 1) throw new DomainError('INVALID_STATE', { action });
        // ASSUMPTION(Q-F-5): the load unit's state is NOT changed here (EXITED/NO_SHOW/RETURNED);
        // freeing or consuming units is an allocation rule owned by the queue engine (Phase 3).
        const eventType = `PERMIT_${to}`;
        await tx.queueEvent.create({
          data: {
            tenantId: scope.tenantId,
            hallDayId: r.hallDayId,
            carrierId: scope.carrierId,
            type: eventType,
            payload: { reservationId: r.id, permitNo: r.permitNo, unitId: r.unitId, from: r.status, to, note: note ?? null },
            actorId: user.id,
          },
        });
        await this.audit.log(
          {
            action: `permit.${action}`,
            entity: 'Reservation',
            entityId: r.id,
            before: { status: r.status },
            after: { status: to, ...(stamp ? { [stamp]: now } : {}) },
            reason: note ?? null,
          },
          tx,
        );
        return { id: r.id, permitNo: r.permitNo, from: r.status, status: to };
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }
}
