import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAILY_FILE_MAX_BYTES, addDaysIso, localDate } from '@cb/shared';
import { createTestApp, freshIp, type TestApp } from './helpers/app';
import { createFactoryWorld, loginAs, type Client, type FactoryWorld } from './helpers/factory-helpers';
import { login, PASSWORD } from './helpers/fixtures';

let t: TestApp;
let w: FactoryWorld;
let xlsx: Buffer;
const uploadDir = mkdtempSync(join(tmpdir(), 'cb-factory-'));
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

beforeAll(async () => {
  process.env.UPLOAD_DIR = uploadDir;
  t = await createTestApp();
  w = await createFactoryWorld(t);
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('بار').addRow(['شماره', 1]);
  xlsx = Buffer.from(await wb.xlsx.writeBuffer());
});

afterAll(async () => {
  await w?.dispose();
  await t?.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

function upload(c: Client, fields: Record<string, string>, file?: { buf: Buffer; name: string; type?: string }) {
  let r = request(w.server).post('/api/factory/daily-files').set('Cookie', c.session.cookie).set('X-CSRF', c.session.csrf);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  if (file) r = r.attach('file', file.buf, { filename: file.name, contentType: file.type ?? XLSX_MIME });
  return r;
}

describe('factory drivers', () => {
  it('lists drivers of the tenant with carrier name and filters', async () => {
    const res = await w.factory.get('/api/factory/drivers?f_status=APPROVED&sort=lastName:asc');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ id: w.a.driver.id, mobile: w.a.driver.mobile, status: 'APPROVED' });
    expect((await w.factory.get('/api/factory/drivers?f_status=PENDING')).body.total).toBe(0);
    expect((await w.factory.get(`/api/factory/drivers?q=${w.a.driver.mobile}`)).body.total).toBe(1);
    expect((await w.factory.get('/api/factory/drivers?sort=plate:asc')).status).toBe(400);
    expect((await w.otherFactory.get('/api/factory/drivers')).body.items.map((r: { id: string }) => r.id)).not.toContain(w.a.driver.id);
  });

  it('blocks with reason + until (end of that local day), unblock restores the previous status', async () => {
    const until = addDaysIso(localDate(t.clock.now()), 3);
    const b = await w.factory.post(`/api/factory/drivers/${w.a.driver.id}/block`, { reason: 'تخلف', until });
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ status: 'BLOCKED', blockReason: 'تخلف' });
    expect(new Date(b.body.blockedUntil).toISOString()).toBe(new Date(`${addDaysIso(until, 1)}T00:00:00+03:30`).toISOString());
    const again = await w.factory.post(`/api/factory/drivers/${w.a.driver.id}/block`, { reason: 'تمدید' });
    expect(again.body).toMatchObject({ status: 'BLOCKED', blockedUntil: null, blockReason: 'تمدید' });

    const u = await w.factory.post(`/api/factory/drivers/${w.a.driver.id}/unblock`);
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ status: 'APPROVED', blockedUntil: null, blockReason: null });
    expect((await w.factory.post(`/api/factory/drivers/${w.a.driver.id}/unblock`)).status).toBe(409);
    expect(await t.prisma.auditLog.count({ where: { entityId: w.a.driver.id, action: { in: ['driver.blocked', 'driver.unblocked'] } } })).toBe(3);
  });

  it('rejects past until / missing reason (400), rejected drivers (409) and other tenants (404)', async () => {
    expect((await w.factory.post(`/api/factory/drivers/${w.a.driver.id}/block`, { reason: 'x', until: '2020-01-01' })).status).toBe(400);
    expect((await w.factory.post(`/api/factory/drivers/${w.a.driver.id}/block`, {})).status).toBe(400);
    expect((await w.otherFactory.post(`/api/factory/drivers/${w.a.driver.id}/block`, { reason: 'x' })).status).toBe(404);
    expect((await w.otherFactory.post(`/api/factory/drivers/${w.a.driver.id}/unblock`)).status).toBe(404);
    await t.prisma.driver.update({ where: { id: w.b.driver.id }, data: { status: 'REJECTED' } });
    expect((await w.otherFactory.post(`/api/factory/drivers/${w.b.driver.id}/block`, { reason: 'x' })).status).toBe(409);
  });
});

describe('factory daily files', () => {
  it('uploads a valid xlsx: random key on disk, sha256 + audit, Persian name kept', async () => {
    const res = await upload(w.factory, { carrierId: w.a.carrierId, forDate: '2026-11-28', note: 'بار فردا' }, { buf: xlsx, name: 'برنامه.xlsx' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ carrierId: w.a.carrierId, originalName: 'برنامه.xlsx', size: xlsx.length });
    const row = await t.prisma.dailyFile.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.fileKey).toMatch(/^[0-9a-f-]{36}$/);
    const onDisk = join(uploadDir, 'daily-files', row.fileKey);
    expect(existsSync(onDisk)).toBe(true);
    expect(readFileSync(onDisk).equals(xlsx)).toBe(true);
    expect(await t.prisma.auditLog.count({ where: { entityId: row.id, action: 'daily_file.uploaded' } })).toBe(1);
  });

  it('rejects non-xlsx content, wrong extension, missing file (FILE_INVALID) and oversize (FILE_TOO_LARGE)', async () => {
    const fields = { carrierId: w.a.carrierId, forDate: '2026-11-28' };
    const html = await upload(w.factory, fields, { buf: Buffer.from('<html></html>'), name: 'x.xlsx' });
    expect(html.status).toBe(400);
    expect(html.body.error.code).toBe('FILE_INVALID');
    expect((await upload(w.factory, fields, { buf: xlsx, name: 'x.exe' })).body.error.code).toBe('FILE_INVALID');
    expect((await upload(w.factory, fields)).body.error.code).toBe('FILE_INVALID');
    const big = await upload(w.factory, fields, { buf: Buffer.alloc(DAILY_FILE_MAX_BYTES + 1, 0x50), name: 'big.xlsx' });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('FILE_TOO_LARGE');
    expect((await upload(w.factory, { ...fields, evil: '1' }, { buf: xlsx, name: 'a.xlsx' })).status).toBe(400);
  });

  it('target carrier of another tenant → 404; nothing written', async () => {
    const before = await t.prisma.dailyFile.count({ where: { tenantId: w.b.tenantId } });
    const res = await upload(w.factory, { carrierId: w.b.carrierId, forDate: '2026-11-28' }, { buf: xlsx, name: 'a.xlsx' });
    expect(res.status).toBe(404);
    expect(await t.prisma.dailyFile.count({ where: { tenantId: w.b.tenantId } })).toBe(before);
  });

  it('lists files of the tenant only', async () => {
    const res = await w.factory.get('/api/factory/daily-files?f_forDate=2026-11-28');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ originalName: 'برنامه.xlsx', seenAt: null });
    expect((await w.otherFactory.get('/api/factory/daily-files')).body.total).toBe(0);
  });
});

describe('factory audit, sessions, dashboard', () => {
  it('audit list is tenant-scoped and filterable', async () => {
    const res = await w.factory.get('/api/factory/audit?f_action=driver.blocked');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0]).toMatchObject({ entity: 'Driver', actorRole: 'FACTORY_OPERATOR', actorName: 'کارخانه' });
    expect((await w.otherFactory.get(`/api/factory/audit?f_entityId=${w.a.driver.id}`)).body.total).toBe(0);
    expect((await w.factory.get('/api/factory/audit?f_actorRole=ROOT')).status).toBe(400);
  });

  it('lists active sessions and revokes one (the user is logged out); foreign session → 404', async () => {
    const op = await loginAs(w.server, w.a.carrierOp.username);
    const list = await w.factory.get('/api/factory/sessions?f_role=CARRIER_OPERATOR');
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    const otherSessions = await w.otherFactory.get('/api/factory/sessions');
    const foreign = otherSessions.body.items[0].id as string;
    expect((await w.factory.post(`/api/factory/sessions/${foreign}/revoke`)).status).toBe(404);
    expect((await w.factory.post(`/api/factory/sessions/${randomUUID()}/revoke`)).status).toBe(404);

    for (const s of list.body.items as { id: string }[]) {
      expect((await w.factory.post(`/api/factory/sessions/${s.id}/revoke`)).status).toBe(204);
    }
    expect((await op.get('/api/auth/me')).status).toBe(401);
    expect((await w.factory.get('/api/factory/sessions?f_role=CARRIER_OPERATOR')).body.total).toBe(0);
    expect(await t.prisma.auditLog.count({ where: { tenantId: w.a.tenantId, action: 'session.revoked_by_factory' } })).toBeGreaterThanOrEqual(1);
    w.carrier = await loginAs(w.server, w.a.carrierOp.username); // keep the role matrix below meaningful
  });

  it('dashboard summarises the tenant', async () => {
    const res = await w.factory.get('/api/factory/dashboard');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      today: localDate(t.clock.now()),
      carriers: { active: 1, suspended: 0 },
      drivers: { approved: 1, pending: 0, blocked: 0 },
      announcementsToday: 0,
      activeReservations: 0,
      carriersWithoutQuota: 1,
    });
    expect(res.body.hallsToday).toEqual([]);
    expect((await w.otherFactory.get('/api/factory/dashboard')).body.drivers).toMatchObject({ approved: 0 });
  });
});

describe('factory role matrix', () => {
  const id = randomUUID();
  const routes: [method: 'get' | 'post' | 'put' | 'patch' | 'del', path: string][] = [
    ['get', '/api/factory/dashboard'],
    ['get', '/api/factory/carriers'],
    ['get', '/api/factory/carriers/options'],
    ['post', '/api/factory/carriers'],
    ['get', `/api/factory/carriers/${id}`],
    ['patch', `/api/factory/carriers/${id}`],
    ['del', `/api/factory/carriers/${id}`],
    ['get', `/api/factory/carriers/${id}/users`],
    ['post', `/api/factory/carriers/${id}/users`],
    ['post', `/api/factory/carriers/${id}/users/${id}/reset-password`],
    ['patch', `/api/factory/carriers/${id}/users/${id}/status`],
    ['get', `/api/factory/carriers/${id}/quotas`],
    ['put', `/api/factory/carriers/${id}/quotas`],
    ['get', '/api/factory/halls'],
    ['post', '/api/factory/halls'],
    ['get', `/api/factory/halls/${id}`],
    ['patch', `/api/factory/halls/${id}`],
    ['put', `/api/factory/halls/${id}/schedules`],
    ['get', `/api/factory/halls/${id}/days`],
    ['post', `/api/factory/halls/${id}/days`],
    ['post', `/api/factory/halls/${id}/days/generate`],
    ['patch', `/api/factory/halls/${id}/days/${id}`],
    ['post', `/api/factory/halls/${id}/days/${id}/halt`],
    ['get', '/api/factory/destinations'],
    ['post', '/api/factory/destinations'],
    ['patch', `/api/factory/destinations/${id}`],
    ['get', '/api/factory/loader-types'],
    ['post', '/api/factory/loader-types'],
    ['patch', `/api/factory/loader-types/${id}`],
    ['get', '/api/factory/packaging-types'],
    ['post', '/api/factory/packaging-types'],
    ['patch', `/api/factory/packaging-types/${id}`],
    ['get', '/api/factory/products'],
    ['post', '/api/factory/products'],
    ['patch', `/api/factory/products/${id}`],
    ['get', '/api/factory/policies'],
    ['post', '/api/factory/policies'],
    ['get', '/api/factory/drivers'],
    ['post', `/api/factory/drivers/${id}/block`],
    ['post', `/api/factory/drivers/${id}/unblock`],
    ['get', '/api/factory/daily-files'],
    ['post', '/api/factory/daily-files'],
    ['get', '/api/factory/audit'],
    ['get', '/api/factory/sessions'],
    ['post', `/api/factory/sessions/${id}/revoke`],
  ];

  it('CARRIER_OPERATOR and DRIVER get 403 FORBIDDEN on every factory endpoint', async () => {
    const driver = await loginAs(w.server, w.a.driver.mobile);
    for (const who of [w.carrier, driver]) {
      for (const [m, p] of routes) {
        const res = await who[m](p);
        expect([m, p, res.status, res.body.error?.code]).toEqual([m, p, 403, 'FORBIDDEN']);
      }
    }
  });

  it('anonymous gets 401 and the factory operator is never 403', async () => {
    for (const [m, p] of routes.filter(([m]) => m === 'get')) {
      expect((await request(w.server)[m === 'get' ? 'get' : 'post'](p)).status).toBe(401);
      expect((await w.factory.get(p)).status).not.toBe(403);
    }
    expect((await login(w.server, w.a.factory.username, PASSWORD, freshIp())).res.status).toBe(200);
  });
});
