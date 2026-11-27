import { randomBytes, randomInt } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { hashPassword } from '../../src/modules/auth/password.service';
import type { TestApp } from './app';

export const PASSWORD = 'Test@12345';

/** Generates a random national id with a valid checksum. */
export function validNationalId(): string {
  for (;;) {
    const base = Array.from({ length: 9 }, () => randomInt(0, 10));
    const sum = base.reduce((acc, d, i) => acc + d * (10 - i), 0);
    const r = sum % 11;
    const check = r < 2 ? r : 11 - r;
    const code = [...base, check].join('');
    if (!/^(\d)\1{9}$/.test(code)) return code;
  }
}

export function randomMobile(): string {
  return `0919${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
}

const suffix = (): string => randomBytes(4).toString('hex');

export interface Fixture {
  tenantId: string;
  carrierId: string;
  loaderTypeId: string;
  cityId: number;
  factory: { id: string; username: string };
  carrierOp: { id: string; username: string };
  driver: { id: string; userId: string; mobile: string };
  dispose: () => Promise<void>;
}

/** Fresh tenant + carrier + users (factory, carrier operator, approved driver) with random suffixes. */
export async function createFixture(t: TestApp): Promise<Fixture> {
  const s = suffix();
  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await t.prisma.tenant.create({ data: { name: `test-${s}` } });
  try {
    return await populate(t, tenant.id, s, passwordHash);
  } catch (e) {
    await disposeTenant(t, tenant.id); // never leave half-built test tenants behind
    throw e;
  }
}

/**
 * Removes all rows of a test tenant, children first (audit_logs and queue_events are append-only
 * and intentionally kept; they have no FKs). Covers every tenant-scoped table so slices can call it.
 */
export async function disposeTenant(t: TestApp, tenantId: string): Promise<void> {
  const { prisma: p } = t;
  const w = { where: { tenantId } };
  await p.cancelRequest.deleteMany(w);
  await p.reservation.deleteMany(w);
  await p.bulkWindow.deleteMany(w);
  await p.bulkDay.deleteMany(w);
  await p.bulkGroupMember.deleteMany(w);
  await p.bulkGroup.deleteMany(w);
  await p.bulkRotationState.deleteMany(w);
  await p.bagPriority.deleteMany(w);
  await p.bagTurn.deleteMany(w);
  await p.allocationRun.deleteMany(w);
  await p.loadUnitAllocationChange.deleteMany(w);
  await p.loadUnit.deleteMany(w);
  await p.announcement.deleteMany(w);
  await p.hallDay.deleteMany(w);
  await p.hallSchedule.deleteMany(w);
  await p.queuePolicy.deleteMany(w);
  await p.hall.deleteMany(w);
  await p.dailyFile.deleteMany(w);
  await p.carrierQuota.deleteMany(w);
  await p.party.deleteMany(w);
  await p.goodsOwner.deleteMany(w);
  await p.loadingLocation.deleteMany(w);
  await p.cargoDescription.deleteMany(w);
  await p.loadingCondition.deleteMany(w);
  await p.destination.deleteMany(w);
  await p.packagingType.deleteMany(w);
  await p.product.deleteMany(w);
  await p.driverPenalty.deleteMany(w);
  await p.notification.deleteMany(w);
  await p.session.deleteMany({ where: { user: { tenantId } } });
  await p.vehicle.deleteMany(w);
  await p.driver.deleteMany(w);
  await p.user.deleteMany(w);
  await p.loaderType.deleteMany(w);
  await p.carrier.deleteMany(w);
  await p.counter.deleteMany(w);
  await p.tenant.delete({ where: { id: tenantId } });
}

async function populate(t: TestApp, tenantId: string, s: string, passwordHash: string): Promise<Fixture> {
  const { prisma, crypto } = t;
  const tenant = { id: tenantId };
  const carrier = await prisma.carrier.create({ data: { tenantId: tenant.id, code: `T${s}`, name: `باربری ${s}` } });
  const loader = await prisma.loaderType.create({ data: { tenantId: tenant.id, code: `BNK_${s}`, title: 'بنکر' } });
  // Shared reference rows (fixed ids); skipDuplicates makes this race-free across files.
  await prisma.province.createMany({ data: [{ id: 9901, name: 'استان آزمون' }], skipDuplicates: true });
  await prisma.city.createMany({ data: [{ id: 990101, provinceId: 9901, name: 'شهر آزمون' }], skipDuplicates: true });
  const city = { id: 990101 };
  const factory = await prisma.user.create({
    data: { tenantId: tenant.id, role: 'FACTORY_OPERATOR', username: `f_${s}`, displayName: 'کارخانه', passwordHash },
  });
  const carrierOp = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      role: 'CARRIER_OPERATOR',
      username: `c_${s}`,
      displayName: 'اپراتور',
      passwordHash,
      carrierId: carrier.id,
    },
  });
  const mobile = randomMobile();
  const driverUser = await prisma.user.create({
    data: { tenantId: tenant.id, role: 'DRIVER', mobile, displayName: 'راننده آزمون', passwordHash },
  });
  const nid = validNationalId();
  const driver = await prisma.driver.create({
    data: {
      tenantId: tenant.id,
      userId: driverUser.id,
      carrierId: carrier.id,
      status: 'APPROVED',
      firstName: 'راننده',
      lastName: 'آزمون',
      nationalIdEnc: crypto.encrypt(nid),
      nationalIdHash: crypto.hash(`${nid}-${s}`),
      licenseNo: `L${s}`,
      licenseIssueDate: new Date('2015-01-01'),
      healthCardExpiry: new Date('2030-01-01'),
    },
  });

  const dispose = (): Promise<void> => disposeTenant(t, tenant.id);

  return {
    tenantId: tenant.id,
    carrierId: carrier.id,
    loaderTypeId: loader.id,
    cityId: city.id,
    factory: { id: factory.id, username: factory.username! },
    carrierOp: { id: carrierOp.id, username: carrierOp.username! },
    driver: { id: driver.id, userId: driverUser.id, mobile },
    dispose,
  };
}

export interface Session {
  cookie: string;
  csrf: string;
  raw: string[];
}

export function parseCookies(setCookie: string[] | string | undefined): Record<string, string> {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const out: Record<string, string> = {};
  for (const c of list) {
    const [pair] = c.split(';');
    const idx = pair!.indexOf('=');
    out[pair!.slice(0, idx)] = decodeURIComponent(pair!.slice(idx + 1));
  }
  return out;
}

export function sessionFrom(setCookie: string[] | string | undefined): Session {
  const jar = parseCookies(setCookie);
  const cookie = Object.entries(jar)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('; ');
  return { cookie, csrf: jar.csrf ?? '', raw: Array.isArray(setCookie) ? setCookie : [] };
}

export async function login(server: Server, identifier: string, password = PASSWORD, ip = '10.0.0.1') {
  const res = await request(server)
    .post('/api/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ identifier, password });
  return { res, session: sessionFrom(res.headers['set-cookie']) };
}
