import { Injectable } from '@nestjs/common';
import { Prisma, type ReservationStatus } from '@prisma/client';
import {
  localDate,
  localDateTimeToUtc,
  addDaysIso,
  vehiclePendingChangeSchema,
  type CarrierDriverDetailDto,
  type DriverDecisionInput,
  type TableRow,
  type VehiclePendingChange,
} from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedCarrier, type CarrierScope } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { FieldCrypto } from '../../common/crypto/field-crypto';
import { DomainError } from '../../common/errors/domain-error';
import { uniqueViolationField } from '../../common/errors/error-mapping';
import type { ParsedList } from '../../common/list/list-query';
import { PrismaService, TX_TIMEOUT_MS, type PrismaTx } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertUuid, isoDay } from './ids';

/** Reservations that are still "in progress" for the driver (vehicle change must not alter them). */
const IN_PROGRESS: ReservationStatus[] = ['RESERVED', 'ARRIVED', 'LOADED', 'CANCEL_REQUESTED'];

export interface DriverBlockInput {
  reason: string;
  until?: string;
}

const driverInclude = {
  user: { select: { mobile: true } },
  vehicles: { where: { active: true }, take: 1 },
} satisfies Prisma.DriverInclude;
type DriverWithVehicle = Prisma.DriverGetPayload<{ include: typeof driverInclude }>;

@Injectable()
export class CarrierDriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCrypto,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  private decryptOr(enc: string | null | undefined): string | null {
    if (!enc) return null;
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return null;
    }
  }

  private async loaderTitles(ids: (string | undefined | null)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((v): v is string => !!v))];
    if (!list.length) return new Map();
    const rows = await this.prisma.loaderType.findMany({ where: { id: { in: list } }, select: { id: true, title: true } });
    return new Map(rows.map((r) => [r.id, r.title]));
  }

  async list(user: AuthUser, p: ParsedList, opts: { vehicleChange: boolean }): Promise<{ rows: TableRow[]; total: number }> {
    const scope = scopedCarrier(user);
    const and: Prisma.DriverWhereInput[] = [{ ...scope, deletedAt: null }, ...(p.where as Prisma.DriverWhereInput[])];
    if (opts.vehicleChange) and.push({ vehicles: { some: { active: true, status: 'PENDING_CHANGE' } } });
    if (p.q) {
      const q = p.q;
      and.push({
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { user: { mobile: { contains: q } } },
          { vehicles: { some: { active: true, plate: { contains: q } } } },
        ],
      });
    }
    const where: Prisma.DriverWhereInput = { AND: and };
    const [items, total] = await Promise.all([
      this.prisma.driver.findMany({
        where,
        include: driverInclude,
        orderBy: p.orderBy.length ? (p.orderBy as Prisma.DriverOrderByWithRelationInput[]) : [{ createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.driver.count({ where }),
    ]);
    const titles = await this.loaderTitles(items.map((d) => d.vehicles[0]?.loaderTypeId));
    return { rows: items.map((d) => this.toRow(d, titles)), total };
  }

  private toRow(d: DriverWithVehicle, titles: Map<string, string>): TableRow {
    const v = d.vehicles[0];
    return {
      id: d.id,
      fullName: `${d.firstName} ${d.lastName}`,
      mobile: d.user.mobile,
      nationalId: this.decryptOr(d.nationalIdEnc),
      status: d.status,
      plate: v?.plate ?? null,
      loaderType: v ? (titles.get(v.loaderTypeId) ?? null) : null,
      vehicleStatus: v?.status ?? null,
      licenseNo: d.licenseNo,
      healthCardExpiry: isoDay(d.healthCardExpiry),
      smartCardExpiry: isoDay(v?.smartCardExpiry),
      inspectionExpiry: isoDay(v?.inspectionExpiry),
      blockReason: d.blockReason,
      decisionNote: d.decisionNote,
      createdAt: d.createdAt.toISOString(),
    };
  }

  /** Loads a driver of the caller's carrier or throws NOT_FOUND (IDOR-safe). */
  private async findOwn(scope: CarrierScope, id: string, db: PrismaTx = this.prisma): Promise<DriverWithVehicle> {
    const d = await db.driver.findFirst({ where: { id: assertUuid(id), ...scope, deletedAt: null }, include: driverInclude });
    if (!d) throw new DomainError('NOT_FOUND');
    return d;
  }

  async detail(user: AuthUser, id: string): Promise<CarrierDriverDetailDto> {
    const d = await this.findOwn(scopedCarrier(user), id);
    const v = d.vehicles[0];
    const pending = v?.pendingChange ? this.parsePending(v.pendingChange) : null;
    const titles = await this.loaderTitles([v?.loaderTypeId, pending?.loaderTypeId]);
    const cityIds = [d.birthCityId, d.residenceCityId].filter((c): c is number => c !== null);
    const cities = cityIds.length
      ? new Map((await this.prisma.city.findMany({ where: { id: { in: cityIds } } })).map((c) => [c.id, c.name]))
      : new Map<number, string>();
    return {
      id: d.id,
      status: d.status,
      firstName: d.firstName,
      lastName: d.lastName,
      mobile: d.user.mobile,
      nationalId: this.decryptOr(d.nationalIdEnc) ?? '',
      licenseNo: d.licenseNo,
      licenseIssueDate: isoDay(d.licenseIssueDate)!,
      birthCity: d.birthCityId !== null ? (cities.get(d.birthCityId) ?? null) : null,
      birthDate: isoDay(d.birthDate),
      residenceCity: d.residenceCityId !== null ? (cities.get(d.residenceCityId) ?? null) : null,
      address: d.address,
      postalCode: d.postalCode,
      phone: d.phone,
      healthCardExpiry: isoDay(d.healthCardExpiry)!,
      blockedUntil: d.blockedUntil?.toISOString() ?? null,
      blockReason: d.blockReason,
      decidedAt: d.decidedAt?.toISOString() ?? null,
      decisionNote: d.decisionNote,
      createdAt: d.createdAt.toISOString(),
      vehicle: v
        ? {
            id: v.id,
            plate: v.plate,
            smartCardNo: v.smartCardNo,
            loaderTypeId: v.loaderTypeId,
            loaderType: titles.get(v.loaderTypeId) ?? null,
            status: v.status,
            smartCardExpiry: isoDay(v.smartCardExpiry)!,
            inspectionExpiry: isoDay(v.inspectionExpiry)!,
            pendingChange: pending
              ? { ...pending, loaderType: pending.loaderTypeId ? (titles.get(pending.loaderTypeId) ?? null) : undefined }
              : null,
          }
        : null,
    };
  }

  private parsePending(raw: unknown): VehiclePendingChange | null {
    const r = vehiclePendingChangeSchema.safeParse(raw);
    return r.success ? r.data : null;
  }

  private notify(tx: PrismaTx, tenantId: string, userId: string, type: string, title: string, body: string) {
    return tx.notification.create({ data: { tenantId, userId, type, title, body } });
  }

  /** PENDING → APPROVED | REJECTED (D2 / US-B5). */
  async decide(user: AuthUser, id: string, input: DriverDecisionInput): Promise<{ id: string; status: string }> {
    const scope = scopedCarrier(user);
    const now = this.clock.now();
    return this.prisma.$transaction(
      async (tx) => {
        const d = await this.findOwn(scope, id, tx);
        // ASSUMPTION(Q-F-1): only PENDING registrations are decided here; re-deciding a REJECTED or
        // BLOCKED driver is not allowed from the carrier panel.
        const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const res = await tx.driver.updateMany({
          where: { id: d.id, ...scope, status: 'PENDING' },
          data: { status, decidedBy: user.id, decidedAt: now, decisionNote: input.note ?? null },
        });
        if (res.count !== 1) throw new DomainError('INVALID_STATE', { status: d.status });
        await this.audit.log(
          {
            action: input.decision === 'APPROVE' ? 'driver.approve' : 'driver.reject',
            entity: 'Driver',
            entityId: d.id,
            before: { status: d.status },
            after: { status },
            reason: input.note ?? null,
          },
          tx,
        );
        await this.notify(
          tx,
          scope.tenantId,
          d.userId,
          status === 'APPROVED' ? 'DRIVER_APPROVED' : 'DRIVER_REJECTED',
          status === 'APPROVED' ? 'حساب شما تأیید شد' : 'ثبت‌نام شما رد شد',
          status === 'APPROVED' ? 'اکنون می‌توانید نوبت بگیرید و بار رزرو کنید.' : (input.note ?? ''),
        );
        return { id: d.id, status };
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }

  /** APPROVED → BLOCKED with a reason and optional end date (inclusive, local business day). */
  async block(user: AuthUser, id: string, input: DriverBlockInput): Promise<{ id: string; status: string }> {
    const scope = scopedCarrier(user);
    const now = this.clock.now();
    let blockedUntil: Date | null = null;
    if (input.until) {
      if (input.until < localDate(now)) throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'until', message: 'past date' }] });
      blockedUntil = localDateTimeToUtc(addDaysIso(input.until, 1), '00:00');
    }
    return this.prisma.$transaction(
      async (tx) => {
        const d = await this.findOwn(scope, id, tx);
        // ASSUMPTION(Q-F-2): carriers block APPROVED drivers only (a PENDING one is rejected instead);
        // unblocking is left to the factory panel (US-F7).
        const res = await tx.driver.updateMany({
          where: { id: d.id, ...scope, status: 'APPROVED' },
          data: { status: 'BLOCKED', blockedUntil, blockReason: input.reason, decidedBy: user.id, decidedAt: now },
        });
        if (res.count !== 1) throw new DomainError('INVALID_STATE', { status: d.status });
        await this.audit.log(
          {
            action: 'driver.block',
            entity: 'Driver',
            entityId: d.id,
            before: { status: d.status },
            after: { status: 'BLOCKED', blockedUntil },
            reason: input.reason,
          },
          tx,
        );
        await this.notify(tx, scope.tenantId, d.userId, 'DRIVER_BLOCKED', 'حساب شما مسدود شد', input.reason);
        return { id: d.id, status: 'BLOCKED' };
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }

  /** Decide a pending vehicle change (T7): apply plate / loader type / smart card, or discard it. */
  async decideVehicleChange(user: AuthUser, id: string, input: DriverDecisionInput): Promise<{ id: string; status: string }> {
    const scope = scopedCarrier(user);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const d = await this.findOwn(scope, id, tx);
          const v = d.vehicles[0];
          if (!v || v.status !== 'PENDING_CHANGE' || !v.pendingChange) throw new DomainError('INVALID_STATE');
          const change = this.parsePending(v.pendingChange);
          if (!change) throw new DomainError('INVALID_STATE');
          const data: Prisma.VehicleUpdateManyMutationInput = { status: 'APPROVED', pendingChange: Prisma.DbNull };
          if (input.decision === 'APPROVE') {
            // ASSUMPTION(Q-F-3): a change is not applied while the driver has an in-progress permit,
            // so loader-type matching of existing reservations never changes retroactively.
            const busy = await tx.reservation.count({ where: { driverId: d.id, status: { in: IN_PROGRESS } } });
            if (busy > 0) throw new DomainError('HAS_ACTIVE_RESERVATIONS');
            if (change.loaderTypeId) {
              const lt = await tx.loaderType.findFirst({
                where: { id: change.loaderTypeId, tenantId: scope.tenantId, active: true, deletedAt: null },
              });
              if (!lt) throw new DomainError('VALIDATION_FAILED', { field: 'loaderTypeId' });
              data.loaderTypeId = change.loaderTypeId;
            }
            if (change.plate) data.plate = change.plate;
            if (change.smartCardNo) data.smartCardNo = change.smartCardNo;
          }
          // Optimistic guard: the request must still be pending when we write.
          const res = await tx.vehicle.updateMany({ where: { id: v.id, status: 'PENDING_CHANGE' }, data });
          if (res.count !== 1) throw new DomainError('INVALID_STATE');
          await this.audit.log(
            {
              action: input.decision === 'APPROVE' ? 'vehicle.change.approve' : 'vehicle.change.reject',
              entity: 'Vehicle',
              entityId: v.id,
              before: { plate: v.plate, loaderTypeId: v.loaderTypeId, smartCardNo: v.smartCardNo, pendingChange: change },
              after: input.decision === 'APPROVE' ? { ...change, status: 'APPROVED' } : { status: 'APPROVED' },
              reason: input.note ?? null,
            },
            tx,
          );
          const ok = input.decision === 'APPROVE';
          await this.notify(
            tx,
            scope.tenantId,
            d.userId,
            ok ? 'VEHICLE_CHANGE_APPROVED' : 'VEHICLE_CHANGE_REJECTED',
            ok ? 'تغییر مشخصات خودرو تأیید شد' : 'تغییر مشخصات خودرو رد شد',
            input.note ?? '',
          );
          return { id: v.id, status: ok ? 'APPROVED' : 'REJECTED' };
        },
        { timeout: TX_TIMEOUT_MS },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const target = uniqueViolationField(e) ?? '';
        throw new DomainError('CONFLICT', { field: /plate/i.test(target) ? 'plate' : /smartCard/i.test(target) ? 'smartCardNo' : 'unknown' });
      }
      throw e;
    }
  }
}
