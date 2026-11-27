import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, freshIp, type TestApp } from './helpers/app';
import { createFixture, login, parseCookies, PASSWORD, sessionFrom, type Fixture } from './helpers/fixtures';

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

describe('POST /api/auth/login', () => {
  it('logs an operator in with HttpOnly SameSite=Strict cookies and returns MeResponse', async () => {
    const { res } = await login(server, fx.carrierOp.username, PASSWORD, freshIp());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: fx.carrierOp.id, role: 'CARRIER_OPERATOR', carrier: { id: fx.carrierId } });
    expect(res.headers['x-server-time']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const raw = res.headers['set-cookie'] as unknown as string[];
    const at = raw.find((c) => c.startsWith('at='))!;
    const rt = raw.find((c) => c.startsWith('rt='))!;
    const csrf = raw.find((c) => c.startsWith('csrf='))!;
    expect(at).toMatch(/HttpOnly/);
    expect(at).toMatch(/SameSite=Strict/);
    expect(rt).toMatch(/HttpOnly/);
    expect(csrf).not.toMatch(/HttpOnly/);
    const me = await request(server).get('/api/auth/me').set('Cookie', sessionFrom(raw).cookie);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe(fx.carrierOp.username);
  });

  it('logs a driver in by mobile in any accepted format', async () => {
    const intl = `+98${fx.driver.mobile.slice(1)}`;
    const { res } = await login(server, intl, PASSWORD, freshIp());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'DRIVER', driver: { id: fx.driver.id, status: 'APPROVED' } });
  });

  it('rejects a wrong password with INVALID_CREDENTIALS and no cookies', async () => {
    const { res } = await login(server, fx.factory.username, 'Wrong@12345', freshIp());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.headers['set-cookie']).toBeUndefined();
    await t.prisma.user.update({ where: { id: fx.factory.id }, data: { failedLogins: 0 } });
  });

  it('does not reveal whether a user exists', async () => {
    const unknown = await login(server, 'no_such_user_xyz', 'Wrong@12345', freshIp());
    const wrong = await login(server, fx.factory.username, 'Wrong@12345', freshIp());
    expect(unknown.res.status).toBe(wrong.res.status);
    expect(unknown.res.body).toEqual(wrong.res.body);
    await t.prisma.user.update({ where: { id: fx.factory.id }, data: { failedLogins: 0 } });
  });

  it('validates input (unknown keys rejected)', async () => {
    const res = await request(server)
      .post('/api/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ identifier: 'abc', password: 'x', tenantId: 'evil' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('locks the account after 5 failures (ACCOUNT_LOCKED), even for the right password', async () => {
    const ip1 = freshIp();
    for (let i = 0; i < 4; i += 1) {
      const { res } = await login(server, fx.carrierOp.username, 'Wrong@12345', ip1);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    const fifth = await login(server, fx.carrierOp.username, 'Wrong@12345', ip1);
    expect(fifth.res.status).toBe(423);
    expect(fifth.res.body.error.code).toBe('ACCOUNT_LOCKED');
    const right = await login(server, fx.carrierOp.username, PASSWORD, freshIp());
    expect(right.res.body.error.code).toBe('ACCOUNT_LOCKED');
    // lock expires after 15 minutes of server time
    t.clock.advance(16 * 60_000);
    const later = await login(server, fx.carrierOp.username, PASSWORD, freshIp());
    expect(later.res.status).toBe(200);
  });

  it('rate-limits login to 5/min per IP+identifier (RATE_LIMITED)', async () => {
    const ip = freshIp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      codes.push((await login(server, 'rate_limit_probe', 'Wrong@12345', ip)).res.status);
    }
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it('refuses a disabled user with ACCOUNT_DISABLED', async () => {
    await t.prisma.user.update({ where: { id: fx.factory.id }, data: { status: 'DISABLED' } });
    const { res } = await login(server, fx.factory.username, PASSWORD, freshIp());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    await t.prisma.user.update({ where: { id: fx.factory.id }, data: { status: 'ACTIVE' } });
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token; reusing the old one revokes the whole family', async () => {
    const { session } = await login(server, fx.factory.username, PASSWORD, freshIp());
    const r1 = await request(server).post('/api/auth/refresh').set('Cookie', session.cookie);
    expect(r1.status).toBe(204);
    const rotated = sessionFrom(r1.headers['set-cookie']);
    expect(parseCookies(r1.headers['set-cookie']).rt).not.toBe(parseCookies(session.raw).rt);

    const meAfterRotate = await request(server).get('/api/auth/me').set('Cookie', rotated.cookie);
    expect(meAfterRotate.status).toBe(200);

    // replay the original (already rotated) refresh token → reuse detected
    const reuse = await request(server).post('/api/auth/refresh').set('Cookie', session.cookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('SESSION_REVOKED');

    // the legitimate new token is now dead too (family revoked)
    const r2 = await request(server).post('/api/auth/refresh').set('Cookie', rotated.cookie);
    expect(r2.status).toBe(401);
    const me = await request(server).get('/api/auth/me').set('Cookie', rotated.cookie);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('SESSION_REVOKED');
  });

  it('rejects a missing refresh cookie', async () => {
    const res = await request(server).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an access token after its 10 minute lifetime', async () => {
    const { session } = await login(server, fx.factory.username, PASSWORD, freshIp());
    t.clock.advance(11 * 60_000);
    const res = await request(server).get('/api/auth/me').set('Cookie', session.cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('driver single session (BR-04 / AC-10)', () => {
  it('a second driver login revokes the first session', async () => {
    const first = await login(server, fx.driver.mobile, PASSWORD, freshIp());
    expect((await request(server).get('/api/driver/ping').set('Cookie', first.session.cookie)).status).toBe(200);
    const second = await login(server, fx.driver.mobile, PASSWORD, freshIp());
    expect(second.res.status).toBe(200);

    const old = await request(server).get('/api/driver/ping').set('Cookie', first.session.cookie);
    expect(old.status).toBe(401);
    expect(old.body.error.code).toBe('SESSION_REVOKED');
    expect((await request(server).get('/api/driver/ping').set('Cookie', second.session.cookie)).status).toBe(200);

    const audit = await t.prisma.auditLog.findFirst({
      where: { action: 'auth.sessions_revoked', entityId: fx.driver.userId, reason: 'new_device' },
    });
    expect(audit).not.toBeNull();
  });

  it('operators may keep multiple sessions', async () => {
    const a = await login(server, fx.carrierOp.username, PASSWORD, freshIp());
    const b = await login(server, fx.carrierOp.username, PASSWORD, freshIp());
    expect(b.res.status).toBe(200);
    expect((await request(server).get('/api/carrier/ping').set('Cookie', a.session.cookie)).status).toBe(200);
  });
});

describe('CSRF + logout + change-password', () => {
  it('rejects a state-changing request without X-CSRF (403 CSRF_FAILED)', async () => {
    const { session } = await login(server, fx.carrierOp.username, PASSWORD, freshIp());
    const res = await request(server).post('/api/auth/logout').set('Cookie', session.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('rejects a foreign Origin even with a valid token', async () => {
    const { session } = await login(server, fx.carrierOp.username, PASSWORD, freshIp());
    const res = await request(server)
      .post('/api/auth/logout')
      .set('Cookie', session.cookie)
      .set('X-CSRF', session.csrf)
      .set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('logout with a valid token revokes the session', async () => {
    const { session } = await login(server, fx.carrierOp.username, PASSWORD, freshIp());
    const res = await request(server)
      .post('/api/auth/logout')
      .set('Cookie', session.cookie)
      .set('X-CSRF', session.csrf)
      .set('Origin', 'http://localhost:3000');
    expect(res.status).toBe(204);
    const me = await request(server).get('/api/auth/me').set('Cookie', session.cookie);
    expect(me.body.error.code).toBe('SESSION_REVOKED');
  });

  it('change-password requires the current password and then accepts the new one', async () => {
    const { session } = await login(server, fx.factory.username, PASSWORD, freshIp());
    const wrong = await request(server)
      .post('/api/auth/change-password')
      .set('Cookie', session.cookie)
      .set('X-CSRF', session.csrf)
      .send({ currentPassword: 'nope-nope', newPassword: 'NewPass@123' });
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    const ok = await request(server)
      .post('/api/auth/change-password')
      .set('Cookie', session.cookie)
      .set('X-CSRF', session.csrf)
      .send({ currentPassword: PASSWORD, newPassword: 'NewPass@123' });
    expect(ok.status).toBe(204);
    expect((await login(server, fx.factory.username, 'NewPass@123', freshIp())).res.status).toBe(200);
  });
});
