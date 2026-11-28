import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { as } from './helpers/carrier-login';
import { addDriver, addPermit, addVehicle, createWorld, randomPlate, type World } from './helpers/carrier-world';

let t: TestApp;
let w: World;
const A = () => as(w.server, w.sessions.carrierA);
const B = () => as(w.server, w.sessions.carrierB);

beforeAll(async () => {
  t = await createTestApp();
  w = await createWorld(t);
});

afterAll(async () => {
  await w?.fx.dispose();
  await t?.close();
});

describe('role matrix — carrier routes', () => {
  const routes = [
    '/carrier/dashboard',
    '/carrier/drivers',
    '/carrier/permits',
    '/carrier/daily-files',
    '/carrier/master/parties',
    '/carrier/reports/permits',
    '/carrier/reports/aggregate',
    '/carrier/reports/quota',
  ];
  for (const path of routes) {
    it(`DRIVER and FACTORY → GET ${path} = 403; CARRIER = 200`, async () => {
      const d = await as(w.server, w.sessions.driver).get(path);
      expect(d.status).toBe(403);
      const f = await as(w.server, w.sessions.factory).get(path);
      expect(f.status).toBe(403);
      expect(f.body.error.code).toBe('FORBIDDEN');
      const c = await A().get(path);
      expect(c.status).toBe(200);
    });
  }

  it('anonymous → 401', async () => {
    const res = await (await import('supertest')).default(w.server).get('/api/carrier/drivers');
    expect(res.status).toBe(401);
  });

  it('FACTORY cannot act on carrier write routes', async () => {
    const d = await addDriver(t, w.fx.tenantId, w.fx.carrierId, 'PENDING');
    const res = await as(w.server, w.sessions.factory).post(`/carrier/drivers/${d.id}/decision`, { decision: 'APPROVE' });
    expect(res.status).toBe(403);
  });
});

describe('GET /carrier/dashboard', () => {
  it('returns carrier-scoped counts and quota (QUOTA not set → null limit)', async () => {
    await addDriver(t, w.fx.tenantId, w.fx.carrierId, 'PENDING');
    await addDriver(t, w.fx.tenantId, w.b.carrierId, 'PENDING');
    const res = await A().get('/carrier/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.yearMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(res.body.quota.limitKg).toBeNull();
    const expected = await t.prisma.driver.count({ where: { carrierId: w.fx.carrierId, status: 'PENDING' } });
    expect(res.body.pendingDrivers).toBe(expected);
    expect(typeof res.body.activePermits).toBe('number');
  });

  it('reflects the monthly quota when set', async () => {
    const ym = (await A().get('/carrier/dashboard')).body.yearMonth as string;
    await t.prisma.carrierQuota.create({ data: { tenantId: w.fx.tenantId, carrierId: w.fx.carrierId, yearMonth: ym, tonnageLimitKg: 500_000n } });
    const res = await A().get('/carrier/dashboard');
    expect(res.body.quota).toMatchObject({ limitKg: '500000', usedKg: '0', remainingKg: '500000' });
  });
});

describe('/carrier/drivers', () => {
  it('lists only own drivers, with search, filters and xlsx export', async () => {
    const own = await addDriver(t, w.fx.tenantId, w.fx.carrierId, 'PENDING');
    await addVehicle(t, w.fx.tenantId, own.id, w.fx.loaderTypeId);
    const res = await A().get('/carrier/drivers?f_status=PENDING&pageSize=200');
    expect(res.status).toBe(200);
    const ids = res.body.items.map((r: { id: string }) => r.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(w.b.driverId);
    const row = res.body.items.find((r: { id: string }) => r.id === own.id);
    expect(row).toMatchObject({ status: 'PENDING', nationalId: own.nationalId, mobile: own.mobile, loaderType: 'بنکر' });
    expect(row.rowNo).toBeTypeOf('number');

    const q = await A().get(`/carrier/drivers?q=${encodeURIComponent(own.mobile)}`);
    expect(q.body.items.map((r: { id: string }) => r.id)).toEqual([own.id]);

    const x = await A().get('/carrier/drivers?format=xlsx');
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
  });

  it('rejects unknown filters and non-filterable columns (400)', async () => {
    expect((await A().get('/carrier/drivers?f_nationalId=1')).status).toBe(400);
    expect((await A().get('/carrier/drivers?carrierId=x')).status).toBe(400);
    expect((await A().get('/carrier/drivers?f_status=NOPE')).status).toBe(400);
  });

  it('detail: own driver 200, another carrier\'s driver 404, garbage id 404', async () => {
    const own = await addDriver(t, w.fx.tenantId, w.fx.carrierId, 'PENDING');
    await addVehicle(t, w.fx.tenantId, own.id, w.fx.loaderTypeId);
    const ok = await A().get(`/carrier/drivers/${own.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: own.id, nationalId: own.nationalId, vehicle: { loaderType: 'بنکر', pendingChange: null } });
    expect((await A().get(`/carrier/drivers/${w.b.driverId}`)).status).toBe(404);
    expect((await A().get('/carrier/drivers/not-a-uuid')).status).toBe(404);
  });

  it('approve: PENDING → APPROVED with audit and notification; second decision → 409', async () => {
    const d = await addDriver(t, w.fx.tenantId, w.fx.carrierId, 'PENDING');
    const res = await A().post(`/carrier/drivers/${d.id}/decision`, { decision: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    const row = await t.prisma.driver.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.status).toBe('APPROVED');
    expect(row.decidedAt).not.toBeNull();
    expect(await t.prisma.auditLog.count({ where: { entityId: d.id, action: 'driver.approve' } })).toBe(1);
    expect(await t.prisma.notification.count({ where: { userId: d.userId, type: 'DRIVER_APPROVED' } })).toBe(1);

    const again = await A().post(`/carrier/drivers/${d.id}/decision`, { decision: 'REJECT', note: 'x' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
  });

  it('reject requires a note; with a note → REJECTED', async () => {
    const d = await addDriver(t, w.fx.tenantId, w.fx.carrierId, 'PENDING');
    const noNote = await A().post(`/carrier/drivers/${d.id}/decision`, { decision: 'REJECT' });
    expect(noNote.status).toBe(400);
    const ok = await A().post(`/carrier/drivers/${d.id}/decision`, { decision: 'REJECT', note: 'مدارک ناقص' });
    expect(ok.status).toBe(200);
    expect((await t.prisma.driver.findUniqueOrThrow({ where: { id: d.id } })).decisionNote).toBe('مدارک ناقص');
  });

  it('rejects unknown body keys (strict schema)', async () => {
    const d = await addDriver(t, w.fx.tenantId, w.fx.carrierId, 'PENDING');
    const res = await A().post(`/carrier/drivers/${d.id}/decision`, { decision: 'APPROVE', carrierId: w.b.carrierId });
    expect(res.status).toBe(400);
  });

  it('IDOR: carrier B cannot decide or block carrier A\'s driver', async () => {
    const d = await addDriver(t, w.fx.tenantId, w.fx.carrierId, 'PENDING');
    expect((await B().post(`/carrier/drivers/${d.id}/decision`, { decision: 'APPROVE' })).status).toBe(404);
    expect((await B().post(`/carrier/drivers/${d.id}/block`, { reason: 'x' })).status).toBe(404);
    expect((await t.prisma.driver.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('PENDING');
  });

  it('block: APPROVED → BLOCKED with reason and end date; PENDING cannot be blocked; past date → 400', async () => {
    const d = await addDriver(t, w.fx.tenantId, w.fx.carrierId, 'APPROVED');
    expect((await A().post(`/carrier/drivers/${d.id}/block`, { reason: 'x', until: '2020-01-01' })).status).toBe(400);
    const res = await A().post(`/carrier/drivers/${d.id}/block`, { reason: 'تخلف', until: '2099-01-10' });
    expect(res.status).toBe(200);
    const row = await t.prisma.driver.findUniqueOrThrow({ where: { id: d.id } });
    expect(row).toMatchObject({ status: 'BLOCKED', blockReason: 'تخلف' });
    expect(row.blockedUntil?.toISOString()).toBe('2099-01-10T20:30:00.000Z'); // 2099-01-11 00:00 Tehran
    expect(await t.prisma.auditLog.count({ where: { entityId: d.id, action: 'driver.block' } })).toBe(1);

    const p = await addDriver(t, w.fx.tenantId, w.fx.carrierId, 'PENDING');
    expect((await A().post(`/carrier/drivers/${p.id}/block`, { reason: 'x' })).status).toBe(409);
    expect((await A().post(`/carrier/drivers/${p.id}/block`, {})).status).toBe(400);
  });
});

describe('POST /carrier/drivers/:id/vehicle-change', () => {
  async function pendingDriver(change: Record<string, unknown>) {
    const d = await addDriver(t, w.fx.tenantId, w.fx.carrierId, 'APPROVED');
    const v = await addVehicle(t, w.fx.tenantId, d.id, w.fx.loaderTypeId, { ...change, requestedAt: new Date().toISOString() });
    return { d, v };
  }

  it('approve applies the plate and loader type and clears the request', async () => {
    const lt2 = await t.prisma.loaderType.create({ data: { tenantId: w.fx.tenantId, code: `KF_${Date.now()}`, title: 'کفی' } });
    const plate = randomPlate();
    const { d, v } = await pendingDriver({ plate, loaderTypeId: lt2.id });
    const detail = await A().get(`/carrier/drivers/${d.id}`);
    expect(detail.body.vehicle.pendingChange).toMatchObject({ plate, loaderType: 'کفی' });
    const list = await A().get('/carrier/drivers?vehicleChange=true&pageSize=200');
    expect(list.body.items.map((r: { id: string }) => r.id)).toContain(d.id);

    const res = await A().post(`/carrier/drivers/${d.id}/vehicle-change`, { decision: 'APPROVE' });
    expect(res.status).toBe(200);
    const row = await t.prisma.vehicle.findUniqueOrThrow({ where: { id: v.id } });
    expect(row).toMatchObject({ plate, loaderTypeId: lt2.id, status: 'APPROVED', pendingChange: null });
    expect(await t.prisma.auditLog.count({ where: { entityId: v.id, action: 'vehicle.change.approve' } })).toBe(1);
    // nothing pending any more
    expect((await A().post(`/carrier/drivers/${d.id}/vehicle-change`, { decision: 'APPROVE' })).status).toBe(409);
  });

  it('reject keeps the old vehicle data; reject without note → 400', async () => {
    const { d, v } = await pendingDriver({ plate: randomPlate() });
    expect((await A().post(`/carrier/drivers/${d.id}/vehicle-change`, { decision: 'REJECT' })).status).toBe(400);
    const res = await A().post(`/carrier/drivers/${d.id}/vehicle-change`, { decision: 'REJECT', note: 'پلاک نادرست' });
    expect(res.status).toBe(200);
    const row = await t.prisma.vehicle.findUniqueOrThrow({ where: { id: v.id } });
    expect(row).toMatchObject({ plate: v.plate, status: 'APPROVED', pendingChange: null });
  });

  it('approve is refused while the driver has an in-progress permit', async () => {
    const { d } = await pendingDriver({ plate: randomPlate() });
    await addPermit(t, { tenantId: w.fx.tenantId, carrierId: w.fx.carrierId, driverId: d.id, loaderTypeId: w.fx.loaderTypeId });
    const res = await A().post(`/carrier/drivers/${d.id}/vehicle-change`, { decision: 'APPROVE' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_ACTIVE_RESERVATIONS');
  });

  it('a plate already used by another vehicle → 409 CONFLICT', async () => {
    const other = await addDriver(t, w.fx.tenantId, w.fx.carrierId, 'APPROVED');
    const taken = await addVehicle(t, w.fx.tenantId, other.id, w.fx.loaderTypeId);
    const { d } = await pendingDriver({ plate: taken.plate });
    const res = await A().post(`/carrier/drivers/${d.id}/vehicle-change`, { decision: 'APPROVE' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT', details: { field: 'plate' } });
  });

  it('IDOR: carrier B cannot decide carrier A\'s vehicle change', async () => {
    const { d } = await pendingDriver({ plate: randomPlate() });
    expect((await B().post(`/carrier/drivers/${d.id}/vehicle-change`, { decision: 'APPROVE' })).status).toBe(404);
  });
});
