import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jalaliYearMonth } from '@cb/shared';
import { createTestApp, freshIp, type TestApp } from './helpers/app';
import { createFactoryWorld, loginAs, type FactoryWorld } from './helpers/factory-helpers';
import { login, PASSWORD } from './helpers/fixtures';

let t: TestApp;
let w: FactoryWorld;
const code = () => String(Math.floor(Math.random() * 1e9));
const uname = () => `op_${randomBytes(4).toString('hex')}`;

beforeAll(async () => {
  t = await createTestApp();
  w = await createFactoryWorld(t);
});

afterAll(async () => {
  await w?.dispose();
  await t?.close();
});

describe('factory carriers CRUD', () => {
  it('lists the tenant carriers only, with counts', async () => {
    const res = await w.factory.get('/api/factory/carriers?f_status=ACTIVE');
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { id: string }) => r.id)).toEqual([w.a.carrierId]);
    expect(res.body.items[0]).toMatchObject({ operators: 1, drivers: 1, rowNo: 1 });
  });

  it('rejects unknown list params (scope smuggling) with 400', async () => {
    const res = await w.factory.get(`/api/factory/carriers?tenantId=${w.b.tenantId}`);
    expect(res.status).toBe(400);
  });

  it('exports xlsx', async () => {
    const res = await w.factory.get('/api/factory/carriers?format=xlsx').buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('creates a carrier (201) and audits it; duplicate code → 409; invalid → 400', async () => {
    const c = code();
    const res = await w.factory.post('/api/factory/carriers', { code: c, name: 'باربری نو', phone: '071-1234' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: c, status: 'ACTIVE' });
    const audit = await t.prisma.auditLog.findFirst({ where: { entityId: res.body.id, action: 'carrier.created' } });
    expect(audit?.tenantId).toBe(w.a.tenantId);

    expect((await w.factory.post('/api/factory/carriers', { code: c, name: 'دوباره' })).status).toBe(409);
    expect((await w.factory.post('/api/factory/carriers', { code: 'abc', name: 'x' })).status).toBe(400);
    expect((await w.factory.post('/api/factory/carriers', { code: code(), name: 'x', tenantId: w.b.tenantId })).status).toBe(400);
  });

  it('detail + patch; another tenant gets 404 (IDOR); malformed id → 404', async () => {
    const d = await w.factory.get(`/api/factory/carriers/${w.a.carrierId}`);
    expect(d.status).toBe(200);
    expect(d.body.operators).toHaveLength(1);
    expect(d.body.driversCount).toBe(1);

    const p = await w.factory.patch(`/api/factory/carriers/${w.a.carrierId}`, { phone: '0712222' });
    expect(p.status).toBe(200);
    expect(p.body.phone).toBe('0712222');
    expect(p.body.status).toBe('ACTIVE');

    expect((await w.otherFactory.get(`/api/factory/carriers/${w.a.carrierId}`)).status).toBe(404);
    expect((await w.otherFactory.patch(`/api/factory/carriers/${w.a.carrierId}`, { name: 'hijack' })).status).toBe(404);
    expect((await w.factory.get('/api/factory/carriers/not-a-uuid')).status).toBe(404);
    expect((await w.factory.patch(`/api/factory/carriers/${w.a.carrierId}`, {})).status).toBe(400);
  });

  it('D11: suspension blocks only operators (live session revoked, login refused); drivers still log in', async () => {
    const op = await loginAs(w.server, w.a.carrierOp.username);
    expect((await op.get('/api/auth/me')).status).toBe(200);

    const s = await w.factory.patch(`/api/factory/carriers/${w.a.carrierId}`, { status: 'SUSPENDED' });
    expect(s.status).toBe(200);
    expect(s.body.status).toBe('SUSPENDED');
    expect((await op.get('/api/auth/me')).status).toBe(401);
    const again = await login(w.server, w.a.carrierOp.username, PASSWORD, freshIp());
    expect(again.res.status).toBe(403);
    expect(again.res.body.error.code).toBe('ACCOUNT_DISABLED');
    expect((await login(w.server, w.a.driver.mobile, PASSWORD, freshIp())).res.status).toBe(200);
    expect(await t.prisma.auditLog.count({ where: { entityId: w.a.carrierId, action: 'carrier.suspended' } })).toBe(1);

    const back = await w.factory.patch(`/api/factory/carriers/${w.a.carrierId}`, { status: 'ACTIVE' });
    expect(back.body.status).toBe('ACTIVE');
    expect((await login(w.server, w.a.carrierOp.username, PASSWORD, freshIp())).res.status).toBe(200);
  });

  it('delete: refused while the carrier has drivers (409); empty carrier is soft-deleted', async () => {
    const r = await w.factory.del(`/api/factory/carriers/${w.a.carrierId}`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INVALID_STATE');

    const c = await w.factory.post('/api/factory/carriers', { code: code(), name: 'موقت' });
    expect((await w.otherFactory.del(`/api/factory/carriers/${c.body.id}`)).status).toBe(404);
    expect((await w.factory.del(`/api/factory/carriers/${c.body.id}`)).status).toBe(204);
    expect((await w.factory.get(`/api/factory/carriers/${c.body.id}`)).status).toBe(404);
    expect((await t.prisma.carrier.findUnique({ where: { id: c.body.id } }))?.deletedAt).not.toBeNull();
  });
});

describe('factory carrier operators', () => {
  let carrierId: string;
  let userId: string;
  const username = uname();

  beforeAll(async () => {
    carrierId = (await w.factory.post('/api/factory/carriers', { code: code(), name: 'اپراتوردار' })).body.id;
  });

  it('creates an operator who must change the password; duplicate username → 409', async () => {
    const res = await w.factory.post(`/api/factory/carriers/${carrierId}/users`, { username, displayName: 'اپراتور یک', password: 'Initial@123' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ username, active: true, mustChangePassword: true });
    expect(res.body).not.toHaveProperty('passwordHash');
    userId = res.body.id;
    const me = await (await loginAs(w.server, username, 'Initial@123')).get('/api/auth/me');
    expect(me.body).toMatchObject({ role: 'CARRIER_OPERATOR', mustChangePassword: true, carrier: { id: carrierId } });

    const dup = await w.factory.post(`/api/factory/carriers/${carrierId}/users`, { username, displayName: 'x', password: 'Initial@123' });
    expect(dup.status).toBe(409);
    const weak = await w.factory.post(`/api/factory/carriers/${carrierId}/users`, { username: uname(), displayName: 'x', password: 'short' });
    expect(weak.status).toBe(400);
  });

  it('lists operators; another tenant cannot list or create (404)', async () => {
    const res = await w.factory.get(`/api/factory/carriers/${carrierId}/users`);
    expect(res.status).toBe(200);
    expect(res.body.map((u: { id: string }) => u.id)).toEqual([userId]);
    expect((await w.otherFactory.get(`/api/factory/carriers/${carrierId}/users`)).status).toBe(404);
    const evil = await w.otherFactory.post(`/api/factory/carriers/${carrierId}/users`, { username: uname(), displayName: 'x', password: 'Initial@123' });
    expect(evil.status).toBe(404);
  });

  it('reset password revokes live sessions and sets a temporary password', async () => {
    const op = await loginAs(w.server, username, 'Initial@123');
    const r = await w.factory.post(`/api/factory/carriers/${carrierId}/users/${userId}/reset-password`, { newPassword: 'Reset@1234' });
    expect(r.status).toBe(204);
    expect((await op.get('/api/auth/me')).status).toBe(401);
    expect((await login(w.server, username, 'Initial@123', freshIp())).res.status).toBe(401);
    expect((await login(w.server, username, 'Reset@1234', freshIp())).res.status).toBe(200);
    // user of another carrier through this carrier's path → 404
    const cross = await w.factory.post(`/api/factory/carriers/${carrierId}/users/${w.a.carrierOp.id}/reset-password`, { newPassword: 'Reset@1234' });
    expect(cross.status).toBe(404);
  });

  it('deactivate blocks login; activate restores it', async () => {
    const off = await w.factory.patch(`/api/factory/carriers/${carrierId}/users/${userId}/status`, { active: false });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);
    expect((await login(w.server, username, 'Reset@1234', freshIp())).res.body.error.code).toBe('ACCOUNT_DISABLED');
    const on = await w.factory.patch(`/api/factory/carriers/${carrierId}/users/${userId}/status`, { active: true });
    expect(on.body.active).toBe(true);
    expect((await w.otherFactory.patch(`/api/factory/carriers/${carrierId}/users/${userId}/status`, { active: false })).status).toBe(404);
    expect(await t.prisma.auditLog.count({ where: { entityId: userId, action: { startsWith: 'carrier_user.' } } })).toBeGreaterThanOrEqual(4);
  });
});

describe('factory carrier quotas (D12)', () => {
  it('lists the current month even without a row; upserts; past months are read-only', async () => {
    const current = jalaliYearMonth(t.clock.now());
    const list = await w.factory.get(`/api/factory/carriers/${w.a.carrierId}/quotas`);
    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({ yearMonth: current, tonnageLimitKg: null, usedKg: '0' });

    const put = await w.factory.put(`/api/factory/carriers/${w.a.carrierId}/quotas`, { yearMonth: current, tonnageLimitKg: 500_000 });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ yearMonth: current, tonnageLimitKg: '500000', usedKg: '0' });
    const upd = await w.factory.put(`/api/factory/carriers/${w.a.carrierId}/quotas`, { yearMonth: current, tonnageLimitKg: 600_000 });
    expect(upd.body.tonnageLimitKg).toBe('600000');
    expect(await t.prisma.carrierQuota.count({ where: { carrierId: w.a.carrierId } })).toBe(1);
    expect(await t.prisma.auditLog.count({ where: { tenantId: w.a.tenantId, action: { startsWith: 'carrier_quota.' } } })).toBe(2);

    const past = await w.factory.put(`/api/factory/carriers/${w.a.carrierId}/quotas`, { yearMonth: '1400-01', tonnageLimitKg: 1 });
    expect(past.status).toBe(409);
    expect((await w.factory.put(`/api/factory/carriers/${w.a.carrierId}/quotas`, { yearMonth: '1405-13', tonnageLimitKg: 1 })).status).toBe(400);
    expect((await w.factory.put(`/api/factory/carriers/${w.a.carrierId}/quotas`, { yearMonth: current, tonnageLimitKg: -1 })).status).toBe(400);
  });

  it('IDOR: another tenant cannot read or set the quota (404)', async () => {
    const current = jalaliYearMonth(t.clock.now());
    expect((await w.otherFactory.get(`/api/factory/carriers/${w.a.carrierId}/quotas`)).status).toBe(404);
    expect((await w.otherFactory.put(`/api/factory/carriers/${w.a.carrierId}/quotas`, { yearMonth: current, tonnageLimitKg: 1 })).status).toBe(404);
  });

  it('carrier operators cannot touch factory carrier endpoints (403)', async () => {
    const op = await loginAs(w.server, w.a.carrierOp.username); // earlier suspension revoked w.carrier
    const res = await op.put(`/api/factory/carriers/${w.a.carrierId}/quotas`, { yearMonth: '1499-01', tonnageLimitKg: 1 });
    expect(res.status).toBe(403);
    const anon = await request(w.server).get('/api/factory/carriers');
    expect(anon.status).toBe(401);
  });
});
