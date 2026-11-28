import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysIso, localDate } from '@cb/shared';
import { createTestApp, freshIp, type TestApp } from './helpers/app';
import { createFixture, login, PASSWORD, type Fixture, type Session } from './helpers/fixtures';
import { addDriver, addVehicle, randomPlate } from './helpers/driver-fixtures';

let t: TestApp;
let fx: Fixture;
let other: Fixture; // a second tenant: must never leak into driver A's responses
let server: Server;
let today: string;
const s: Record<string, Session> = {};
let vehicleA: { id: string; plate: string; smartCardNo: string };
let vehicleB: { id: string; plate: string; smartCardNo: string };
let driverB: Awaited<ReturnType<typeof addDriver>>;
let pending: Awaited<ReturnType<typeof addDriver>>;
let rejected: Awaited<ReturnType<typeof addDriver>>;
let blocked: Awaited<ReturnType<typeof addDriver>>;

const ORIGIN = 'http://localhost:3000';
const get = (path: string, who: string) => request(server).get(path).set('Cookie', s[who]!.cookie);
const write = (method: 'patch' | 'post' | 'delete', path: string, who: string, body?: object) => {
  const r = request(server)
    [method](path)
    .set('Cookie', s[who]!.cookie)
    .set('X-CSRF', s[who]!.csrf)
    .set('Origin', ORIGIN);
  return body ? r.send(body) : r;
};
const loginAs = async (key: string, identifier: string) => {
  const { res, session } = await login(server, identifier, PASSWORD, freshIp());
  expect(res.status).toBe(200);
  s[key] = session;
};

const profileBody = (over: Record<string, unknown> = {}) => ({
  licenseNo: 'L-99887766',
  licenseIssueDate: '2018-03-21',
  birthCityId: fx.cityId,
  healthCardExpiry: addDaysIso(today, 200),
  ...over,
});

beforeAll(async () => {
  t = await createTestApp();
  server = t.app.getHttpServer() as Server;
  fx = await createFixture(t);
  other = await createFixture(t);
  today = localDate(t.clock.now());
  // Driver A (fixture driver): smart card in 30 days (warning), inspection in 5 days (danger).
  vehicleA = await addVehicle(t, fx, fx.driver.id, {
    smartCardExpiry: addDaysIso(today, 30),
    inspectionExpiry: addDaysIso(today, 5),
  });
  driverB = await addDriver(t, fx, PASSWORD);
  vehicleB = await addVehicle(t, fx, driverB.id, {
    smartCardExpiry: '2030-01-01',
    inspectionExpiry: '2030-01-01',
  });
  pending = await addDriver(t, fx, PASSWORD, { status: 'PENDING' });
  await addVehicle(t, fx, pending.id, { smartCardExpiry: '2030-01-01', inspectionExpiry: '2030-01-01' });
  rejected = await addDriver(t, fx, PASSWORD, { status: 'REJECTED', decisionNote: 'مدارک ناقص است' });
  blocked = await addDriver(t, fx, PASSWORD, {
    status: 'BLOCKED',
    blockReason: 'تخلف',
    healthCardExpiry: addDaysIso(today, -3),
  });

  await loginAs('A', fx.driver.mobile);
  await loginAs('B', driverB.mobile);
  await loginAs('PENDING', pending.mobile);
  await loginAs('REJECTED', rejected.mobile);
  await loginAs('BLOCKED', blocked.mobile);
  await loginAs('FACTORY_OPERATOR', fx.factory.username);
  await loginAs('CARRIER_OPERATOR', fx.carrierOp.username);
});

afterAll(async () => {
  await fx?.dispose();
  await other?.dispose();
  await t?.close();
});

const GET_ROUTES = [
  '/api/driver/dashboard',
  '/api/driver/profile',
  '/api/driver/profile/vehicle',
  '/api/driver/companies',
  '/api/driver/hall-hours',
];

describe('role matrix', () => {
  for (const path of GET_ROUTES) {
    for (const role of ['FACTORY_OPERATOR', 'CARRIER_OPERATOR']) {
      it(`${role} → GET ${path} = 403`, async () => {
        const res = await get(path, role);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    }
    it(`anonymous → GET ${path} = 401`, async () => {
      expect((await request(server).get(path)).status).toBe(401);
    });
    it(`DRIVER → GET ${path} = 200`, async () => {
      expect((await get(path, 'A')).status).toBe(200);
    });
  }

  it('carrier operator cannot PATCH a driver profile or request a vehicle change', async () => {
    expect((await write('patch', '/api/driver/profile', 'CARRIER_OPERATOR', profileBody())).status).toBe(403);
    expect(
      (await write('post', '/api/driver/profile/vehicle/change', 'FACTORY_OPERATOR', { smartCardNo: 'X1' }))
        .status,
    ).toBe(403);
  });
});

describe('GET /driver/dashboard', () => {
  it('documents use the server clock with Q-B5 levels; alerts list expiring documents', async () => {
    const res = await get('/api/driver/dashboard', 'A');
    expect(res.status).toBe(200);
    expect(res.body.today).toBe(today);
    expect(res.body.driver).toMatchObject({ status: 'APPROVED', canOperate: true });
    expect(res.body.carrier.id).toBe(fx.carrierId);
    expect(res.body.vehicle.plate).toBe(vehicleA.plate);
    const docs = Object.fromEntries(res.body.documents.map((d: { kind: string }) => [d.kind, d]));
    expect(docs.SMART_CARD).toMatchObject({ daysLeft: 30, level: 'warning' });
    expect(docs.INSPECTION).toMatchObject({ daysLeft: 5, level: 'danger' });
    expect(docs.HEALTH_CARD.level).toBe('success');
    const kinds = res.body.alerts.map(
      (a: { kind: string; document?: string }) => `${a.kind}:${a.document ?? ''}`,
    );
    expect(kinds).toEqual(
      expect.arrayContaining(['DOCUMENT_EXPIRING:SMART_CARD', 'DOCUMENT_EXPIRING:INSPECTION']),
    );
  });

  it('days left follow the (fake) server clock, not the request', async () => {
    const before = t.clock.now();
    t.clock.advance(31 * 86_400_000);
    try {
      await loginAs('A', fx.driver.mobile); // the old access token is expired at the new server time
      const res = await get('/api/driver/dashboard', 'A');
      expect(res.body.today).toBe(addDaysIso(today, 31));
      const smart = res.body.documents.find((d: { kind: string }) => d.kind === 'SMART_CARD');
      expect(smart.level).toBe('expired');
      expect(res.body.driver.canOperate).toBe(false);
      expect(res.body.alerts.some((a: { kind: string }) => a.kind === 'DOCUMENT_EXPIRED')).toBe(true);
    } finally {
      t.clock.set(before);
      await loginAs('A', fx.driver.mobile);
    }
  });

  it('pending driver sees the dashboard with a pending alert and canOperate=false', async () => {
    const res = await get('/api/driver/dashboard', 'PENDING');
    expect(res.status).toBe(200);
    expect(res.body.driver).toMatchObject({ status: 'PENDING', canOperate: false });
    expect(res.body.alerts[0].kind).toBe('PENDING_APPROVAL');
  });

  it('rejected driver sees the rejection reason; blocked driver sees block reason and expired health card', async () => {
    const r = await get('/api/driver/dashboard', 'REJECTED');
    expect(r.body.alerts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'REJECTED', reason: 'مدارک ناقص است' })]),
    );
    expect(r.body.alerts.some((a: { kind: string }) => a.kind === 'NO_VEHICLE')).toBe(true);
    const b = await get('/api/driver/dashboard', 'BLOCKED');
    expect(b.body.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'BLOCKED', reason: 'تخلف' }),
        expect.objectContaining({ kind: 'DOCUMENT_EXPIRED', document: 'HEALTH_CARD' }),
      ]),
    );
  });

  it('an active penalty shows as PENALIZED until it ends', async () => {
    const until = new Date(t.clock.now().getTime() + 3_600_000);
    await t.prisma.driverPenalty.create({
      data: { tenantId: fx.tenantId, driverId: driverB.id, reason: 'MANUAL', until },
    });
    const res = await get('/api/driver/dashboard', 'B');
    expect(res.body.alerts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'PENALIZED', until: until.toISOString() })]),
    );
    expect(res.body.driver.canOperate).toBe(false);
    await t.prisma.driverPenalty.deleteMany({ where: { driverId: driverB.id } });
  });
});

describe('profile', () => {
  it('GET returns the read-only identity of the session driver', async () => {
    const res = await get('/api/driver/profile', 'A');
    expect(res.status).toBe(200);
    expect(res.body.mobile).toBe(fx.driver.mobile);
    expect(res.body.nationalId).toMatch(/^\d{10}$/);
    expect(res.body.firstName).toBe('راننده');
  });

  it.each([
    ['mobile', '09121111111'],
    ['nationalId', '0012345679'],
    ['firstName', 'x'],
    ['lastName', 'y'],
    ['driverId', 'z'],
  ])('PATCH rejects read-only / unknown field %s (strict schema)', async (field, value) => {
    const res = await write('patch', '/api/driver/profile', 'A', profileBody({ [field]: value }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('PATCH rejects impossible or future dates and unknown cities', async () => {
    expect(
      (await write('patch', '/api/driver/profile', 'A', profileBody({ healthCardExpiry: '2027-02-30' })))
        .status,
    ).toBe(400);
    expect(
      (
        await write(
          'patch',
          '/api/driver/profile',
          'A',
          profileBody({ licenseIssueDate: addDaysIso(today, 2) }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await write('patch', '/api/driver/profile', 'A', profileBody({ birthCityId: 987654321 }))).status,
    ).toBe(400);
  });

  it('PATCH requires CSRF', async () => {
    const res = await request(server)
      .patch('/api/driver/profile')
      .set('Cookie', s.A!.cookie)
      .send(profileBody());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('PATCH updates editable fields, keeps identity, encrypts sheba and audits the expiry change', async () => {
    const newExpiry = addDaysIso(today, 250);
    const sheba = 'IR062960000000100324200001';
    const res = await write(
      'patch',
      '/api/driver/profile',
      'A',
      profileBody({
        healthCardExpiry: newExpiry,
        address: 'نی‌ریز، خیابان اصلی',
        postalCode: '7491234567',
        sheba,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      healthCardExpiry: newExpiry,
      address: 'نی‌ریز، خیابان اصلی',
      sheba,
      mobile: fx.driver.mobile,
    });
    const row = await t.prisma.driver.findUniqueOrThrow({ where: { id: fx.driver.id } });
    expect(row.shebaEnc).not.toContain(sheba);
    expect(row.firstName).toBe('راننده');
    const audit = await t.prisma.auditLog.findFirst({
      where: { entity: 'Driver', entityId: fx.driver.id, action: 'driver.profile.update' },
      orderBy: { at: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(fx.driver.userId);
    expect(audit!.reason).toBe('self-declared document expiry');
    expect((audit!.after as Record<string, unknown>).healthCardExpiry).toBe(newExpiry);
    expect(JSON.stringify(audit!.after)).not.toContain(sheba);
  });

  it('omitting an optional field leaves it unchanged', async () => {
    const res = await write('patch', '/api/driver/profile', 'A', profileBody());
    expect(res.status).toBe(200);
    expect(res.body.address).toBe('نی‌ریز، خیابان اصلی');
  });
});

describe('vehicle', () => {
  it('GET returns the active vehicle of the session driver', async () => {
    const res = await get('/api/driver/profile/vehicle', 'A');
    expect(res.body).toMatchObject({
      id: vehicleA.id,
      plate: vehicleA.plate,
      status: 'APPROVED',
      pendingChange: null,
    });
    expect(res.body.loaderType.id).toBe(fx.loaderTypeId);
  });

  it('PATCH updates expiry dates and audits them; rejects bad dates and extra keys', async () => {
    const body = { smartCardExpiry: addDaysIso(today, 120), inspectionExpiry: addDaysIso(today, 90) };
    expect((await write('patch', '/api/driver/profile/vehicle', 'A', { ...body, plate: 'x' })).status).toBe(
      400,
    );
    expect(
      (await write('patch', '/api/driver/profile/vehicle', 'A', { ...body, inspectionExpiry: '2026-02-31' }))
        .status,
    ).toBe(400);
    const res = await write('patch', '/api/driver/profile/vehicle', 'A', body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(body);
    const audit = await t.prisma.auditLog.findFirst({
      where: { entity: 'Vehicle', entityId: vehicleA.id, action: 'vehicle.expiry.update' },
      orderBy: { at: 'desc' },
    });
    expect(audit?.after).toEqual(body);
  });

  it('change request: validation, conflicts, success, duplicate and withdraw', async () => {
    const url = '/api/driver/profile/vehicle/change';
    expect((await write('post', url, 'A', {})).status).toBe(400);
    expect((await write('post', url, 'A', { smartCardNo: vehicleA.smartCardNo })).body.error.code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await write('post', url, 'A', { loaderTypeId: other.loaderTypeId })).status).toBe(400); // other tenant's loader
    const taken = await write('post', url, 'A', { smartCardNo: vehicleB.smartCardNo });
    expect(taken.status).toBe(409);
    expect(taken.body.error.details).toEqual({ field: 'smartCardNo' });

    const plate = randomPlate();
    const ok = await write('post', url, 'A', { plate: plate.body });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('PENDING_CHANGE');
    expect(ok.body.plate).toBe(vehicleA.plate); // old data stays in force until the carrier approves (T7)
    expect(ok.body.pendingChange.plate).toBe(plate.normalized);
    const row = await t.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleA.id } });
    expect(row.status).toBe('PENDING_CHANGE');
    expect((row.pendingChange as Record<string, unknown>).plate).toBe(plate.normalized);
    expect(
      await t.prisma.auditLog.count({
        where: { entity: 'Vehicle', entityId: vehicleA.id, action: 'vehicle.change.request' },
      }),
    ).toBe(1);

    // a second request while one is pending is refused; another driver can't claim the pending plate
    expect((await write('post', url, 'A', { smartCardNo: 'NEW-1' })).body.error.code).toBe('INVALID_STATE');
    const dup = await write('post', url, 'B', { plate: plate.body });
    expect(dup.status).toBe(409);

    const w = await write('delete', url, 'A');
    expect(w.status).toBe(200);
    expect(w.body).toMatchObject({ status: 'APPROVED', pendingChange: null });
    expect((await write('delete', url, 'A')).body.error.code).toBe('INVALID_STATE');
  });

  it('pending and blocked drivers cannot request a vehicle change', async () => {
    const url = '/api/driver/profile/vehicle/change';
    expect((await write('post', url, 'PENDING', { smartCardNo: 'P-1' })).body.error.code).toBe(
      'DRIVER_NOT_APPROVED',
    );
    expect((await write('post', url, 'BLOCKED', { smartCardNo: 'P-2' })).body.error.code).toBe(
      'DRIVER_BLOCKED',
    );
  });

  it('driver without a vehicle gets 404', async () => {
    expect((await get('/api/driver/profile/vehicle', 'REJECTED')).status).toBe(404);
  });
});

describe('IDOR', () => {
  it('driver B only ever sees their own profile and vehicle, whatever ids are sent', async () => {
    const p = await get(`/api/driver/profile?driverId=${fx.driver.id}`, 'B');
    expect(p.body.mobile).toBe(driverB.mobile);
    expect(p.body.nationalId).toBe(driverB.nationalId);
    const v = await get(`/api/driver/profile/vehicle?driverId=${fx.driver.id}&id=${vehicleA.id}`, 'B');
    expect(v.body.id).toBe(vehicleB.id);
    const d = await get(`/api/driver/dashboard?driverId=${fx.driver.id}`, 'B');
    expect(d.body.vehicle.id).toBe(vehicleB.id);
  });

  it('driver B writes never touch driver A', async () => {
    const before = await t.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleA.id } });
    const res = await write('patch', '/api/driver/profile/vehicle', 'B', {
      smartCardExpiry: '2031-01-01',
      inspectionExpiry: '2031-01-01',
    });
    expect(res.body.id).toBe(vehicleB.id);
    const after = await t.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleA.id } });
    expect(after.smartCardExpiry).toEqual(before.smartCardExpiry);
    expect(
      (await write('patch', '/api/driver/profile', 'B', profileBody({ driverId: fx.driver.id }))).status,
    ).toBe(400);
  });

  it('no driver route takes an id path parameter', async () => {
    expect((await get(`/api/driver/profile/${fx.driver.id}`, 'B')).status).toBe(404);
    expect((await get(`/api/driver/profile/vehicle/${vehicleA.id}`, 'B')).status).toBe(404);
  });
});

describe('GET /driver/companies', () => {
  it('lists active carriers of the tenant, own carrier first with approval status; no other tenant', async () => {
    const suspended = await t.prisma.carrier.create({
      data: { tenantId: fx.tenantId, code: `S${Date.now()}`, name: 'باربری تعلیق', status: 'SUSPENDED' },
    });
    const extra = await t.prisma.carrier.create({
      data: {
        tenantId: fx.tenantId,
        code: `E${Date.now()}`,
        name: 'الف باربری',
        phone: '07153820000',
        address: 'نی‌ریز',
      },
    });
    const res = await get('/api/driver/companies', 'PENDING');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: fx.carrierId, mine: true, driverStatus: 'PENDING' });
    const ids = res.body.map((c: { id: string }) => c.id);
    expect(ids).toContain(extra.id);
    expect(ids).not.toContain(suspended.id);
    expect(ids).not.toContain(other.carrierId);
    expect(res.body.find((c: { id: string }) => c.id === extra.id)).toMatchObject({
      mine: false,
      driverStatus: null,
      phone: '07153820000',
    });
  });
});

describe('GET /driver/hall-hours', () => {
  it('returns 7 days of tenant halls: created days override the weekly schedule; other tenants hidden', async () => {
    const hall = await t.prisma.hall.create({
      data: {
        tenantId: fx.tenantId,
        title: 'سالن کیسه‌ای آزمون',
        category: 'BAG',
        defaultAllocation: 'TIMED',
      },
    });
    await t.prisma.hall.create({
      data: {
        tenantId: fx.tenantId,
        title: 'سالن غیرفعال',
        category: 'BULK',
        defaultAllocation: 'GROUP',
        active: false,
      },
    });
    const foreign = await t.prisma.hall.create({
      data: { tenantId: other.tenantId, title: 'سالن دیگر', category: 'BAG', defaultAllocation: 'TIMED' },
    });
    await t.prisma.hallSchedule.createMany({
      data: Array.from({ length: 7 }, (_, weekday) => ({
        tenantId: fx.tenantId,
        hallId: hall.id,
        weekday,
        t0: '08:00',
        priorityEnd: '08:30',
        hallEnd: '12:00',
      })),
    });
    await t.prisma.hallSchedule.create({
      data: { tenantId: other.tenantId, hallId: foreign.id, weekday: 0, t0: '07:00', hallEnd: '09:00' },
    });
    const t0At = new Date(t.clock.now().getTime() + 3_600_000);
    await t.prisma.hallDay.create({
      data: {
        tenantId: fx.tenantId,
        hallId: hall.id,
        date: today,
        t0At,
        hallEndAt: new Date(t0At.getTime() + 3_600_000),
        status: 'OPEN',
      },
    });

    const res = await get('/api/driver/hall-hours', 'PENDING');
    expect(res.status).toBe(200);
    expect(res.body.today).toBe(today);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.days[0].entries).toEqual([
      expect.objectContaining({ hallId: hall.id, source: 'DAY', status: 'OPEN', t0At: t0At.toISOString() }),
    ]);
    expect(res.body.days[1].entries).toEqual([
      expect.objectContaining({ hallId: hall.id, source: 'SCHEDULE', status: null }),
    ]);
    const allHallIds = res.body.days.flatMap((d: { entries: { hallId: string }[] }) =>
      d.entries.map((e) => e.hallId),
    );
    expect(new Set(allHallIds)).toEqual(new Set([hall.id]));
  });
});

describe('D11: suspended carrier', () => {
  it("does not block its drivers' login or dashboard", async () => {
    await t.prisma.carrier.update({ where: { id: other.carrierId }, data: { status: 'SUSPENDED' } });
    const { res, session } = await login(server, other.driver.mobile, PASSWORD, freshIp());
    expect(res.status).toBe(200);
    const d = await request(server).get('/api/driver/dashboard').set('Cookie', session.cookie);
    expect(d.status).toBe(200);
    expect(d.body.carrier).toMatchObject({ id: other.carrierId, status: 'SUSPENDED' });
    const c = await request(server).get('/api/driver/companies').set('Cookie', session.cookie);
    expect(c.body.map((x: { id: string }) => x.id)).toEqual([other.carrierId]);
  });
});
