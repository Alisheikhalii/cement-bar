import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { ReservationSource, ReservationStatus } from '@prisma/client';
import { hashPassword } from '../../src/modules/auth/password.service';
import type { TestApp } from './app';
import { createFixture, freshLogin, randomMobile, validNationalId, type Fixture, type Session } from './carrier-login';

const hex = (n = 4): string => randomBytes(n).toString('hex');
const digits = (n: number): string => Array.from({ length: n }, () => randomInt(0, 10)).join('');

export function randomPlate(): string {
  return `${digits(2)}ع${digits(3)}-${digits(2)}`;
}

export interface OtherCarrier {
  carrierId: string;
  opUsername: string;
  driverId: string;
}

/**
 * Tenant A (from createFixture) + a second carrier B in the same tenant with its own operator and
 * driver, for IDOR tests. Everything is removed by `fx.dispose()` (tenant teardown).
 */
export interface World {
  fx: Fixture;
  b: OtherCarrier;
  server: Server;
  sessions: { factory: Session; carrierA: Session; carrierB: Session; driver: Session };
}

export async function createWorld(t: TestApp): Promise<World> {
  const fx = await createFixture(t);
  try {
    const s = hex();
    const passwordHash = await hashPassword('Test@12345');
    const carrier = await t.prisma.carrier.create({ data: { tenantId: fx.tenantId, code: `B${s}`, name: `باربری ب ${s}` } });
    const op = await t.prisma.user.create({
      data: { tenantId: fx.tenantId, role: 'CARRIER_OPERATOR', username: `cb_${s}`, displayName: 'اپراتور ب', passwordHash, carrierId: carrier.id },
    });
    const driverB = await addDriver(t, fx.tenantId, carrier.id, 'APPROVED');
    const server = t.app.getHttpServer() as Server;
    const sessions = {
      factory: await freshLogin(server, fx.factory.username),
      carrierA: await freshLogin(server, fx.carrierOp.username),
      carrierB: await freshLogin(server, op.username!),
      driver: await freshLogin(server, fx.driver.mobile),
    };
    return { fx, b: { carrierId: carrier.id, opUsername: op.username!, driverId: driverB.id }, server, sessions };
  } catch (e) {
    await fx.dispose();
    throw e;
  }
}

export async function addDriver(
  t: TestApp,
  tenantId: string,
  carrierId: string,
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'BLOCKED',
): Promise<{ id: string; userId: string; mobile: string; nationalId: string }> {
  const mobile = randomMobile();
  const user = await t.prisma.user.create({
    data: { tenantId, role: 'DRIVER', mobile, displayName: 'راننده', passwordHash: 'x' },
  });
  const nid = validNationalId();
  const d = await t.prisma.driver.create({
    data: {
      tenantId,
      userId: user.id,
      carrierId,
      status,
      firstName: 'علی',
      lastName: `آزمون${hex(2)}`,
      nationalIdEnc: t.crypto.encrypt(nid),
      nationalIdHash: t.crypto.hash(`${nid}-${hex()}`),
      licenseNo: `L${hex()}`,
      licenseIssueDate: new Date('2015-01-01'),
      healthCardExpiry: new Date('2030-01-01'),
    },
  });
  return { id: d.id, userId: user.id, mobile, nationalId: nid };
}

export async function addVehicle(
  t: TestApp,
  tenantId: string,
  driverId: string,
  loaderTypeId: string,
  pendingChange?: Record<string, unknown>,
): Promise<{ id: string; plate: string; smartCardNo: string }> {
  const v = await t.prisma.vehicle.create({
    data: {
      tenantId,
      driverId,
      smartCardNo: `S${hex(5)}`,
      plate: randomPlate(),
      loaderTypeId,
      status: pendingChange ? 'PENDING_CHANGE' : 'APPROVED',
      pendingChange: pendingChange ? (pendingChange as object) : undefined,
      smartCardExpiry: new Date('2030-01-01'),
      inspectionExpiry: new Date('2030-01-01'),
    },
  });
  return { id: v.id, plate: v.plate, smartCardNo: v.smartCardNo };
}

let seq = 0;
const next = (): number => {
  seq += 1;
  return seq;
};

export interface PermitOpts {
  tenantId: string;
  /** Carrier that owns the load (= reservation.carrierId). */
  carrierId: string;
  driverId: string;
  loaderTypeId: string;
  status?: ReservationStatus;
  source?: ReservationSource;
  reservedAt?: Date;
  fare?: { fareCalc: 'PER_TRUCK'; farePerTruck: bigint } | { fareCalc: 'PER_TON'; ratePerTon: bigint };
  weightToKg?: number;
}

/** Announcement (+ hall, product, packaging) with one RESERVED unit and its reservation (= permit). */
export async function addPermit(t: TestApp, o: PermitOpts): Promise<{ id: string; permitNo: number; announcementId: string; unitId: string }> {
  const n = next() + randomInt(1000, 900_000);
  const hall = await t.prisma.hall.create({ data: { tenantId: o.tenantId, title: `سالن ${n}`, category: 'BAG', defaultAllocation: 'TIMED' } });
  const product = await t.prisma.product.create({ data: { tenantId: o.tenantId, title: 'سیمان تیپ ۲' } });
  const pack = await t.prisma.packagingType.create({ data: { tenantId: o.tenantId, title: 'کیسه ۵۰', category: 'BAG' } });
  const fare = o.fare ?? { fareCalc: 'PER_TRUCK' as const, farePerTruck: 50_000_000n };
  const a = await t.prisma.announcement.create({
    data: {
      tenantId: o.tenantId,
      carrierId: o.carrierId,
      hallId: hall.id,
      number: n,
      announceDate: '2026-11-25',
      announceTime: '08:00',
      productId: product.id,
      packagingTypeId: pack.id,
      cargoValue: 1n,
      loadingLocationId: randomUUID(),
      fareCalc: fare.fareCalc,
      farePerTruck: fare.fareCalc === 'PER_TRUCK' ? fare.farePerTruck : null,
      ratePerTon: fare.fareCalc === 'PER_TON' ? fare.ratePerTon : null,
      loaderTypeId: o.loaderTypeId,
      truckCount: 1,
      weightFromKg: 20_000,
      weightToKg: o.weightToKg ?? 25_000,
      destFareType: 'x',
      description: 'شرح اعلام بار',
      senderName: 'فرستنده',
      receiverName: 'گیرنده',
    },
  });
  const unit = await t.prisma.loadUnit.create({
    data: { tenantId: o.tenantId, announcementId: a.id, seq: 1, allocation: 'FREE', state: 'RESERVED' },
  });
  const r = await t.prisma.reservation.create({
    data: {
      tenantId: o.tenantId,
      permitNo: n,
      unitId: unit.id,
      driverId: o.driverId,
      carrierId: o.carrierId,
      source: o.source ?? 'FREE',
      status: o.status ?? 'RESERVED',
      reservedAt: o.reservedAt ?? new Date(),
      ip: '10.0.0.9',
    },
  });
  return { id: r.id, permitNo: n, announcementId: a.id, unitId: unit.id };
}
