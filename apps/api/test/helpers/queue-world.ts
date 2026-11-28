/**
 * Test-world helpers for the queue integration tests: fast batch driver creation, hall days,
 * announcements/units, groups/memberships and a direct allocation invocation.
 */
import { randomUUID } from 'node:crypto';
import { localDate, type Allocation } from '@cb/shared';
import type { AuthUser } from '../../src/common/auth/auth.decorators';
import { QueueEngineService } from '../../src/modules/queue/queue-engine.service';
import { hashPassword } from '../../src/modules/auth/password.service';
import type { TestApp } from './app';
import type { AnnFixture } from './announcements-fixtures';
import { PASSWORD, randomMobile, validNationalId } from './fixtures';
import { randomPlate, randomSmartCard } from './driver-fixtures';

export const isoDay = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
export const todayIso = (t: TestApp): string => localDate(t.clock.now());

export interface CreatedDriver {
  driverId: string;
  userId: string;
  user: AuthUser;
  mobile: string;
}

/** Batch-creates `n` APPROVED drivers (each with a vehicle of `loaderTypeId`) using one password hash. */
export async function createManyDrivers(
  t: TestApp,
  fx: AnnFixture,
  n: number,
  opts: { loaderTypeId?: string; carrierId?: string; status?: 'APPROVED' | 'PENDING' | 'BLOCKED' } = {},
): Promise<CreatedDriver[]> {
  const passwordHash = await hashPassword(PASSWORD);
  const loaderTypeId = opts.loaderTypeId ?? fx.loaderTypeId;
  const carrierId = opts.carrierId ?? fx.carrierId;
  const status = opts.status ?? 'APPROVED';
  const users: {
    id: string; tenantId: string; role: 'DRIVER'; mobile: string; displayName: string; passwordHash: string;
  }[] = [];
  const drivers: {
    id: string; tenantId: string; userId: string; carrierId: string; status: 'APPROVED' | 'PENDING' | 'BLOCKED';
    firstName: string; lastName: string; nationalIdEnc: string; nationalIdHash: string; licenseNo: string;
    licenseIssueDate: Date; healthCardExpiry: Date;
  }[] = [];
  const vehicles: {
    id: string; tenantId: string; driverId: string; smartCardNo: string; plate: string; loaderTypeId: string;
    smartCardExpiry: Date; inspectionExpiry: Date;
  }[] = [];
  const out: CreatedDriver[] = [];
  const expiry = isoDay('2030-01-01');
  for (let i = 0; i < n; i += 1) {
    const userId = randomUUID();
    const driverId = randomUUID();
    const mobile = randomMobile();
    const nid = validNationalId();
    users.push({ id: userId, tenantId: fx.tenantId, role: 'DRIVER', mobile, displayName: 'راننده آزمون', passwordHash });
    drivers.push({
      id: driverId, tenantId: fx.tenantId, userId, carrierId, status, firstName: 'آزمون', lastName: `راننده ${i + 1}`,
      nationalIdEnc: t.crypto.encrypt(nid), nationalIdHash: t.crypto.hash(`${nid}-${driverId}`),
      licenseNo: `L-${driverId.slice(0, 8)}`, licenseIssueDate: isoDay('2016-01-01'), healthCardExpiry: expiry,
    });
    vehicles.push({
      id: randomUUID(), tenantId: fx.tenantId, driverId, smartCardNo: randomSmartCard(), plate: randomPlate().normalized,
      loaderTypeId, smartCardExpiry: expiry, inspectionExpiry: expiry,
    });
    out.push({ driverId, userId, user: { id: userId, role: 'DRIVER', tenantId: fx.tenantId, driverId, sid: 'test' }, mobile });
  }
  await t.prisma.user.createMany({ data: users });
  await t.prisma.driver.createMany({ data: drivers });
  await t.prisma.vehicle.createMany({ data: vehicles });
  return out;
}

export interface HallDayTimes {
  t0At: Date;
  priorityEndAt: Date | null;
  hallEndAt: Date;
}

export async function addHallDay(
  t: TestApp,
  fx: AnnFixture,
  hallId: string,
  times: HallDayTimes,
  date: string = todayIso(t),
) {
  return t.prisma.hallDay.create({
    data: {
      tenantId: fx.tenantId,
      hallId,
      date,
      t0At: times.t0At,
      priorityEndAt: times.priorityEndAt,
      hallEndAt: times.hallEndAt,
      status: 'SCHEDULED',
    },
  });
}

async function nextAnnouncementNumber(t: TestApp, tenantId: string): Promise<number> {
  const c = await t.prisma.counter.upsert({
    where: { tenantId_name: { tenantId, name: 'announcement' } },
    create: { tenantId, name: 'announcement', value: 1 },
    update: { value: { increment: 1 } },
  });
  return c.value;
}

export interface AnnOpts {
  hallId: string;
  hallDayId?: string | null;
  allocation: Allocation;
  units: number;
  loaderTypeId?: string;
  loaderType2Id?: string | null;
  carrierId?: string;
  description?: string;
  createdAt?: Date;
}

export async function createAnnouncement(t: TestApp, fx: AnnFixture, o: AnnOpts) {
  const number = await nextAnnouncementNumber(t, fx.tenantId);
  const a = await t.prisma.announcement.create({
    data: {
      tenantId: fx.tenantId,
      carrierId: o.carrierId ?? fx.carrierId,
      hallId: o.hallId,
      hallDayId: o.hallDayId ?? null,
      number,
      status: 'ACTIVE',
      announceDate: todayIso(t),
      announceTime: '08:00',
      destCityId: fx.cityId,
      productId: fx.productId,
      packagingTypeId: o.allocation === 'GROUP' ? fx.bulkPackagingId : fx.bagPackagingId,
      cargoValue: 0n,
      loadingLocationId: fx.loadingLocationId,
      fareCalc: 'PER_TRUCK',
      loaderTypeId: o.loaderTypeId ?? fx.loaderTypeId,
      loaderType2Id: o.loaderType2Id ?? null,
      truckCount: o.units,
      weightFromKg: 0,
      weightToKg: 0,
      destFareType: 'عادی',
      farePerTruck: 100n,
      description: o.description ?? 'بار آزمون',
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    },
  });
  await t.prisma.loadUnit.createMany({
    data: Array.from({ length: o.units }, (_, i) => ({ tenantId: fx.tenantId, announcementId: a.id, seq: i + 1, allocation: o.allocation })),
  });
  return a;
}

export async function createGroup(
  t: TestApp,
  fx: AnnFixture,
  hallId: string,
  title: string,
  sortOrder: number,
  driverIds: string[],
  active = true,
) {
  const g = await t.prisma.bulkGroup.create({ data: { tenantId: fx.tenantId, carrierId: fx.carrierId, hallId, title, sortOrder, active } });
  if (driverIds.length) {
    const eff = isoDay(todayIso(t));
    await t.prisma.bulkGroupMember.createMany({
      data: driverIds.map((driverId) => ({ tenantId: fx.tenantId, groupId: g.id, driverId, effectiveFrom: eff })),
    });
  }
  return g;
}

/** Runs the bag allocation for a hall day in its own transaction (as the lazy read would). */
export async function runAllocation(t: TestApp, hallDayId: string, at: Date) {
  const engine = t.app.get(QueueEngineService);
  let events: Awaited<ReturnType<QueueEngineService['allocateBagTx']>> = [];
  await t.prisma.$transaction(async (tx) => {
    const day = await tx.hallDay.findUniqueOrThrow({ where: { id: hallDayId } });
    events = await engine.allocateBagTx(tx, day, at);
  });
  return events;
}

/** Runs one bulk advance for a carrier in its own transaction. */
export async function advanceBulk(t: TestApp, carrierId: string, hallDayId: string, at: Date, forcedCloseWindowId?: string) {
  const engine = t.app.get(QueueEngineService);
  let events: Awaited<ReturnType<QueueEngineService['advanceBulkTx']>> = [];
  await t.prisma.$transaction(async (tx) => {
    const day = await tx.hallDay.findUniqueOrThrow({ where: { id: hallDayId } });
    events = await engine.advanceBulkTx(tx, carrierId, day, at, forcedCloseWindowId ? { forcedCloseWindowId } : {});
  });
  return events;
}
