import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { addDaysIso, isoDateToJalaliYearMonth, localDate, type AnnouncementFormValues } from '@cb/shared';
import { hashPassword } from '../../src/modules/auth/password.service';
import type { TestApp } from './app';
import { freshIp } from './app';
import { createFixture, login, PASSWORD, validNationalId, type Fixture, type Session } from './fixtures';

/** Master data + a second carrier (B) in the same tenant, for announcement tests. */
export interface AnnFixture extends Fixture {
  today: string;
  /** Quota month of `today` (large quota). */
  month: string;
  /** A date in another month with a small 100 t quota. */
  tightDate: string;
  /** A date in a month WITHOUT quota. */
  noQuotaDate: string;
  bagHallId: string;
  bulkHallId: string;
  productId: string;
  inactiveProductId: string;
  bagPackagingId: string;
  bulkPackagingId: string;
  destinationId: string;
  loadingLocationId: string;
  sharedLoadingLocationId: string;
  cargoDescriptionId: string;
  partyId: string;
  partyNationalId: string;
  goodsOwnerId: string;
  carrierB: { id: string; username: string; loadingLocationId: string; partyId: string };
}

const s = (): string => randomBytes(4).toString('hex');

export async function createAnnFixture(t: TestApp): Promise<AnnFixture> {
  const fx = await createFixture(t);
  const { prisma, crypto } = t;
  const tenantId = fx.tenantId;
  const today = localDate(t.clock.now());
  const month = isoDateToJalaliYearMonth(today);
  const tightDate = addDaysIso(today, 35);
  const noQuotaDate = addDaysIso(today, 70);
  const [bagHall, bulkHall] = await Promise.all([
    prisma.hall.create({ data: { tenantId, title: 'سالن کیسه‌ای', category: 'BAG', defaultAllocation: 'TIMED' } }),
    prisma.hall.create({ data: { tenantId, title: 'سالن فله', category: 'BULK', defaultAllocation: 'GROUP' } }),
  ]);
  const [product, inactive, bagPack, bulkPack, dest] = await Promise.all([
    prisma.product.create({ data: { tenantId, title: 'سیمان تیپ ۲' } }),
    prisma.product.create({ data: { tenantId, title: 'غیرفعال', active: false } }),
    prisma.packagingType.create({ data: { tenantId, title: 'کیسه ۵۰ کیلویی', category: 'BAG' } }),
    prisma.packagingType.create({ data: { tenantId, title: 'فله', category: 'BULK' } }),
    prisma.destination.create({ data: { tenantId, cityId: fx.cityId, title: 'مقصد آزمون' } }),
  ]);
  const partyNid = validNationalId();
  const [loc, sharedLoc, cargo, party, owner] = await Promise.all([
    prisma.loadingLocation.create({ data: { tenantId, carrierId: fx.carrierId, warehouseType: 'انبار', name: 'انبار A', cityId: fx.cityId, address: 'نشانی A' } }),
    prisma.loadingLocation.create({ data: { tenantId, carrierId: null, warehouseType: 'کارخانه', name: 'انبار مشترک' } }),
    prisma.cargoDescription.create({ data: { tenantId, carrierId: null, text: 'سیمان پاکتی' } }),
    prisma.party.create({
      data: {
        tenantId,
        carrierId: fx.carrierId,
        title: 'شرکت فرستنده',
        name: 'فرستنده آزمون',
        nationalIdEnc: crypto.encrypt(partyNid),
        nationalIdHash: crypto.hash(`${partyNid}-${s()}`),
        addresses: [{ cityId: fx.cityId, postalCode: '7155555555', address: 'نشانی فرستنده' }],
      },
    }),
    prisma.goodsOwner.create({
      data: { tenantId, carrierId: fx.carrierId, name: 'صاحب کالا', nationalIdEnc: crypto.encrypt('1234567890'), nationalIdHash: crypto.hash(`go-${s()}`) },
    }),
  ]);
  await prisma.carrierQuota.createMany({
    data: [
      { tenantId, carrierId: fx.carrierId, yearMonth: month, tonnageLimitKg: 100_000_000n },
      { tenantId, carrierId: fx.carrierId, yearMonth: isoDateToJalaliYearMonth(tightDate), tonnageLimitKg: 100_000n },
    ],
  });

  // carrier B (same tenant) with its own operator and master data
  const sb = s();
  const carrierB = await prisma.carrier.create({ data: { tenantId, code: `B${sb}`, name: `باربری ب ${sb}` } });
  const opB = await prisma.user.create({
    data: { tenantId, role: 'CARRIER_OPERATOR', username: `cb_${sb}`, displayName: 'اپراتور ب', passwordHash: await hashPassword(PASSWORD), carrierId: carrierB.id },
  });
  const nidB = validNationalId();
  const [locB, partyB] = await Promise.all([
    prisma.loadingLocation.create({ data: { tenantId, carrierId: carrierB.id, warehouseType: 'انبار', name: 'انبار B' } }),
    prisma.party.create({
      data: { tenantId, carrierId: carrierB.id, title: 'ب', name: 'ب', nationalIdEnc: crypto.encrypt(nidB), nationalIdHash: crypto.hash(`${nidB}-${sb}`) },
    }),
  ]);
  await prisma.carrierQuota.create({ data: { tenantId, carrierId: carrierB.id, yearMonth: month, tonnageLimitKg: 100_000_000n } });

  return {
    ...fx,
    today,
    month,
    tightDate,
    noQuotaDate,
    bagHallId: bagHall.id,
    bulkHallId: bulkHall.id,
    productId: product.id,
    inactiveProductId: inactive.id,
    bagPackagingId: bagPack.id,
    bulkPackagingId: bulkPack.id,
    destinationId: dest.id,
    loadingLocationId: loc.id,
    sharedLoadingLocationId: sharedLoc.id,
    cargoDescriptionId: cargo.id,
    partyId: party.id,
    partyNationalId: partyNid,
    goodsOwnerId: owner.id,
    carrierB: { id: carrierB.id, username: opB.username!, loadingLocationId: locB.id, partyId: partyB.id },
  };
}

/** Minimal valid 7-section form for the BAG hall (override per test). */
export function annInput(fx: AnnFixture, o: Partial<AnnouncementFormValues> = {}): AnnouncementFormValues {
  return {
    announceDate: fx.today,
    announceTime: '08:30',
    hallId: fx.bagHallId,
    senderPartyId: fx.partyId,
    destinationId: fx.destinationId,
    receiverName: 'گیرنده آزمون',
    productId: fx.productId,
    cargoDescriptionId: fx.cargoDescriptionId,
    packagingTypeId: fx.bagPackagingId,
    cargoValue: 1_500_000_000,
    loadingLocationId: fx.loadingLocationId,
    fareCalc: 'PER_TRUCK',
    loaderTypeId: fx.loaderTypeId,
    truckCount: 3,
    weightFromKg: 25_000,
    weightToKg: 28_000,
    destFareType: 'عادی',
    farePerTruck: 120_000_000,
    goodsOwnerId: fx.goodsOwnerId,
    description: 'اعلام بار آزمون',
    extra: {},
    ...o,
  };
}

/** Thin supertest wrapper carrying cookie + CSRF + a per-client fake IP. */
export function client(server: Server, session: Session) {
  const ip = freshIp();
  const withAuth = (r: request.Test) => r.set('Cookie', session.cookie).set('X-CSRF', session.csrf).set('X-Forwarded-For', ip);
  return {
    get: (p: string) => withAuth(request(server).get(`/api${p}`)),
    post: (p: string, body?: unknown) => withAuth(request(server).post(`/api${p}`)).send(body as object),
    put: (p: string, body?: unknown) => withAuth(request(server).put(`/api${p}`)).send(body as object),
    patch: (p: string, body?: unknown) => withAuth(request(server).patch(`/api${p}`)).send(body as object),
  };
}
export type Client = ReturnType<typeof client>;

export async function loginClient(server: Server, identifier: string): Promise<Client> {
  const { res, session } = await login(server, identifier, PASSWORD, freshIp());
  if (res.status !== 200) throw new Error(`login failed for ${identifier}: ${res.status}`);
  return client(server, session);
}
