import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { as } from './helpers/carrier-login';
import { addPermit, addVehicle, createWorld, type World } from './helpers/carrier-world';

let t: TestApp;
let w: World;
const A = () => as(w.server, w.sessions.carrierA);
const B = () => as(w.server, w.sessions.carrierB);
const ids = (body: { items: { id: string }[] }) => body.items.map((r) => r.id);
const filesDir = () => resolve(process.env.UPLOAD_DIR || './uploads', 'daily-files');
const createdFiles: string[] = [];
/** supertest parser that keeps binary bodies as a Buffer. */
const binary = ((res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}) as unknown as Parameters<request.Test['parse']>[0];

beforeAll(async () => {
  t = await createTestApp();
  w = await createWorld(t);
  await addVehicle(t, w.fx.tenantId, w.fx.driver.id, w.fx.loaderTypeId);
});

afterAll(async () => {
  for (const f of createdFiles) await rm(f, { force: true });
  await w?.fx.dispose();
  await t?.close();
});

async function dailyFile(carrierId: string, opts: { onDisk?: boolean; fileKey?: string; name?: string } = {}) {
  const fileKey = opts.fileKey ?? randomUUID();
  const bytes = Buffer.from('PK\u0003\u0004 fake xlsx bytes');
  if (opts.onDisk !== false) {
    await mkdir(filesDir(), { recursive: true });
    const p = join(filesDir(), fileKey);
    await writeFile(p, bytes);
    createdFiles.push(p);
  }
  return t.prisma.dailyFile.create({
    data: {
      tenantId: w.fx.tenantId,
      carrierId,
      forDate: '2026-11-27',
      fileKey,
      originalName: opts.name ?? 'بار روزانه.xlsx',
      size: bytes.length,
      sha256: 'x',
      uploadedBy: w.fx.factory.id,
    },
  });
}

describe('/carrier/daily-files', () => {
  it('lists only own files', async () => {
    const own = await dailyFile(w.fx.carrierId);
    const other = await dailyFile(w.b.carrierId);
    const res = await A().get('/carrier/daily-files?pageSize=200');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toContain(own.id);
    expect(ids(res.body)).not.toContain(other.id);
    expect(res.body.items.find((r: { id: string }) => r.id === own.id)).toMatchObject({ seen: false, sizeKb: 1, forDate: '2026-11-27' });
  });

  it('download streams the bytes with safe headers and marks seen once', async () => {
    const f = await dailyFile(w.fx.carrierId);
    const res = await A().get(`/carrier/daily-files/${f.id}/download`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="daily-file\.xlsx"; filename\*=UTF-8''/);
    expect(decodeURIComponent(String(res.headers['content-disposition']).split("UTF-8''")[1]!)).toBe('بار روزانه.xlsx');
    expect(Buffer.from(res.body as Buffer).toString()).toContain('fake xlsx bytes');

    const seen1 = await t.prisma.dailyFile.findUniqueOrThrow({ where: { id: f.id } });
    expect(seen1.seenAt).not.toBeNull();
    expect(seen1.seenBy).toBe(w.fx.carrierOp.id);

    t.clock.advance(60_000);
    expect((await A().get(`/carrier/daily-files/${f.id}/download`)).status).toBe(200);
    const seen2 = await t.prisma.dailyFile.findUniqueOrThrow({ where: { id: f.id } });
    expect(seen2.seenAt?.toISOString()).toBe(seen1.seenAt?.toISOString());
    expect(await t.prisma.auditLog.count({ where: { entityId: f.id, action: 'dailyFile.seen' } })).toBe(1);
    const list = await A().get('/carrier/daily-files?f_forDate=2026-11-27&pageSize=200');
    expect(list.body.items.find((r: { id: string }) => r.id === f.id).seen).toBe(true);
  });

  it('IDOR: carrier B cannot download A\'s file (404) and it stays unseen', async () => {
    const f = await dailyFile(w.fx.carrierId);
    expect((await B().get(`/carrier/daily-files/${f.id}/download`)).status).toBe(404);
    expect((await t.prisma.dailyFile.findUniqueOrThrow({ where: { id: f.id } })).seenAt).toBeNull();
  });

  it('path safety: a non-UUID fileKey is never resolved (404), missing bytes → 404 and not seen', async () => {
    const evil = await dailyFile(w.fx.carrierId, { onDisk: false, fileKey: `../../${randomUUID()}` });
    expect((await A().get(`/carrier/daily-files/${evil.id}/download`)).status).toBe(404);
    const missing = await dailyFile(w.fx.carrierId, { onDisk: false });
    expect((await A().get(`/carrier/daily-files/${missing.id}/download`)).status).toBe(404);
    expect((await t.prisma.dailyFile.findUniqueOrThrow({ where: { id: missing.id } })).seenAt).toBeNull();
    expect((await A().get('/carrier/daily-files/..%2F..%2Fetc/download')).status).toBe(404);
  });

  it('DRIVER / FACTORY cannot download (403)', async () => {
    const f = await dailyFile(w.fx.carrierId);
    expect((await as(w.server, w.sessions.driver).get(`/carrier/daily-files/${f.id}/download`)).status).toBe(403);
    expect((await as(w.server, w.sessions.factory).get(`/carrier/daily-files/${f.id}/download`)).status).toBe(403);
  });
});

describe('/carrier/permits', () => {
  const permit = (o: Partial<Parameters<typeof addPermit>[1]> = {}) =>
    addPermit(t, { tenantId: w.fx.tenantId, carrierId: w.fx.carrierId, driverId: w.fx.driver.id, loaderTypeId: w.fx.loaderTypeId, ...o });

  it('lists own permits with the permit column config; view=active|archived', async () => {
    const active = await permit();
    const archived = await permit({ status: 'EXITED' });
    const foreign = await addPermit(t, { tenantId: w.fx.tenantId, carrierId: w.b.carrierId, driverId: w.b.driverId, loaderTypeId: w.fx.loaderTypeId });

    const all = await A().get('/carrier/permits?pageSize=200');
    expect(all.status).toBe(200);
    expect(ids(all.body)).toEqual(expect.arrayContaining([active.id, archived.id]));
    expect(ids(all.body)).not.toContain(foreign.id);
    const row = all.body.items.find((r: { id: string }) => r.id === active.id);
    expect(row).toMatchObject({
      permitNo: active.permitNo,
      status: 'RESERVED',
      hall: expect.stringContaining('سالن'),
      product: 'سیمان تیپ ۲',
      loaderGroup: 'بنکر',
      loaderType: 'بنکر',
      driverName: 'راننده آزمون',
      fareRate: '50000000',
      announcedWeight: 25_000,
      havalehNo: null,
    });
    expect(row.plate).toMatch(/^\d{2}ع\d{3}-\d{2}$/);
    expect(row.plateSeries).toBe(row.plate.slice(-2));

    expect(ids((await A().get('/carrier/permits?view=active&pageSize=200')).body)).not.toContain(archived.id);
    expect(ids((await A().get('/carrier/permits?view=archived&pageSize=200')).body)).toEqual([archived.id]);
    expect((await A().get('/carrier/permits?view=bogus')).status).toBe(400);
    expect(ids((await A().get(`/carrier/permits?q=${active.permitNo}`)).body)).toEqual([active.id]);
    expect(ids((await A().get(`/carrier/permits?f_permitNo=${archived.permitNo}`)).body)).toEqual([archived.id]);
    expect((await A().get('/carrier/permits?sort=announcementNo:desc')).status).toBe(200);
    expect((await A().get('/carrier/permits?sort=driverName:asc')).status).toBe(400);
  });

  it('xlsx export honours cols', async () => {
    await permit();
    const res = await A().get('/carrier/permits?format=xlsx&cols=permitNo,driverName,status').buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('permits.xlsx');
    expect((await A().get('/carrier/permits?format=xlsx&cols=nope')).status).toBe(400);
  });

  it('full lifecycle arrive → load → exit with timestamps, audit and queue events', async () => {
    const p = await permit();
    const r1 = await A().post(`/carrier/permits/${p.id}/arrive`, { note: 'ورود' });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ from: 'RESERVED', status: 'ARRIVED' });
    expect((await A().post(`/carrier/permits/${p.id}/load`)).body.status).toBe('LOADED');
    expect((await A().post(`/carrier/permits/${p.id}/exit`)).body.status).toBe('EXITED');
    const row = await t.prisma.reservation.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.status).toBe('EXITED');
    expect(row.arrivedAt && row.loadedAt && row.exitedAt).toBeTruthy();
    expect(await t.prisma.auditLog.count({ where: { entityId: p.id, action: { startsWith: 'permit.' } } })).toBe(3);
    const events = await t.prisma.queueEvent.findMany({ where: { tenantId: w.fx.tenantId, type: { startsWith: 'PERMIT_' } }, orderBy: { seq: 'asc' } });
    expect(events.filter((e) => (e.payload as { reservationId: string }).reservationId === p.id).map((e) => e.type)).toEqual([
      'PERMIT_ARRIVED',
      'PERMIT_LOADED',
      'PERMIT_EXITED',
    ]);
  });

  it('no-show from RESERVED; return from LOADED requires a reason', async () => {
    const ns = await permit();
    expect((await A().post(`/carrier/permits/${ns.id}/no-show`)).body.status).toBe('NO_SHOW');
    const rt = await permit({ status: 'LOADED' });
    expect((await A().post(`/carrier/permits/${rt.id}/return`, {})).status).toBe(400);
    const ok = await A().post(`/carrier/permits/${rt.id}/return`, { reason: 'خرابی بارگیر' });
    expect(ok.body.status).toBe('RETURNED');
    expect((await t.prisma.reservation.findUniqueOrThrow({ where: { id: rt.id } })).returnReason).toBe('خرابی بارگیر');
  });

  it('illegal transitions → 409 INVALID_STATE and nothing changes', async () => {
    const p = await permit();
    for (const action of ['load', 'exit', 'return']) {
      const res = await A().post(`/carrier/permits/${p.id}/${action}`, action === 'return' ? { reason: 'x' } : {});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
    }
    const cr = await permit({ status: 'CANCEL_REQUESTED' });
    expect((await A().post(`/carrier/permits/${cr.id}/arrive`)).status).toBe(409);
    const done = await permit({ status: 'EXITED' });
    expect((await A().post(`/carrier/permits/${done.id}/no-show`)).status).toBe(409);
    expect((await t.prisma.reservation.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('RESERVED');
  });

  it('concurrent duplicate arrive: exactly one wins', async () => {
    const p = await permit();
    const results = await Promise.all([1, 2, 3, 4].map(() => A().post(`/carrier/permits/${p.id}/arrive`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await t.prisma.auditLog.count({ where: { entityId: p.id, action: 'permit.arrive' } })).toBe(1);
  });

  it('unknown action → 404; unknown body key → 400', async () => {
    const p = await permit();
    expect((await A().post(`/carrier/permits/${p.id}/cancel`)).status).toBe(404);
    expect((await A().post(`/carrier/permits/${p.id}/arrive`, { status: 'EXITED' })).status).toBe(400);
  });

  it('IDOR: carrier B cannot see or act on A\'s permit (404); the driver\'s carrier is irrelevant', async () => {
    const p = await permit();
    expect(ids((await B().get('/carrier/permits?pageSize=200')).body)).not.toContain(p.id);
    expect((await B().post(`/carrier/permits/${p.id}/arrive`)).status).toBe(404);
    // A load owned by B, taken by A's driver: only B may act on it (owner of the load, PRD §5.5).
    const crossed = await addPermit(t, { tenantId: w.fx.tenantId, carrierId: w.b.carrierId, driverId: w.fx.driver.id, loaderTypeId: w.fx.loaderTypeId });
    expect((await A().post(`/carrier/permits/${crossed.id}/arrive`)).status).toBe(404);
    expect((await B().post(`/carrier/permits/${crossed.id}/arrive`)).status).toBe(200);
    expect((await t.prisma.reservation.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('RESERVED');
  });

  it('DRIVER / FACTORY → 403 on permit actions', async () => {
    const p = await permit();
    expect((await as(w.server, w.sessions.driver).post(`/carrier/permits/${p.id}/arrive`)).status).toBe(403);
    expect((await as(w.server, w.sessions.factory).post(`/carrier/permits/${p.id}/arrive`)).status).toBe(403);
  });
});
