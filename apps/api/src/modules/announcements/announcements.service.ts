import { Injectable } from '@nestjs/common';
import type { Announcement } from '@prisma/client';
import {
  announcementInputSchema,
  isoDateToJalaliYearMonth,
  localDate,
  localTime,
  type AnnouncementInput,
} from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedCarrier, type CarrierScope } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { FieldCrypto } from '../../common/crypto/field-crypto';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService, TX_TIMEOUT_MS, type PrismaTx } from '../../common/prisma/prisma.service';
import { QuotaService } from '../../common/quota/quota.service';
import { parseWith } from '../../common/validation/zod';
import { AuditService } from '../audit/audit.service';
import {
  baseAllocation,
  canCancel,
  countUnits,
  editBlock,
  planTruckCountChange,
  quotaKg,
  resolveCreateAllocation,
} from './allocation-rules';
import {
  lockAnnouncement,
  lockUnits,
  mergeExtra,
  nextAnnouncementNumber,
  snapshot,
  toData,
  toFormValues,
} from './announcement-data';
import { AnnouncementRefsService } from './announcement-refs.service';

const invalid = (path: string, message: string) => new DomainError('VALIDATION_FAILED', { issues: [{ path, message }] });

/** Carrier write side: create / edit / copy / cancel (US-B3, BR-08, AC-11, D12). */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refs: AnnouncementRefsService,
    private readonly quota: QuotaService,
    private readonly audit: AuditService,
    private readonly crypto: FieldCrypto,
    private readonly clock: ClockService,
  ) {}

  private encrypt = (plain: string): string => this.crypto.encrypt(plain);

  private decrypt = (enc: string | null): string | null => {
    if (!enc) return null;
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return null;
    }
  };

  private assertNotPast(date: string): void {
    // ASSUMPTION(Q-E-5): an announcement cannot be dated before today (Asia/Tehran, server clock).
    if (date < localDate(this.clock.now())) throw invalid('announceDate', 'تاریخ اعلام بار نمی‌تواند قبل از امروز باشد');
  }

  private async assertCarrierActive(tx: PrismaTx, s: CarrierScope): Promise<void> {
    const c = await tx.carrier.findFirst({ where: { id: s.carrierId, tenantId: s.tenantId, deletedAt: null } });
    if (!c) throw new DomainError('FORBIDDEN');
    if (c.status !== 'ACTIVE') throw new DomainError('CARRIER_SUSPENDED');
  }

  private async hallDayId(tx: PrismaTx, hallId: string, date: string): Promise<string | null> {
    const d = await tx.hallDay.findUnique({ where: { hallId_date: { hallId, date } }, select: { id: true } });
    return d?.id ?? null;
  }

  /** Creates the announcement and its `truckCount` OPEN load units in one transaction. Returns the id. */
  async create(user: AuthUser, input: AnnouncementInput, copiedFrom?: Announcement): Promise<string> {
    const s = scopedCarrier(user);
    this.assertNotPast(input.announceDate);
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertCarrierActive(tx, s);
        const refs = await this.refs.validate(tx, s, input);
        const alloc = resolveCreateAllocation(refs.hall, input.allocation, input.isFreeOutsideDestinations);
        if (!alloc.ok) throw invalid('allocation', 'نوع تخصیص با نوع سالن سازگار نیست');
        const yearMonth = isoDateToJalaliYearMonth(input.announceDate);
        await this.quota.assertCanConsume(tx, s.tenantId, s.carrierId, yearMonth, quotaKg(input.truckCount, input.weightToKg));
        const number = await nextAnnouncementNumber(tx, s.tenantId);
        const a = await tx.announcement.create({
          data: {
            ...toData(input, refs, this.encrypt),
            tenantId: s.tenantId,
            carrierId: s.carrierId,
            number,
            status: 'ACTIVE',
            hallDayId: await this.hallDayId(tx, input.hallId, input.announceDate),
            extra: mergeExtra({}, input.extra),
            createdBy: user.id,
          },
        });
        await tx.loadUnit.createMany({
          data: Array.from({ length: input.truckCount }, (_, i) => ({
            tenantId: s.tenantId,
            announcementId: a.id,
            seq: i + 1,
            allocation: alloc.allocation,
          })),
        });
        await this.audit.log(
          {
            action: copiedFrom ? 'announcement.copy' : 'announcement.create',
            entity: 'announcement',
            entityId: a.id,
            after: snapshot(a, { allocation: alloc.allocation, yearMonth, copiedFromId: copiedFrom?.id }),
          },
          tx,
        );
        return a.id;
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }

  /** Copy: with a body = the (edited) prefilled form; without = clone dated today/now (Tehran). */
  async copy(user: AuthUser, sourceId: string, body: AnnouncementInput | null): Promise<string> {
    const s = scopedCarrier(user);
    const src = await this.prisma.announcement.findFirst({
      where: { id: sourceId, tenantId: s.tenantId, carrierId: s.carrierId, deletedAt: null },
      include: { units: { where: { seq: 1 }, include: { allocationChanges: { orderBy: { at: 'asc' } } } } },
    });
    if (!src) throw new DomainError('NOT_FOUND');
    let input = body;
    if (!input) {
      const firstUnit = src.units[0];
      const hall = await this.prisma.hall.findFirst({ where: { id: src.hallId, tenantId: s.tenantId } });
      const alloc = firstUnit
        ? baseAllocation({ allocation: firstUnit.allocation, changes: firstUnit.allocationChanges })
        : (hall?.defaultAllocation ?? 'FREE');
      const now = this.clock.now();
      // ASSUMPTION(Q-E-5): a body-less copy keeps every field but is dated today at the current Tehran time.
      input = parseWith(announcementInputSchema, {
        ...toFormValues(src, this.decrypt, alloc),
        announceDate: localDate(now),
        announceTime: localTime(now),
      });
    }
    return this.create(user, input, src);
  }

  /**
   * Full replace of the form fields. Immutable after creation: hall, allocation, BR-11 flag
   * (change units via the allocation endpoints, or cancel + copy). truckCount grows/shrinks OPEN units.
   */
  async update(user: AuthUser, id: string, input: AnnouncementInput): Promise<void> {
    const s = scopedCarrier(user);
    await this.prisma.$transaction(
      async (tx) => {
        await this.assertCarrierActive(tx, s);
        const prev = await lockAnnouncement(tx, s, id);
        if (!prev) throw new DomainError('NOT_FOUND');
        const units = await lockUnits(tx, id);
        const priorities = await tx.bagPriority.count({ where: { announcementId: id } });
        const block = editBlock(prev.status, countUnits(units), priorities);
        if (block === 'NOT_ACTIVE') throw new DomainError('INVALID_STATE', { reason: block });
        if (block) throw new DomainError('HAS_ACTIVE_RESERVATIONS', { reason: block });

        const first = units.find((u) => u.seq === 1) ?? units[0];
        const changes = first
          ? await tx.loadUnitAllocationChange.findMany({ where: { unitId: first.id }, orderBy: { at: 'asc' } })
          : [];
        const base = first ? baseAllocation({ allocation: first.allocation, changes }) : 'FREE';
        if (input.hallId !== prev.hallId) throw invalid('hallId', 'سالن اعلام بار پس از ثبت قابل تغییر نیست');
        if (input.isFreeOutsideDestinations !== prev.isFreeOutsideDestinations) {
          throw invalid('isFreeOutsideDestinations', 'این گزینه پس از ثبت قابل تغییر نیست');
        }
        if (input.allocation !== undefined && input.allocation !== base) {
          throw invalid('allocation', 'نوع تخصیص را از جزئیات واحدها تغییر دهید');
        }
        if (input.announceDate !== prev.announceDate) this.assertNotPast(input.announceDate);
        const refs = await this.refs.validate(tx, s, input, prev);

        // D12 quota: only a growth of consumption (or a move to another month) needs room.
        const live = units.filter((u) => u.state !== 'CANCELLED').length;
        const oldKg = quotaKg(live, prev.weightToKg);
        const newKg = quotaKg(input.truckCount, input.weightToKg);
        const oldMonth = isoDateToJalaliYearMonth(prev.announceDate);
        const newMonth = isoDateToJalaliYearMonth(input.announceDate);
        if (newMonth !== oldMonth) await this.quota.assertCanConsume(tx, s.tenantId, s.carrierId, newMonth, newKg);
        else if (newKg > oldKg) await this.quota.assertCanConsume(tx, s.tenantId, s.carrierId, newMonth, newKg - oldKg);

        const next = await tx.announcement.update({
          where: { id },
          data: {
            ...toData(input, refs, this.encrypt),
            hallDayId: input.announceDate === prev.announceDate ? prev.hallDayId : await this.hallDayId(tx, prev.hallId, input.announceDate),
            extra: mergeExtra(prev.extra, input.extra),
          },
        });
        const plan = planTruckCountChange(units, input.truckCount);
        if (plan.add.length) {
          await tx.loadUnit.createMany({
            data: plan.add.map((seq) => ({ tenantId: s.tenantId, announcementId: id, seq, allocation: base })),
          });
        }
        if (plan.cancel.length) {
          await tx.loadUnit.updateMany({
            where: { id: { in: plan.cancel }, state: 'OPEN' },
            data: { state: 'CANCELLED', version: { increment: 1 } },
          });
        }
        await this.audit.log(
          {
            action: 'announcement.update',
            entity: 'announcement',
            entityId: id,
            before: snapshot(prev, { units: live }),
            after: snapshot(next, { units: input.truckCount, addedSeqs: plan.add, cancelledUnits: plan.cancel }),
          },
          tx,
        );
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }

  /** Cancels an ACTIVE announcement with no engaged unit; its OPEN units become CANCELLED (quota is released). */
  async cancel(user: AuthUser, id: string, reason: string): Promise<void> {
    const s = scopedCarrier(user);
    await this.prisma.$transaction(
      async (tx) => {
        const prev = await lockAnnouncement(tx, s, id);
        if (!prev) throw new DomainError('NOT_FOUND');
        if (prev.status === 'CANCELLED') return; // idempotent repeat
        const units = await lockUnits(tx, id);
        const counts = countUnits(units);
        if (prev.status !== 'ACTIVE') throw new DomainError('INVALID_STATE', { status: prev.status });
        if (!canCancel(prev.status, counts)) throw new DomainError('HAS_ACTIVE_RESERVATIONS');
        const cancelled = await tx.loadUnit.updateMany({
          where: { announcementId: id, state: 'OPEN' },
          data: { state: 'CANCELLED', version: { increment: 1 } },
        });
        const next = await tx.announcement.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
        await this.audit.log(
          {
            action: 'announcement.cancel',
            entity: 'announcement',
            entityId: id,
            before: snapshot(prev),
            after: snapshot(next, { cancelledUnits: cancelled.count }),
            reason,
          },
          tx,
        );
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }
}
