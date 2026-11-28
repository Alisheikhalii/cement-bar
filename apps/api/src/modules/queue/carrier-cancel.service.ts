/**
 * Carrier-side queue actions: approve/reject cancellation requests (BR-09, AC-8) and manual FREE
 * permits (US-B9). Carrier identity is taken only from the session.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type CancelRequestStatus,
  type CarrierCancelRequestDto,
  type CarrierDecisionInput,
} from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedCarrier } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService, TX_TIMEOUT_MS, type PrismaTx } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { counterRange, bulkPolicy, freePolicy, timedPolicy } from './queue-support';
import { destinationLabel } from './queue-mappers';

export interface ManualPermitInput {
  announcementId: string;
  driverId: string;
  reason: string;
}

const cancelInclude = {
  reservation: {
    include: {
      driver: true,
      unit: { include: { announcement: { include: { carrier: true } } } },
    },
  },
} satisfies Prisma.CancelRequestInclude;
type CancelFull = Prisma.CancelRequestGetPayload<{ include: typeof cancelInclude }>;

@Injectable()
export class CarrierCancelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly publisher: RealtimePublisher,
  ) {}

  private get db(): PrismaTx {
    return this.prisma;
  }

  // ───────────────────────── GET /carrier/cancel-requests ─────────────────────────
  async list(user: AuthUser, status: CancelRequestStatus | undefined): Promise<CarrierCancelRequestDto[]> {
    const scope = scopedCarrier(user);
    const rows = await this.prisma.cancelRequest.findMany({
      where: { tenantId: scope.tenantId, carrierId: scope.carrierId, ...(status ? { status } : {}) },
      include: cancelInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const out: CarrierCancelRequestDto[] = [];
    for (const r of rows) out.push(await this.toDto(r));
    return out;
  }

  private async toDto(r: CancelFull): Promise<CarrierCancelRequestDto> {
    const res = r.reservation;
    const a = res.unit.announcement;
    return {
      id: r.id,
      status: r.status,
      reason: r.reason,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      driverName: `${res.driver.firstName} ${res.driver.lastName}`,
      carrierName: a.carrier.name,
      reservation: {
        id: res.id,
        permitNo: res.permitNo,
        status: res.status,
        announcementNumber: a.number,
        unitSeq: res.unit.seq,
        destinationTitle: (await destinationLabel(this.db, a)) ?? '',
      },
    };
  }

  // ───────────────────────── POST /carrier/cancel-requests/:id/approve ─────────────────────────
  async approve(user: AuthUser, id: string, input: CarrierDecisionInput): Promise<CarrierCancelRequestDto> {
    const scope = scopedCarrier(user);
    const now = this.clock.now();
    const freed = await this.prisma.$transaction(
      async (tx) => {
        const cr = await tx.cancelRequest.findFirst({
          where: { id, tenantId: scope.tenantId, carrierId: scope.carrierId },
          include: cancelInclude,
        });
        if (!cr) throw new DomainError('NOT_FOUND');
        if (cr.status !== 'PENDING') throw new DomainError('INVALID_STATE', { status: cr.status });
        const res = cr.reservation;
        if (res.status !== 'CANCEL_REQUESTED') throw new DomainError('INVALID_STATE', { status: res.status });

        const upd = await tx.reservation.updateMany({
          where: { id: res.id, status: 'CANCEL_REQUESTED' },
          data: { status: 'CANCELLED', cancelledAt: now },
        });
        if (upd.count !== 1) throw new DomainError('INVALID_STATE');
        // Unit returns to its prior allocation unchanged (BR-09).
        await tx.loadUnit.updateMany({
          where: { id: res.unitId, currentReservationId: res.id },
          data: { state: 'OPEN', currentReservationId: null, version: { increment: 1 } },
        });

        const a = res.unit.announcement;
        const hours = await this.penaltyHours(tx, a.hallId, res.source);
        await tx.driverPenalty.create({
          data: {
            tenantId: scope.tenantId,
            driverId: res.driverId,
            reason: 'CANCEL_APPROVED',
            until: new Date(now.getTime() + hours * 60 * 60_000),
            sourceReservationId: res.id,
            note: input.note ?? null,
            createdBy: user.id,
          },
        });
        await tx.cancelRequest.update({
          where: { id: cr.id },
          data: { status: 'APPROVED', decidedBy: user.id, decidedAt: now, decisionNote: input.note ?? null },
        });
        await tx.queueEvent.create({
          data: {
            tenantId: scope.tenantId,
            hallDayId: res.hallDayId,
            carrierId: scope.carrierId,
            type: 'CANCEL_APPROVED',
            payload: { reservationId: res.id, cancelRequestId: cr.id, driverId: res.driverId, unitId: res.unitId, penaltyHours: hours } satisfies Prisma.InputJsonObject,
            actorId: user.id,
          },
        });
        await tx.queueEvent.create({
          data: {
            tenantId: scope.tenantId,
            hallDayId: res.hallDayId,
            carrierId: scope.carrierId,
            type: 'UNIT_FREED',
            payload: { reservationId: res.id, unitId: res.unitId, announcementId: a.id, reason: 'CANCEL_APPROVED' } satisfies Prisma.InputJsonObject,
            actorId: user.id,
          },
        });
        await this.audit.log(
          {
            action: 'cancel_request.approve',
            entity: 'CancelRequest',
            entityId: cr.id,
            before: { reservationStatus: res.status, requestStatus: cr.status },
            after: { reservationStatus: 'CANCELLED', requestStatus: 'APPROVED', penaltyHours: hours },
            reason: input.note ?? null,
            tenantId: scope.tenantId,
          },
          tx,
        );
        await this.notifyDriver(tx, scope.tenantId, res.driver.userId, 'تأیید لغو مجوز', 'درخواست لغو شما تأیید شد.', { reservationId: res.id });
        return { hallId: a.hallId, announcementId: a.id, unitId: res.unitId, carrierId: a.carrierId };
      },
      { timeout: TX_TIMEOUT_MS },
    );
    await this.publisher.publish({
      type: 'unit.freed',
      tenantId: scope.tenantId,
      hallId: freed.hallId,
      at: now.toISOString(),
      payload: { announcementId: freed.announcementId, unitId: freed.unitId, carrierId: freed.carrierId },
    });
    return this.reload(id);
  }

  // ───────────────────────── POST /carrier/cancel-requests/:id/reject ─────────────────────────
  async reject(user: AuthUser, id: string, input: CarrierDecisionInput): Promise<CarrierCancelRequestDto> {
    const scope = scopedCarrier(user);
    const now = this.clock.now();
    await this.prisma.$transaction(
      async (tx) => {
        const cr = await tx.cancelRequest.findFirst({
          where: { id, tenantId: scope.tenantId, carrierId: scope.carrierId },
          include: cancelInclude,
        });
        if (!cr) throw new DomainError('NOT_FOUND');
        if (cr.status !== 'PENDING') throw new DomainError('INVALID_STATE', { status: cr.status });
        const res = cr.reservation;
        const restore = res.statusBeforeCancelRequest ?? 'RESERVED';
        const upd = await tx.reservation.updateMany({
          where: { id: res.id, status: 'CANCEL_REQUESTED' },
          data: { status: restore, statusBeforeCancelRequest: null },
        });
        if (upd.count !== 1) throw new DomainError('INVALID_STATE');
        await tx.cancelRequest.update({
          where: { id: cr.id },
          data: { status: 'REJECTED', decidedBy: user.id, decidedAt: now, decisionNote: input.note ?? null },
        });
        await tx.queueEvent.create({
          data: {
            tenantId: scope.tenantId,
            hallDayId: res.hallDayId,
            carrierId: scope.carrierId,
            type: 'CANCEL_REJECTED',
            payload: { reservationId: res.id, cancelRequestId: cr.id, restoredStatus: restore } satisfies Prisma.InputJsonObject,
            actorId: user.id,
          },
        });
        await this.audit.log(
          {
            action: 'cancel_request.reject',
            entity: 'CancelRequest',
            entityId: cr.id,
            before: { reservationStatus: res.status, requestStatus: cr.status },
            after: { reservationStatus: restore, requestStatus: 'REJECTED' },
            reason: input.note ?? null,
            tenantId: scope.tenantId,
          },
          tx,
        );
        await this.notifyDriver(tx, scope.tenantId, res.driver.userId, 'رد درخواست لغو', 'درخواست لغو شما رد شد و مجوز شما معتبر است.', { reservationId: res.id });
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return this.reload(id);
  }

  // ───────────────────────── POST /carrier/permits/manual ─────────────────────────
  async manualPermit(user: AuthUser, input: ManualPermitInput): Promise<{ id: string; permitNo: number }> {
    const scope = scopedCarrier(user);
    const now = this.clock.now();
    return this.prisma.$transaction(
      async (tx) => {
        const ann = await tx.announcement.findFirst({
          where: { id: input.announcementId, tenantId: scope.tenantId, carrierId: scope.carrierId, status: 'ACTIVE', deletedAt: null },
          select: { id: true, hallId: true, hallDayId: true, number: true },
        });
        if (!ann) throw new DomainError('NOT_FOUND');
        const driver = await tx.driver.findFirst({
          where: { id: input.driverId, tenantId: scope.tenantId, carrierId: scope.carrierId, status: 'APPROVED', deletedAt: null },
          select: { id: true, userId: true },
        });
        if (!driver) throw new DomainError('INVALID_STATE', { reason: 'DRIVER_NOT_APPROVED' });
        const unit = await tx.loadUnit.findFirst({
          where: { announcementId: ann.id, allocation: 'FREE', state: 'OPEN' },
          orderBy: { seq: 'asc' },
        });
        if (!unit) throw new DomainError('NO_UNIT_AVAILABLE');
        const permitNo = (await counterRange(tx, scope.tenantId, 'permit', 1))[0]!;
        const reservation = await tx.reservation.create({
          data: {
            tenantId: scope.tenantId,
            permitNo,
            unitId: unit.id,
            driverId: driver.id,
            carrierId: scope.carrierId,
            source: 'MANUAL',
            hallDayId: ann.hallDayId,
            status: 'RESERVED',
            reservedAt: now,
            manualReason: input.reason,
            createdBy: user.id,
          },
        });
        const upd = await tx.loadUnit.updateMany({
          where: { id: unit.id, state: 'OPEN' },
          data: { state: 'RESERVED', currentReservationId: reservation.id, version: { increment: 1 } },
        });
        if (upd.count !== 1) throw new DomainError('UNIT_TAKEN');
        await tx.queueEvent.create({
          data: {
            tenantId: scope.tenantId,
            hallDayId: ann.hallDayId,
            carrierId: scope.carrierId,
            type: 'MANUAL_GRANT',
            payload: { reservationId: reservation.id, permitNo, unitId: unit.id, announcementId: ann.id, driverId: driver.id, reason: input.reason } satisfies Prisma.InputJsonObject,
            actorId: user.id,
          },
        });
        await this.audit.log(
          {
            action: 'permit.manual',
            entity: 'Reservation',
            entityId: reservation.id,
            after: { permitNo, unitId: unit.id, announcementId: ann.id, driverId: driver.id, source: 'MANUAL' },
            reason: input.reason,
            tenantId: scope.tenantId,
          },
          tx,
        );
        return { id: reservation.id, permitNo };
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }

  // ───────────────────────── helpers ─────────────────────────
  private async penaltyHours(tx: PrismaTx, hallId: string, source: string): Promise<number> {
    if (source === 'TIMED') return (await timedPolicy(tx, hallId)).cancelPenaltyHours;
    if (source === 'GROUP') return (await bulkPolicy(tx, hallId)).cancelPenaltyHours;
    return (await freePolicy(tx, hallId)).cancelPenaltyHours;
  }

  private async notifyDriver(tx: PrismaTx, tenantId: string, userId: string, title: string, body: string, data: Prisma.InputJsonObject): Promise<void> {
    await tx.notification.create({ data: { tenantId, userId, type: 'CANCEL_DECISION', title, body, data } });
  }

  private async reload(id: string): Promise<CarrierCancelRequestDto> {
    const cr = await this.prisma.cancelRequest.findUniqueOrThrow({ where: { id }, include: cancelInclude });
    return this.toDto(cr);
  }
}
