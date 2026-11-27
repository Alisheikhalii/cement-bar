import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, freshIp, type TestApp } from './helpers/app';
import { createFixture, login, randomMobile, validNationalId, type Fixture } from './helpers/fixtures';

let t: TestApp;
let fx: Fixture;
let server: Server;

beforeAll(async () => {
  t = await createTestApp();
  fx = await createFixture(t);
  server = t.app.getHttpServer() as Server;
});

afterAll(async () => {
  await fx?.dispose();
  await t?.close();
});

let plateSeq = Math.floor(Math.random() * 800) + 100;
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  plateSeq += 1;
  return {
    mobile: randomMobile(),
    password: 'Driver@1234',
    firstName: 'علی',
    lastName: 'رضایی',
    nationalId: validNationalId(),
    licenseNo: `LIC${plateSeq}${Date.now() % 100000}`,
    licenseIssueDate: '2018-05-01',
    birthCityId: fx.cityId,
    healthCardExpiry: '2027-12-31',
    carrierId: fx.carrierId,
    vehicle: {
      smartCardNo: `SC${Date.now()}${plateSeq}`.slice(0, 20),
      plate: { two: String(10 + (plateSeq % 89)), letter: 'ع', three: String(plateSeq).slice(-3), iran: '63' },
      loaderTypeId: fx.loaderTypeId,
      smartCardExpiry: '2027-06-30',
      inspectionExpiry: '2027-06-30',
    },
    ...overrides,
  };
}

const register = (body: Record<string, unknown>) =>
  request(server).post('/api/auth/register-driver').set('X-Forwarded-For', freshIp()).send(body);

describe('POST /api/auth/register-driver', () => {
  it('creates User(DRIVER) + Driver(PENDING, encrypted national id) + active Vehicle and audits', async () => {
    const body = payload();
    const res = await register(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PENDING' });
    const driver = await t.prisma.driver.findUniqueOrThrow({
      where: { id: res.body.id as string },
      include: { user: true, vehicles: true },
    });
    expect(driver.status).toBe('PENDING');
    expect(driver.carrierId).toBe(fx.carrierId);
    expect(driver.tenantId).toBe(fx.tenantId);
    expect(driver.user.role).toBe('DRIVER');
    expect(driver.user.mobile).toBe(body.mobile);
    expect(driver.nationalIdEnc).not.toContain(body.nationalId as string);
    expect(t.crypto.decrypt(driver.nationalIdEnc)).toBe(body.nationalId);
    expect(driver.vehicles).toHaveLength(1);
    expect(driver.vehicles[0]!.active).toBe(true);
    const audit = await t.prisma.auditLog.findFirst({ where: { action: 'driver.register', entityId: driver.id } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.after)).not.toContain(body.nationalId as string);

    // pending driver can log in and sees PENDING
    const { res: lr } = await login(server, body.mobile as string, 'Driver@1234', freshIp());
    expect(lr.status).toBe(200);
    expect(lr.body.driver.status).toBe('PENDING');
  });

  it('returns CONFLICT with details.field=mobile for a duplicate mobile', async () => {
    const res = await register(payload({ mobile: fx.driver.mobile }));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT', details: { field: 'mobile' } });
  });

  it('returns CONFLICT with details.field=nationalId for a duplicate national id', async () => {
    const nid = validNationalId();
    expect((await register(payload({ nationalId: nid }))).status).toBe(201);
    const res = await register(payload({ nationalId: nid }));
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ field: 'nationalId' });
  });

  it('rejects an invalid national id with 400 VALIDATION_FAILED', async () => {
    const res = await register(payload({ nationalId: '1234567890' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const paths = (res.body.error.details.issues as { path: string }[]).map((i) => i.path);
    expect(paths).toContain('nationalId');
  });

  it('rejects a suspended carrier', async () => {
    await t.prisma.carrier.update({ where: { id: fx.carrierId }, data: { status: 'SUSPENDED' } });
    const res = await register(payload());
    await t.prisma.carrier.update({ where: { id: fx.carrierId }, data: { status: 'ACTIVE' } });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ field: 'carrierId' });
  });

  it('rejects unknown keys (e.g. trying to set status)', async () => {
    const res = await register(payload({ status: 'APPROVED' }));
    expect(res.status).toBe(400);
  });
});

describe('public lookups', () => {
  it('lists carriers, loader types and cities without auth', async () => {
    for (const path of ['/api/public/carriers', '/api/public/loader-types', '/api/public/cities?q=آزمون']) {
      const res = await request(server).get(path);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    }
    const cities = await request(server).get('/api/public/cities').query({ q: 'آزمون' });
    expect(cities.body.some((c: { id: number }) => c.id === fx.cityId)).toBe(true);
  });
});
