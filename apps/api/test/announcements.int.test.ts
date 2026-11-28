import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANNOUNCEMENT_COLUMNS, type AnnouncementDetailDto } from '@cb/shared';
import { QuotaService } from '../src/common/quota/quota.service';
import { createTestApp, type TestApp } from './helpers/app';
import { annInput, createAnnFixture, loginClient, type AnnFixture, type Client } from './helpers/announcements-fixtures';

let t: TestApp;
let fx: AnnFixture;
let server: Server;
let carrier: Client;
let carrierB: Client;
let factory: Client;
let driver: Client;
let quota: QuotaService;

beforeAll(async () => {
  t = await createTestApp();
  fx = await createAnnFixture(t);
  server = t.app.getHttpServer() as Server;
  quota = t.app.get(QuotaService);
  carrier = await loginClient(server, fx.carrierOp.username);
  carrierB = await loginClient(server, fx.carrierB.username);
  factory = await loginClient(server, fx.factory.username);
  driver = await loginClient(server, fx.driver.mobile);
});

afterAll(async () => {
  await fx?.dispose();
  await t?.close();
});

async function create(o: Parameters<typeof annInput>[1] = {}, c: Client = carrier): Promise<AnnouncementDetailDto> {
  const res = await c.post('/carrier/announcements', annInput(fx, o));
  if (res.status !== 201) throw new Error(`create failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as AnnouncementDetailDto;
}

describe('create (US-B3)', () => {
  it('creates N OPEN units atomically with the hall default allocation, number and audit', async () => {
    const res = await carrier.post('/carrier/announcements', annInput(fx, { truckCount: 4 }));
    expect(res.status).toBe(201);
    const a = res.body as AnnouncementDetailDto;
    expect(a.status).toBe('ACTIVE');
    expect(a.units).toHaveLength(4);
    expect(a.units.map((u) => u.seq)).toEqual([1, 2, 3, 4]);
    expect(a.units.every((u) => u.state === 'OPEN' && u.allocation === 'TIMED')).toBe(true);
    expect(a.baseAllocation).toBe('TIMED');
    expect(a.quotaKg).toBe(String(4 * 28_000));
    // sender filled from the party; national id encrypted at rest
    expect(a.form.senderName).toBe('فرستنده آزمون');
    expect(a.form.senderNationalId).toBe(fx.partyNationalId);
    expect(a.form.senderAddress).toBe('نشانی فرستنده');
    const row = await t.prisma.announcement.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.senderNationalIdEnc).not.toContain(fx.partyNationalId);
    expect(row.carrierId).toBe(fx.carrierId);
    expect(row.destCityId).toBe(fx.cityId);
    expect(await t.prisma.loadUnit.count({ where: { announcementId: a.id } })).toBe(4);
    const audit = await t.prisma.auditLog.findFirst({ where: { entityId: a.id, action: 'announcement.create' } });
    expect(audit?.actorId).toBe(fx.carrierOp.id);
    const b = await create();
    expect(b.number).toBe(a.number + 1);
  });

  it('BULK hall defaults to GROUP; FREE may be chosen; BR-11 flag forces FREE', async () => {
    const bulk = { hallId: fx.bulkHallId, packagingTypeId: fx.bulkPackagingId, truckCount: 2 };
    expect((await create(bulk)).units.every((u) => u.allocation === 'GROUP')).toBe(true);
    expect((await create({ ...bulk, allocation: 'FREE' })).units.every((u) => u.allocation === 'FREE')).toBe(true);
    const free = await create({ ...bulk, allocation: 'GROUP', isFreeOutsideDestinations: true, destinationId: undefined });
    expect(free.units.every((u) => u.allocation === 'FREE')).toBe(true);
  });

  it('rejects an allocation that does not fit the hall category, and mismatched packaging', async () => {
    const r1 = await carrier.post('/carrier/announcements', annInput(fx, { allocation: 'GROUP' }));
    expect(r1.status).toBe(400);
    expect(r1.body.error.details.issues[0].path).toBe('allocation');
    const r2 = await carrier.post('/carrier/announcements', annInput(fx, { packagingTypeId: fx.bulkPackagingId }));
    expect(r2.status).toBe(400);
  });

  it.each([
    ['scope smuggling (tenantId/carrierId in body)', { carrierId: randomUUID() }],
    ['weight from > to', { weightFromKg: 30_000, weightToKg: 20_000 }],
    ['missing fare for PER_TON', { fareCalc: 'PER_TON', farePerTruck: undefined }],
    ['truckCount 0', { truckCount: 0 }],
    ['past date', { announceDate: '2020-01-01' }],
  ])('400 on %s', async (_why, o) => {
    const res = await carrier.post('/carrier/announcements', { ...annInput(fx), ...o });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('master data: own and shared rows are accepted; foreign, inactive and unknown rows are rejected', async () => {
    expect((await create({ loadingLocationId: fx.sharedLoadingLocationId })).id).toBeTruthy();
    for (const [o, path] of [
      [{ loadingLocationId: fx.carrierB.loadingLocationId }, 'loadingLocationId'],
      [{ senderPartyId: fx.carrierB.partyId }, 'senderPartyId'],
      [{ productId: fx.inactiveProductId }, 'productId'],
      [{ hallId: randomUUID() }, 'hallId'],
      [{ loaderTypeId: randomUUID() }, 'loaderTypeId'],
    ] as const) {
      const res = await carrier.post('/carrier/announcements', annInput(fx, o));
      expect(res.status, path).toBe(400);
      expect((res.body.error.details.issues as { path: string }[]).map((i) => i.path)).toContain(path);
    }
  });

  it('Idempotency-Key: a repeated create returns the same announcement', async () => {
    const key = `k-${randomUUID()}`;
    const body = annInput(fx, { truckCount: 1, description: `idem ${key}` });
    const r1 = await carrier.post('/carrier/announcements', body).set('Idempotency-Key', key);
    const r2 = await carrier.post('/carrier/announcements', body).set('Idempotency-Key', key);
    expect(r1.status).toBe(201);
    expect(r2.body.id).toBe(r1.body.id);
    expect(await t.prisma.announcement.count({ where: { tenantId: fx.tenantId, description: `idem ${key}` } })).toBe(1);
  });
});

describe('quota (BR-08 / AC-11 / D12)', () => {
  it('QUOTA_NOT_SET when the month of announceDate has no quota', async () => {
    const res = await carrier.post('/carrier/announcements', annInput(fx, { announceDate: fx.noQuotaDate }));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('QUOTA_NOT_SET');
  });

  it('accepts an exact fit, rejects over-quota with QUOTA_EXCEEDED and creates no units', async () => {
    // tight month: 100 t
    const ok = await create({ announceDate: fx.tightDate, truckCount: 2, weightToKg: 30_000 }); // 60 t
    expect(ok.units).toHaveLength(2);
    const before = await t.prisma.loadUnit.count({ where: { tenantId: fx.tenantId } });
    const over = await carrier.post('/carrier/announcements', annInput(fx, { announceDate: fx.tightDate, truckCount: 2, weightFromKg: 10_000, weightToKg: 20_001 }));
    expect(over.status).toBe(403);
    expect(over.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(await t.prisma.loadUnit.count({ where: { tenantId: fx.tenantId } })).toBe(before);
    const fit = await create({ announceDate: fx.tightDate, truckCount: 2, weightFromKg: 10_000, weightToKg: 20_000 }); // 40 t → exactly 100 t
    expect(fit.status).toBe('ACTIVE');
    const ym = (await t.prisma.carrierQuota.findFirstOrThrow({ where: { carrierId: fx.carrierId, tonnageLimitKg: 100_000n } })).yearMonth;
    expect((await quota.usage(fx.tenantId, fx.carrierId, ym)).usedKg).toBe(100_000n);
    // edit growth beyond the limit is rejected; cancel releases the quota
    const grow = await carrier.put(`/carrier/announcements/${fit.id}`, { ...fit.form, truckCount: 3 });
    expect(grow.body.error?.code).toBe('QUOTA_EXCEEDED');
    expect((await carrier.post(`/carrier/announcements/${ok.id}/cancel`, { reason: 'آزادسازی سهمیه' })).status).toBe(200);
    expect((await quota.usage(fx.tenantId, fx.carrierId, ym)).usedKg).toBe(40_000n);
    const grown = await carrier.put(`/carrier/announcements/${fit.id}`, { ...fit.form, truckCount: 3 });
    expect(grown.status).toBe(200);
    expect(grown.body.units.filter((u: { state: string }) => u.state === 'OPEN')).toHaveLength(3);
  });
});

describe('list / get / export', () => {
  it('carrier list is scoped to the session carrier and has every configured column', async () => {
    const mine = await create({ truckCount: 2 });
    const theirs = await create({ loadingLocationId: fx.carrierB.loadingLocationId, senderPartyId: undefined, goodsOwnerId: undefined }, carrierB);
    const res = await carrier.get('/carrier/announcements?pageSize=200');
    expect(res.status).toBe(200);
    const ids = (res.body.items as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    const row = (res.body.items as Record<string, unknown>[]).find((r) => r.id === mine.id)!;
    for (const c of ANNOUNCEMENT_COLUMNS) expect(row, c.id).toHaveProperty(c.id);
    expect(row).toMatchObject({ hall: 'سالن کیسه‌ای', remaining: 2, permitsIssued: 0, absorption: 'جذب نشده', product: 'سیمان تیپ ۲' });
    expect(row.originCity).toBe('شهر آزمون');
    expect(row.cargoValue).toBe('1500000000');
  });

  it('filters, sorts, searches, views and summary', async () => {
    const big = await create({ truckCount: 7 });
    const f = await carrier.get('/carrier/announcements?f_truckCount=7&sort=number:desc');
    expect(f.status).toBe(200);
    expect((f.body.items as { id: string }[]).map((r) => r.id)).toContain(big.id);
    expect((f.body.items as { truckCount: number }[]).every((r) => r.truckCount === 7)).toBe(true);
    const q = await carrier.get(`/carrier/announcements?q=${big.number}`);
    expect((q.body.items as { id: string }[]).map((r) => r.id)).toContain(big.id);
    expect((await carrier.get('/carrier/announcements?sort=hall:asc')).status).toBe(400);
    expect((await carrier.get('/carrier/announcements?view=nope')).status).toBe(400);
    const sum = await carrier.get('/carrier/announcements/summary?view=active');
    expect(sum.status).toBe(200);
    expect(sum.body.remaining).toBeGreaterThanOrEqual(7);
  });

  it('exports xlsx with the requested columns', async () => {
    const res = await carrier
      .get('/carrier/announcements?format=xlsx&cols=number,hall,truckCount')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    expect(wb.worksheets[0]!.getRow(1).getCell(2).value).toBe('سالن اعلام بار');
  });

  it('get: 200 for the owner, 404 for another carrier and for malformed ids', async () => {
    const a = await create();
    expect((await carrier.get(`/carrier/announcements/${a.id}`)).status).toBe(200);
    const foreign = await carrierB.get(`/carrier/announcements/${a.id}`);
    expect(foreign.status).toBe(404);
    expect((await carrier.get('/carrier/announcements/not-a-uuid')).status).toBe(404);
  });

  it('lookups list own + shared master data only', async () => {
    const res = await carrier.get('/carrier/announcements/lookups');
    expect(res.status).toBe(200);
    const locIds = (res.body.loadingLocations as { id: string }[]).map((l) => l.id);
    expect(locIds).toEqual(expect.arrayContaining([fx.loadingLocationId, fx.sharedLoadingLocationId]));
    expect(locIds).not.toContain(fx.carrierB.loadingLocationId);
    expect((res.body.parties as { id: string }[]).map((p) => p.id)).not.toContain(fx.carrierB.partyId);
    expect((res.body.products as { id: string }[]).map((p) => p.id)).not.toContain(fx.inactiveProductId);
    expect(res.body.today).toBe(fx.today);
  });

  it('factory sees every carrier of the tenant (read-only)', async () => {
    const a = await create();
    const b = await create({ loadingLocationId: fx.carrierB.loadingLocationId, senderPartyId: undefined, goodsOwnerId: undefined }, carrierB);
    const res = await factory.get('/factory/announcements?pageSize=200');
    expect(res.status).toBe(200);
    const ids = (res.body.items as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
    expect((await factory.get(`/factory/announcements/${b.id}`)).status).toBe(200);
    expect((await factory.get('/factory/announcements/summary')).status).toBe(200);
  });
});

describe('edit', () => {
  it('updates fields, grows and shrinks OPEN units, keeps hall immutable', async () => {
    const a = await create({ truckCount: 3 });
    const up = await carrier.put(`/carrier/announcements/${a.id}`, { ...a.form, truckCount: 5, description: 'ویرایش شد' });
    expect(up.status).toBe(200);
    expect(up.body.form.description).toBe('ویرایش شد');
    expect(up.body.counts.open).toBe(5);
    expect((up.body.units as { seq: number }[]).map((u) => u.seq)).toEqual([1, 2, 3, 4, 5]);
    const down = await carrier.put(`/carrier/announcements/${a.id}`, { ...a.form, truckCount: 2 });
    expect(down.status).toBe(200);
    expect(down.body.counts).toMatchObject({ total: 2, open: 2, cancelled: 3 });
    expect((await t.prisma.announcement.findUniqueOrThrow({ where: { id: a.id } })).truckCount).toBe(2);
    const hall = await carrier.put(`/carrier/announcements/${a.id}`, { ...a.form, hallId: fx.bulkHallId });
    expect(hall.status).toBe(400);
    const alloc = await carrier.put(`/carrier/announcements/${a.id}`, { ...a.form, allocation: 'FREE' });
    expect(alloc.status).toBe(400);
    expect(await t.prisma.auditLog.count({ where: { entityId: a.id, action: 'announcement.update' } })).toBe(2);
  });

  it('is blocked once a unit is reserved, and for another carrier (404)', async () => {
    const a = await create({ truckCount: 2 });
    expect((await carrierB.put(`/carrier/announcements/${a.id}`, a.form)).status).toBe(404);
    await t.prisma.loadUnit.update({ where: { id: a.units[0]!.id }, data: { state: 'RESERVED' } });
    const res = await carrier.put(`/carrier/announcements/${a.id}`, { ...a.form, description: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_ACTIVE_RESERVATIONS');
    const detail = await carrier.get(`/carrier/announcements/${a.id}`);
    expect(detail.body).toMatchObject({ editable: false, editBlockedReason: 'HAS_RESERVATIONS', cancellable: false });
    const cancel = await carrier.post(`/carrier/announcements/${a.id}/cancel`, { reason: 'تست' });
    expect(cancel.status).toBe(409);
  });
});

describe('copy', () => {
  it('body-less copy clones fields with today date, a new number and fresh units', async () => {
    const src = await create({ truckCount: 2, orderCode: 'ORD-1' });
    const res = await carrier.post(`/carrier/announcements/${src.id}/copy`);
    expect(res.status).toBe(201);
    const c = res.body as AnnouncementDetailDto;
    expect(c.id).not.toBe(src.id);
    expect(c.number).toBeGreaterThan(src.number);
    expect(c.form).toMatchObject({ orderCode: 'ORD-1', truckCount: 2, announceDate: fx.today, senderNationalId: fx.partyNationalId });
    expect(c.units.every((u) => u.state === 'OPEN')).toBe(true);
    expect(await t.prisma.auditLog.count({ where: { entityId: c.id, action: 'announcement.copy' } })).toBe(1);
  });

  it('copy with an edited body; foreign source → 404', async () => {
    const src = await create();
    const res = await carrier.post(`/carrier/announcements/${src.id}/copy`, { ...src.form, truckCount: 1 });
    expect(res.status).toBe(201);
    expect(res.body.units).toHaveLength(1);
    expect((await carrierB.post(`/carrier/announcements/${src.id}/copy`)).status).toBe(404);
  });
});

describe('cancel', () => {
  it('cancels with reason, cancels units, is idempotent and blocks later edits', async () => {
    const a = await create({ truckCount: 3 });
    expect((await carrier.post(`/carrier/announcements/${a.id}/cancel`, {})).status).toBe(400);
    expect((await carrierB.post(`/carrier/announcements/${a.id}/cancel`, { reason: 'x' })).status).toBe(404);
    const res = await carrier.post(`/carrier/announcements/${a.id}/cancel`, { reason: 'لغو مشتری' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'لغو مشتری', cancellable: false });
    expect(await t.prisma.loadUnit.count({ where: { announcementId: a.id, state: 'CANCELLED' } })).toBe(3);
    expect((await carrier.post(`/carrier/announcements/${a.id}/cancel`, { reason: 'دوباره' })).status).toBe(200);
    expect(await t.prisma.auditLog.count({ where: { entityId: a.id, action: 'announcement.cancel' } })).toBe(1);
    const edit = await carrier.put(`/carrier/announcements/${a.id}`, a.form);
    expect(edit.body.error.code).toBe('INVALID_STATE');
    const archived = await carrier.get('/carrier/announcements?view=archived&pageSize=200');
    expect((archived.body.items as { id: string }[]).map((r) => r.id)).toContain(a.id);
  });
});

describe('role matrix', () => {
  const carrierRoutes: [string, string][] = [
    ['get', '/carrier/announcements'],
    ['get', '/carrier/announcements/lookups'],
    ['post', '/carrier/announcements'],
  ];
  it('FACTORY and DRIVER get 403 on carrier routes; CARRIER and DRIVER get 403 on the factory list', async () => {
    for (const c of [factory, driver]) {
      for (const [m, p] of carrierRoutes) {
        const res = m === 'get' ? await c.get(p) : await c.post(p, annInput(fx));
        expect(res.status, `${m} ${p}`).toBe(403);
      }
    }
    expect((await carrier.get('/factory/announcements')).status).toBe(403);
    expect((await driver.get('/factory/announcements')).status).toBe(403);
    expect((await request(server).get('/api/carrier/announcements')).status).toBe(401);
  });
});
