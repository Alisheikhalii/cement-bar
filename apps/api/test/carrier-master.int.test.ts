import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { as } from './helpers/carrier-login';
import { createWorld, type World } from './helpers/carrier-world';

let t: TestApp;
let w: World;
const A = () => as(w.server, w.sessions.carrierA);
const B = () => as(w.server, w.sessions.carrierB);
const ids = (body: { items: { id: string }[] }) => body.items.map((r) => r.id);

beforeAll(async () => {
  t = await createTestApp();
  w = await createWorld(t);
});

afterAll(async () => {
  await w?.fx.dispose();
  await t?.close();
});

const samples = {
  parties: () => ({ title: 'شرکت الف', name: 'احمد', nationalId: '۱۰۱۰۱۰۱۰۱۰', addresses: [{ address: 'شیراز، خیابان ۱' }] }),
  'goods-owners': () => ({ name: 'صاحب کالا', nationalId: '1234567890', phone: '071-123', mobile: '09121234567', otherInfo: 'x' }),
  'loading-locations': () => ({ warehouseType: 'انبار سرپوشیده', name: 'انبار ۱', cityId: 990101 }),
  'cargo-descriptions': () => ({ text: 'سیمان پاکتی' }),
  'loading-conditions': () => ({ name: 'شرط', condition: 'بارگیری با چادر' }),
} as const;
type Kind = keyof typeof samples;
const kinds = Object.keys(samples) as Kind[];

describe('carrier master data CRUD', () => {
  for (const kind of kinds) {
    it(`${kind}: create → list → get → update → delete (own rows only)`, async () => {
      const created = await A().post(`/carrier/master/${kind}`, samples[kind]());
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const list = await A().get(`/carrier/master/${kind}?pageSize=200`);
      expect(list.status).toBe(200);
      expect(ids(list.body)).toContain(id);
      const row = list.body.items.find((r: { id: string }) => r.id === id);
      if (kind === 'parties') expect(row).toMatchObject({ nationalId: '1010101010', addressCount: 1 });
      if (kind === 'loading-locations') expect(row).toMatchObject({ city: 'شهر آزمون', shared: false });

      const got = await A().get(`/carrier/master/${kind}/${id}`);
      expect(got.status).toBe(200);
      expect(got.body.shared).toBe(false);

      // carrier B sees nothing of A, and cannot read / write / delete it
      expect(ids((await B().get(`/carrier/master/${kind}?pageSize=200`)).body)).not.toContain(id);
      expect((await B().get(`/carrier/master/${kind}/${id}`)).status).toBe(404);
      expect((await B().put(`/carrier/master/${kind}/${id}`, samples[kind]())).status).toBe(404);
      expect((await B().del(`/carrier/master/${kind}/${id}`)).status).toBe(404);

      const upd = await A().put(`/carrier/master/${kind}/${id}`, samples[kind]());
      expect(upd.status).toBe(200);
      expect(await t.prisma.auditLog.count({ where: { entityId: id } })).toBe(2);

      expect((await A().del(`/carrier/master/${kind}/${id}`)).status).toBe(204);
      expect(ids((await A().get(`/carrier/master/${kind}?pageSize=200`)).body)).not.toContain(id);
      expect((await A().get(`/carrier/master/${kind}/${id}`)).status).toBe(404);
      expect((await A().del(`/carrier/master/${kind}/${id}`)).status).toBe(404);
    });
  }

  it('encrypts national ids at rest and keeps PII out of the audit log', async () => {
    const res = await A().post('/carrier/master/goods-owners', samples['goods-owners']());
    const row = await t.prisma.goodsOwner.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.nationalIdEnc).not.toContain('1234567890');
    expect(row.carrierId).toBe(w.fx.carrierId);
    const log = await t.prisma.auditLog.findFirstOrThrow({ where: { entityId: res.body.id } });
    expect(JSON.stringify(log.after)).not.toContain('1234567890');
    expect(JSON.stringify(log.after)).not.toContain('09121234567');
  });

  it('validation: missing required fields, invalid national id length, unknown keys → 400', async () => {
    expect((await A().post('/carrier/master/parties', { title: 'x' })).status).toBe(400);
    expect((await A().post('/carrier/master/parties', { ...samples.parties(), nationalId: '12' })).status).toBe(400);
    expect((await A().post('/carrier/master/cargo-descriptions', { text: 'x', carrierId: w.b.carrierId })).status).toBe(400);
    expect((await A().post('/carrier/master/cargo-descriptions', { text: '' })).status).toBe(400);
  });

  it('unknown kind → 404', async () => {
    expect((await A().get('/carrier/master/users')).status).toBe(404);
    expect((await A().post('/carrier/master/users', {})).status).toBe(404);
  });

  it('options endpoint returns own + shared rows with labels', async () => {
    const own = await A().post('/carrier/master/cargo-descriptions', { text: `گزینه-${Date.now()}` });
    const opts = await A().get(`/carrier/master/cargo-descriptions/options?q=${encodeURIComponent('گزینه')}`);
    expect(opts.status).toBe(200);
    expect(opts.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: own.body.id, shared: false })]));
    expect((await B().get('/carrier/master/cargo-descriptions/options')).body.map((o: { id: string }) => o.id)).not.toContain(own.body.id);
  });
});

describe('factory-shared rows (carrierId = null, P2-5)', () => {
  let sharedLoc: string;
  let sharedCond: string;
  let sharedCargo: string;

  beforeAll(async () => {
    sharedLoc = (await t.prisma.loadingLocation.create({ data: { tenantId: w.fx.tenantId, carrierId: null, warehouseType: 'کارخانه', name: 'انبار کارخانه' } })).id;
    sharedCond = (await t.prisma.loadingCondition.create({ data: { tenantId: w.fx.tenantId, carrierId: null, condition: 'شرط کارخانه' } })).id;
    sharedCargo = (await t.prisma.cargoDescription.create({ data: { tenantId: w.fx.tenantId, carrierId: null, text: 'شرح کارخانه' } })).id;
  });

  it('are visible to every carrier of the tenant, flagged shared', async () => {
    for (const s of [A(), B()]) {
      const res = await s.get('/carrier/master/loading-locations?pageSize=200');
      const row = res.body.items.find((r: { id: string }) => r.id === sharedLoc);
      expect(row).toMatchObject({ shared: true, name: 'انبار کارخانه' });
    }
    expect((await A().get(`/carrier/master/loading-conditions/${sharedCond}`)).body.shared).toBe(true);
  });

  it('are read-only: update/delete → 403 and the row is unchanged', async () => {
    const put = await A().put(`/carrier/master/loading-locations/${sharedLoc}`, samples['loading-locations']());
    expect(put.status).toBe(403);
    expect((await A().del(`/carrier/master/loading-conditions/${sharedCond}`)).status).toBe(403);
    expect((await B().put(`/carrier/master/cargo-descriptions/${sharedCargo}`, { text: 'هک' })).status).toBe(403);
    const loc = await t.prisma.loadingLocation.findUniqueOrThrow({ where: { id: sharedLoc } });
    expect(loc).toMatchObject({ name: 'انبار کارخانه', deletedAt: null, carrierId: null });
    expect((await t.prisma.cargoDescription.findUniqueOrThrow({ where: { id: sharedCargo } })).text).toBe('شرح کارخانه');
  });

  it('shared rows of ANOTHER tenant are invisible (404)', async () => {
    const otherTenant = await t.prisma.tenant.create({ data: { name: `other-${Date.now()}` } });
    try {
      const foreign = await t.prisma.cargoDescription.create({ data: { tenantId: otherTenant.id, carrierId: null, text: 'بیگانه' } });
      expect((await A().get(`/carrier/master/cargo-descriptions/${foreign.id}`)).status).toBe(404);
      expect((await A().put(`/carrier/master/cargo-descriptions/${foreign.id}`, { text: 'x' })).status).toBe(404);
    } finally {
      await t.prisma.cargoDescription.deleteMany({ where: { tenantId: otherTenant.id } });
      await t.prisma.tenant.delete({ where: { id: otherTenant.id } });
    }
  });
});

describe('party national id', () => {
  it('stores a valid 11-digit legal id', async () => {
    const res = await A().post('/carrier/master/parties', { ...samples.parties(), nationalId: '10101010101' });
    expect(res.status).toBe(201);
    const got = await A().get(`/carrier/master/parties/${res.body.id}`);
    expect(got.body.nationalId).toBe('10101010101');
  });
});
