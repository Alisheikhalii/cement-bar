import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  localDate,
  type DriverAlertDto,
  type DriverCityRef,
  type DriverCompanyDto,
  type DriverDashboardDto,
  type DriverProfileDto,
  type DriverProfileUpdateInput,
  type DriverRef,
  type DriverVehicleDto,
  type VehiclePendingChange,
} from '@cb/shared';
import type { z } from 'zod';
import type { vehicleChangeRequestSchema, vehicleUpdateSchema } from '@cb/shared';
import type { DriverScope } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { FieldCrypto } from '../../common/crypto/field-crypto';
import { DomainError } from '../../common/errors/domain-error';
import { uniqueViolationField } from '../../common/errors/error-mapping';
import { PrismaService, TX_TIMEOUT_MS, type PrismaTx } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { dateOnlyIso, documentAlerts, documentStatus, isRealIsoDate, isoToDbDate } from './documents';

export type VehicleUpdateInput = z.infer<typeof vehicleUpdateSchema>;
export type VehicleChangeRequestInput = z.infer<typeof vehicleChangeRequestSchema>;

const PROFILE_DATE_FIELDS = ['licenseIssueDate', 'healthCardExpiry', 'birthDate'] as const;
/** Fields whose change is a self-declared document expiry (P2-4: always audited, tagged in the audit row). */
const EXPIRY_FIELDS = new Set(['healthCardExpiry', 'smartCardExpiry', 'inspectionExpiry']);

type DriverRow = Prisma.DriverGetPayload<{ include: { user: { select: { mobile: true } } } }>;

@Injectable()
export class DriverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly crypto: FieldCrypto,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── reads ─────────────────────────

  async dashboard(scope: DriverScope): Promise<DriverDashboardDto> {
    const now = this.clock.now();
    const today = localDate(now);
    const driver = await this.loadDriver(scope);
    const [carrier, vehicle, penalty] = await Promise.all([
      this.prisma.carrier.findFirst({
        where: { id: driver.carrierId, tenantId: scope.tenantId },
        select: { id: true, name: true, status: true },
      }),
      this.activeVehicle(scope),
      this.prisma.driverPenalty.findFirst({
        where: { driverId: scope.driverId, tenantId: scope.tenantId, until: { gt: now } },
        orderBy: { until: 'desc' },
        select: { until: true },
      }),
    ]);
    if (!carrier) throw new DomainError('NOT_FOUND');
    const loaderType = vehicle ? await this.loaderTypeRef(scope.tenantId, vehicle.loaderTypeId) : null;

    const documents = [documentStatus('HEALTH_CARD', dateOnlyIso(driver.healthCardExpiry), today)];
    if (vehicle) {
      documents.push(
        documentStatus('SMART_CARD', dateOnlyIso(vehicle.smartCardExpiry), today),
        documentStatus('INSPECTION', dateOnlyIso(vehicle.inspectionExpiry), today),
      );
    }

    const alerts: DriverAlertDto[] = [];
    if (driver.status === 'PENDING') alerts.push({ kind: 'PENDING_APPROVAL', tone: 'warning' });
    if (driver.status === 'REJECTED')
      alerts.push({ kind: 'REJECTED', tone: 'danger', reason: driver.decisionNote });
    // ASSUMPTION(Q-G-2): status BLOCKED is the source of truth; blockedUntil is shown as information only
    // (automatic unblocking at blockedUntil belongs to the factory/carrier slices).
    if (driver.status === 'BLOCKED')
      alerts.push({
        kind: 'BLOCKED',
        tone: 'danger',
        reason: driver.blockReason,
        until: driver.blockedUntil?.toISOString() ?? null,
      });
    if (penalty) alerts.push({ kind: 'PENALIZED', tone: 'danger', until: penalty.until.toISOString() });
    if (!vehicle) alerts.push({ kind: 'NO_VEHICLE', tone: 'danger' });
    else if (vehicle.status === 'PENDING_CHANGE')
      alerts.push({ kind: 'VEHICLE_CHANGE_PENDING', tone: 'info' });
    alerts.push(...documentAlerts(documents));

    const canOperate =
      driver.status === 'APPROVED' && !penalty && !!vehicle && documents.every((d) => d.level !== 'expired');

    return {
      serverTime: now.toISOString(),
      today,
      driver: { firstName: driver.firstName, lastName: driver.lastName, status: driver.status, canOperate },
      carrier,
      vehicle: vehicle ? { id: vehicle.id, plate: vehicle.plate, status: vehicle.status, loaderType } : null,
      documents,
      alerts,
    };
  }

  async profile(scope: DriverScope): Promise<DriverProfileDto> {
    return this.toProfileDto(await this.loadDriver(scope));
  }

  async vehicle(scope: DriverScope): Promise<DriverVehicleDto> {
    const v = await this.activeVehicle(scope);
    if (!v) throw new DomainError('NOT_FOUND');
    return this.toVehicleDto(scope.tenantId, v);
  }

  async companies(scope: DriverScope): Promise<DriverCompanyDto[]> {
    const driver = await this.prisma.driver.findFirst({
      where: { id: scope.driverId, tenantId: scope.tenantId, deletedAt: null },
      select: { carrierId: true, status: true },
    });
    if (!driver) throw new DomainError('NOT_FOUND');
    // ASSUMPTION(Q-G-3): list = every non-deleted ACTIVE carrier of the tenant (US-D10 "list of carriers with
    // phone and address") plus the driver's own carrier even when suspended. Suspended foreign carriers are hidden.
    const rows = await this.prisma.carrier.findMany({
      where: {
        tenantId: scope.tenantId,
        deletedAt: null,
        OR: [{ status: 'ACTIVE' }, { id: driver.carrierId }],
      },
      select: { id: true, name: true, code: true, phone: true, address: true, status: true },
      orderBy: [{ name: 'asc' }],
      take: 500,
    });
    return rows
      .map((c) => ({
        ...c,
        mine: c.id === driver.carrierId,
        driverStatus: c.id === driver.carrierId ? driver.status : null,
      }))
      .sort((a, b) => Number(b.mine) - Number(a.mine));
  }

  // ───────────────────────── writes ─────────────────────────

  /** P2-4: identity (mobile, national id, name) is not part of the schema and can never change here. */
  async updateProfile(scope: DriverScope, input: DriverProfileUpdateInput): Promise<DriverProfileDto> {
    const today = localDate(this.clock.now());
    for (const f of PROFILE_DATE_FIELDS) {
      const v = input[f];
      if (v !== undefined && !isRealIsoDate(v)) throw new DomainError('VALIDATION_FAILED', { field: f });
    }
    if (input.licenseIssueDate > today)
      throw new DomainError('VALIDATION_FAILED', { field: 'licenseIssueDate' });
    if (input.birthDate !== undefined && input.birthDate > today)
      throw new DomainError('VALIDATION_FAILED', { field: 'birthDate' });
    await this.assertCities([
      ['birthCityId', input.birthCityId],
      ['residenceCityId', input.residenceCityId ?? undefined],
    ]);

    // ASSUMPTION(Q-G-1): an omitted optional field is left unchanged (never cleared) so a partial body can't
    // delete data; only residenceCityId can be cleared explicitly with null (the only nullable field in the schema).
    const data: Prisma.DriverUpdateInput = {
      licenseNo: input.licenseNo,
      licenseIssueDate: isoToDbDate(input.licenseIssueDate),
      birthCityId: input.birthCityId,
      healthCardExpiry: isoToDbDate(input.healthCardExpiry),
    };
    if (input.residenceCityId !== undefined) data.residenceCityId = input.residenceCityId;
    if (input.address !== undefined) data.address = input.address;
    if (input.postalCode !== undefined) data.postalCode = input.postalCode;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.bankName !== undefined) data.bankName = input.bankName;
    if (input.accountNo !== undefined) data.accountNo = input.accountNo;
    if (input.birthDate !== undefined) data.birthDate = isoToDbDate(input.birthDate);
    if (input.sheba !== undefined) data.shebaEnc = this.crypto.encrypt(input.sheba);

    const updated = await this.prisma.$transaction(
      async (tx) => {
        await this.lockDriver(tx, scope);
        const before = await tx.driver.findFirst({ where: { id: scope.driverId, tenantId: scope.tenantId } });
        if (!before) throw new DomainError('NOT_FOUND');
        const after = await tx.driver.update({
          where: { id: scope.driverId },
          data: { ...data, updatedAt: this.clock.now() },
          include: { user: { select: { mobile: true } } },
        });
        const oldSheba = before.shebaEnc ? this.crypto.decrypt(before.shebaEnc) : null;
        const diff = profileDiff(before, after, input.sheba !== undefined && input.sheba !== oldSheba);
        if (Object.keys(diff.after).length > 0) {
          await this.audit.log(
            {
              action: 'driver.profile.update',
              entity: 'Driver',
              entityId: scope.driverId,
              before: diff.before,
              after: diff.after,
              reason: diff.expiryChanged ? 'self-declared document expiry' : null,
            },
            tx,
          );
        }
        return after;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return this.toProfileDto(updated);
  }

  /** Self-declared expiry dates apply immediately (schema comment) and are audited. */
  async updateVehicle(scope: DriverScope, input: VehicleUpdateInput): Promise<DriverVehicleDto> {
    for (const f of ['smartCardExpiry', 'inspectionExpiry'] as const) {
      if (!isRealIsoDate(input[f])) throw new DomainError('VALIDATION_FAILED', { field: f });
    }
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const v = await this.lockActiveVehicle(tx, scope);
        const after = await tx.vehicle.update({
          where: { id: v.id },
          data: {
            smartCardExpiry: isoToDbDate(input.smartCardExpiry),
            inspectionExpiry: isoToDbDate(input.inspectionExpiry),
            updatedAt: this.clock.now(),
          },
        });
        const before = {
          smartCardExpiry: dateOnlyIso(v.smartCardExpiry),
          inspectionExpiry: dateOnlyIso(v.inspectionExpiry),
        };
        const afterVals = {
          smartCardExpiry: input.smartCardExpiry,
          inspectionExpiry: input.inspectionExpiry,
        };
        const changed = (Object.keys(before) as (keyof typeof before)[]).filter(
          (k) => before[k] !== afterVals[k],
        );
        if (changed.length > 0) {
          await this.audit.log(
            {
              action: 'vehicle.expiry.update',
              entity: 'Vehicle',
              entityId: v.id,
              before: Object.fromEntries(changed.map((k) => [k, before[k]])),
              after: Object.fromEntries(changed.map((k) => [k, afterVals[k]])),
              reason: 'self-declared document expiry',
            },
            tx,
          );
        }
        return after;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return this.toVehicleDto(scope.tenantId, updated);
  }

  /**
   * T7: plate / loader type / smart card changes are stored in Vehicle.pendingChange and the vehicle becomes
   * PENDING_CHANGE until the carrier decides (carrier slice). Until then the driver works with the old data.
   */
  async requestVehicleChange(
    scope: DriverScope,
    input: VehicleChangeRequestInput,
  ): Promise<DriverVehicleDto> {
    const driver = await this.loadDriver(scope);
    // ASSUMPTION(Q-G-4): only APPROVED drivers may request a vehicle change; pending/rejected drivers fix data
    // through the carrier's registration review, blocked drivers can't change anything that needs approval.
    if (driver.status === 'BLOCKED') throw new DomainError('DRIVER_BLOCKED');
    if (driver.status !== 'APPROVED') throw new DomainError('DRIVER_NOT_APPROVED');
    if (input.loaderTypeId) {
      const lt = await this.prisma.loaderType.findFirst({
        where: { id: input.loaderTypeId, tenantId: scope.tenantId, active: true, deletedAt: null },
        select: { id: true },
      });
      if (!lt) throw new DomainError('VALIDATION_FAILED', { field: 'loaderTypeId' });
    }

    try {
      const updated = await this.prisma.$transaction(
        async (tx) => {
          const v = await this.lockActiveVehicle(tx, scope);
          if (v.status !== 'APPROVED')
            throw new DomainError('INVALID_STATE', { reason: 'CHANGE_ALREADY_PENDING' });
          const change: VehiclePendingChange = { requestedAt: this.clock.now().toISOString() };
          if (input.plate && input.plate !== v.plate) change.plate = input.plate;
          if (input.loaderTypeId && input.loaderTypeId !== v.loaderTypeId)
            change.loaderTypeId = input.loaderTypeId;
          if (input.smartCardNo && input.smartCardNo !== v.smartCardNo)
            change.smartCardNo = input.smartCardNo;
          if (!change.plate && !change.loaderTypeId && !change.smartCardNo)
            throw new DomainError('VALIDATION_FAILED', { reason: 'NO_CHANGE' });
          await this.assertNotTaken(tx, v.id, change);

          const res = await tx.vehicle.updateMany({
            where: { id: v.id, status: 'APPROVED' },
            data: { status: 'PENDING_CHANGE', pendingChange: change, updatedAt: this.clock.now() },
          });
          if (res.count !== 1) throw new DomainError('INVALID_STATE');
          await this.audit.log(
            {
              action: 'vehicle.change.request',
              entity: 'Vehicle',
              entityId: v.id,
              before: {
                plate: v.plate,
                loaderTypeId: v.loaderTypeId,
                smartCardNo: v.smartCardNo,
                status: v.status,
              },
              after: { pendingChange: change, status: 'PENDING_CHANGE' },
            },
            tx,
          );
          return tx.vehicle.findUniqueOrThrow({ where: { id: v.id } });
        },
        { timeout: TX_TIMEOUT_MS },
      );
      return this.toVehicleDto(scope.tenantId, updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new DomainError('CONFLICT', { field: uniqueViolationField(e) ?? 'unknown' });
      }
      throw e;
    }
  }

  /** Driver withdraws their own pending change (atomic: only while still PENDING_CHANGE). */
  async withdrawVehicleChange(scope: DriverScope): Promise<DriverVehicleDto> {
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const v = await this.lockActiveVehicle(tx, scope);
        const res = await tx.vehicle.updateMany({
          where: { id: v.id, status: 'PENDING_CHANGE' },
          data: { status: 'APPROVED', pendingChange: Prisma.DbNull, updatedAt: this.clock.now() },
        });
        if (res.count !== 1) throw new DomainError('INVALID_STATE');
        await this.audit.log(
          {
            action: 'vehicle.change.withdraw',
            entity: 'Vehicle',
            entityId: v.id,
            before: { pendingChange: v.pendingChange, status: v.status },
            after: { pendingChange: null, status: 'APPROVED' },
          },
          tx,
        );
        return tx.vehicle.findUniqueOrThrow({ where: { id: v.id } });
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return this.toVehicleDto(scope.tenantId, updated);
  }

  // ───────────────────────── helpers ─────────────────────────

  private async loadDriver(scope: DriverScope): Promise<DriverRow> {
    const d = await this.prisma.driver.findFirst({
      where: { id: scope.driverId, tenantId: scope.tenantId, deletedAt: null },
      include: { user: { select: { mobile: true } } },
    });
    if (!d) throw new DomainError('NOT_FOUND');
    return d;
  }

  private activeVehicle(scope: DriverScope) {
    return this.prisma.vehicle.findFirst({
      where: { driverId: scope.driverId, tenantId: scope.tenantId, active: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async lockDriver(tx: PrismaTx, scope: DriverScope): Promise<void> {
    await tx.$queryRaw`SELECT id FROM drivers WHERE id = ${scope.driverId}::uuid AND "tenantId" = ${scope.tenantId}::uuid FOR UPDATE`;
  }

  /** Row-locks the driver's active vehicle inside `tx` and returns its fresh state. */
  private async lockActiveVehicle(tx: PrismaTx, scope: DriverScope) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM vehicles
      WHERE "driverId" = ${scope.driverId}::uuid AND "tenantId" = ${scope.tenantId}::uuid AND active = true
      ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`;
    const id = rows[0]?.id;
    if (!id) throw new DomainError('NOT_FOUND');
    return tx.vehicle.findUniqueOrThrow({ where: { id } });
  }

  /** Requested plate / smart card must not belong to (or be pending for) another vehicle. */
  private async assertNotTaken(tx: PrismaTx, vehicleId: string, change: VehiclePendingChange): Promise<void> {
    const checks: [field: 'plate' | 'smartCardNo', value: string | undefined][] = [
      ['plate', change.plate],
      ['smartCardNo', change.smartCardNo],
    ];
    for (const [field, value] of checks) {
      if (!value) continue;
      const taken = await tx.vehicle.findFirst({
        where: {
          id: { not: vehicleId },
          OR: [{ [field]: value }, { pendingChange: { path: [field], equals: value } }],
        },
        select: { id: true },
      });
      if (taken) throw new DomainError('CONFLICT', { field });
    }
  }

  private async assertCities(list: [field: string, id: number | undefined][]): Promise<void> {
    for (const [field, id] of list) {
      if (id === undefined) continue;
      const c = await this.prisma.city.findUnique({ where: { id }, select: { id: true } });
      if (!c) throw new DomainError('VALIDATION_FAILED', { field });
    }
  }

  private async cityRef(id: number | null): Promise<DriverCityRef | null> {
    if (id === null) return null;
    const c = await this.prisma.city.findUnique({
      where: { id },
      select: { id: true, name: true, province: { select: { name: true } } },
    });
    return c ? { id: c.id, name: c.name, province: c.province.name } : null;
  }

  private async loaderTypeRef(tenantId: string, id: string): Promise<DriverRef | null> {
    return this.prisma.loaderType.findFirst({ where: { id, tenantId }, select: { id: true, title: true } });
  }

  private async toProfileDto(d: DriverRow): Promise<DriverProfileDto> {
    const [birthCity, residenceCity] = await Promise.all([
      this.cityRef(d.birthCityId),
      this.cityRef(d.residenceCityId),
    ]);
    return {
      mobile: d.user.mobile,
      nationalId: this.crypto.decrypt(d.nationalIdEnc),
      firstName: d.firstName,
      lastName: d.lastName,
      status: d.status,
      decisionNote: d.decisionNote,
      licenseNo: d.licenseNo,
      licenseIssueDate: dateOnlyIso(d.licenseIssueDate),
      birthCity,
      birthDate: d.birthDate ? dateOnlyIso(d.birthDate) : null,
      healthCardExpiry: dateOnlyIso(d.healthCardExpiry),
      residenceCity,
      address: d.address,
      postalCode: d.postalCode,
      phone: d.phone,
      bankName: d.bankName,
      accountNo: d.accountNo,
      sheba: d.shebaEnc ? this.crypto.decrypt(d.shebaEnc) : null,
    };
  }

  private async toVehicleDto(
    tenantId: string,
    v: Prisma.VehicleGetPayload<Record<string, never>>,
  ): Promise<DriverVehicleDto> {
    const pending = parsePending(v.pendingChange);
    const [loaderType, pendingLoader] = await Promise.all([
      this.loaderTypeRef(tenantId, v.loaderTypeId),
      pending?.loaderTypeId ? this.loaderTypeRef(tenantId, pending.loaderTypeId) : Promise.resolve(undefined),
    ]);
    return {
      id: v.id,
      smartCardNo: v.smartCardNo,
      plate: v.plate,
      loaderType,
      status: v.status,
      smartCardExpiry: dateOnlyIso(v.smartCardExpiry),
      inspectionExpiry: dateOnlyIso(v.inspectionExpiry),
      pendingChange: pending
        ? {
            plate: pending.plate,
            smartCardNo: pending.smartCardNo,
            loaderType: pending.loaderTypeId ? (pendingLoader ?? null) : undefined,
            requestedAt: pending.requestedAt,
          }
        : null,
    };
  }
}

function parsePending(v: Prisma.JsonValue | null): VehiclePendingChange | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof o[k] === 'string' ? (o[k] as string) : undefined);
  return {
    plate: str('plate'),
    loaderTypeId: str('loaderTypeId'),
    smartCardNo: str('smartCardNo'),
    requestedAt: str('requestedAt') ?? '',
  };
}

const AUDITED_PROFILE_FIELDS = [
  'licenseNo',
  'licenseIssueDate',
  'birthCityId',
  'healthCardExpiry',
  'residenceCityId',
  'address',
  'postalCode',
  'phone',
  'bankName',
  'accountNo',
  'birthDate',
] as const;

function auditValue(v: unknown): unknown {
  return v instanceof Date ? dateOnlyIso(v) : v;
}

/** Changed fields only. Sheba plaintext is never written to the audit trail (only a "changed" marker). */
export function profileDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  shebaChanged: boolean,
): { before: Record<string, unknown>; after: Record<string, unknown>; expiryChanged: boolean } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const f of AUDITED_PROFILE_FIELDS) {
    const x = auditValue(before[f]);
    const y = auditValue(after[f]);
    if (x !== y) {
      b[f] = x ?? null;
      a[f] = y ?? null;
    }
  }
  if (shebaChanged) {
    b.sheba = before.shebaEnc ? '[set]' : null;
    a.sheba = '[changed]';
  }
  return { before: b, after: a, expiryChanged: Object.keys(a).some((k) => EXPIRY_FIELDS.has(k)) };
}
