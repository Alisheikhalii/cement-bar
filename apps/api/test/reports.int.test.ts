import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDateTimeToUtc } from '@cb/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { as } from './helpers/carrier-login';
import { addPermit, addVehicle, createWorld, type World } from './helpers/carrier-world';

let t: TestApp;
let w: World;
const A = () => as(w.server, w.sessions.carrierA);
const B = () => as(w.server, w.sessions.carrierB);
const F = () => as(w.server, w.sessions.factory);
const ids = (body: { items: { id: string }[] }) => body.items.map((r) => r.id);
const p: Record<string, { id: string }> = {};

beforeAll(async () => {
  t = await createTestApp();
  w = await createWorld(t);
  await addVehicle(t, w.fx.tenantId, w.fx.driver.id, w.fx.loaderTypeId);
  const base = { tenantId: w.fx.tenantId, loaderTypeId: w.fx.loaderTypeId };
  const day = (d: string) => localDateTimeToUtc(d, '10:00');
  // carrier A: 2 counted permits on 2026-11-10 (PER_TRUCK 50M + PER_TON 2M × 25 t = 50M), 1 cancelled, 1 outside range
  p.a1 = await addPermit(t, { ...base, carrierId: w.fx.carrierId, driverId: w.fx.driver.id, reservedAt: day('2026-11-10') });
  p.a2 = await addPermit(t, {
    ...base,
    carrierId: w.fx.carrierId,
    driverId: w.fx.driver.id,
    reservedAt: day('2026-11-10'),
    status: 'EXITED',
    fare: { fareCalc: 'PER_TON', ratePerTon: 2_000_000n },
    weightToKg: 25_000,
  });
  p.a3 = await addPermit(t, { ...base, carrierId: w.fx.carrierId, driverId: w.fx.driver.id, reservedAt: day('2026-11-10'), status: 'CANCELLED' });
  p.a4 = await addPermit(t, { ...base, carrierId: w.fx.carrierId, driverId: w.fx.driver.id, reservedAt: day('2026-10-01') });
  // carrier B: 1 permit in range
  p.b1 = await addPermit(t, { ...base, carrierId: w.b.carrierId, driverId: w.b.driverId, reservedAt: day('2026-11-10') });
  await t.prisma.carrierQuota.create({ data: { tenantId: w.fx.tenantId, carrierId: w.fx.carrierId, yearMonth: '1405-08', tonnageLimitKg: 200_000n } });
});

afterAll(async () => {
  await w?.fx.dispose();
  await t?.close();
});

describe('role matrix — factory reports', () => {
  for (const path of ['/factory/reports/permits', '/factory/reports/aggregate', '/factory/reports/quota', '/factory/reports/carriers']) {
    it(`CARRIER / DRIVER → GET ${path} = 403; FACTORY = 200`, async () => {
      expect((await A().get(path)).status).toBe(403);
      expect((await as(w.server, w.sessions.driver).get(path)).status).toBe(403);
      expect((await F().get(path)).status).toBe(200);
    });
  }
});

describe('issued permits report', () => {
  it('carrier sees only its own permits (all statuses)', async () => {
    const res = await A().get('/carrier/reports/permits?pageSize=200');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(expect.arrayContaining([p.a1!.id, p.a2!.id, p.a3!.id, p.a4!.id]));
    expect(ids(res.body)).not.toContain(p.b1!.id);
    expect(ids((await B().get('/carrier/reports/permits?pageSize=200')).body)).toEqual([p.b1!.id]);
  });

  it('carrier cannot widen its scope with carrierId (400)', async () => {
    expect((await A().get(`/carrier/reports/permits?carrierId=${w.b.carrierId}`)).status).toBe(400);
  });

  it('factory sees the whole tenant, optionally filtered by carrier', async () => {
    const all = await F().get('/factory/reports/permits?pageSize=200');
    expect(all.body.total).toBe(5);
    const onlyB = await F().get(`/factory/reports/permits?carrierId=${w.b.carrierId}`);
    expect(ids(onlyB.body)).toEqual([p.b1!.id]);
    expect((await F().get('/factory/reports/permits?carrierId=nope')).status).toBe(400);
    expect(ids((await F().get('/factory/reports/permits?view=archived&pageSize=200')).body).sort()).toEqual([p.a2!.id, p.a3!.id].sort());
  });

  it('xlsx export', async () => {
    const res = await F().get('/factory/reports/permits?format=xlsx');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('issued-permits.xlsx');
  });
});

describe('aggregate report', () => {
  it('carrier: one row, non-cancelled permits in range, total fare', async () => {
    const res = await A().get('/carrier/reports/aggregate?from=2026-11-01&to=2026-11-30');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({ id: w.fx.carrierId, permitCount: 2, totalFare: '100000000' }),
    ]);
    const allTime = await A().get('/carrier/reports/aggregate');
    expect(allTime.body.items[0]).toMatchObject({ permitCount: 3, totalFare: '150000000' });
  });

  it('factory: every carrier of the tenant; carrier filter; invalid range → 400', async () => {
    const res = await F().get('/factory/reports/aggregate?from=2026-11-01&to=2026-11-30');
    const byId = new Map(res.body.items.map((r: { id: string }) => [r.id, r]));
    expect(byId.get(w.fx.carrierId)).toMatchObject({ permitCount: 2 });
    expect(byId.get(w.b.carrierId)).toMatchObject({ permitCount: 1, totalFare: '50000000' });
    const onlyB = await F().get(`/factory/reports/aggregate?carrierId=${w.b.carrierId}`);
    expect(onlyB.body.items).toHaveLength(1);
    expect((await F().get('/factory/reports/aggregate?from=2026-12-01&to=2026-11-01')).status).toBe(400);
    expect((await F().get('/factory/reports/aggregate?from=bad')).status).toBe(400);
    expect((await F().get('/factory/reports/aggregate?format=xlsx')).status).toBe(200);
  });
});

describe('quota usage report', () => {
  it('carrier: own row for the requested month', async () => {
    const res = await A().get('/carrier/reports/quota?yearMonth=1405-08');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({ id: w.fx.carrierId, yearMonth: '1405-08', limitKg: 200_000, usedKg: expect.any(Number) }),
    ]);
    expect((await A().get('/carrier/reports/quota?yearMonth=1405-13')).status).toBe(400);
  });

  it('factory: all carriers, no-quota carrier has null limit', async () => {
    const res = await F().get('/factory/reports/quota?yearMonth=1405-08');
    const byId = new Map(res.body.items.map((r: { id: string }) => [r.id, r]));
    expect(byId.get(w.fx.carrierId)).toMatchObject({ limitKg: 200_000 });
    expect(byId.get(w.b.carrierId)).toMatchObject({ limitKg: null, remainingKg: null, usedPercent: null });
    const carriers = await F().get('/factory/reports/carriers');
    expect(carriers.body.map((c: { id: string }) => c.id).sort()).toEqual([w.fx.carrierId, w.b.carrierId].sort());
  });
});
