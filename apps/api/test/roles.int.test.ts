import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, freshIp, type TestApp } from './helpers/app';
import { createFixture, login, type Fixture, type Session } from './helpers/fixtures';

let t: TestApp;
let fx: Fixture;
let server: Server;
const sessions: Record<string, Session> = {};

beforeAll(async () => {
  t = await createTestApp();
  fx = await createFixture(t);
  server = t.app.getHttpServer() as Server;
  sessions.FACTORY_OPERATOR = (await login(server, fx.factory.username, undefined, freshIp())).session;
  sessions.CARRIER_OPERATOR = (await login(server, fx.carrierOp.username, undefined, freshIp())).session;
  sessions.DRIVER = (await login(server, fx.driver.mobile, undefined, freshIp())).session;
});

afterAll(async () => {
  await fx?.dispose();
  await t?.close();
});

const matrix: [path: string, allowed: string][] = [
  ['/api/factory/ping', 'FACTORY_OPERATOR'],
  ['/api/carrier/ping', 'CARRIER_OPERATOR'],
  ['/api/driver/ping', 'DRIVER'],
];
const roles = ['FACTORY_OPERATOR', 'CARRIER_OPERATOR', 'DRIVER'];

describe('role matrix', () => {
  for (const [path, allowed] of matrix) {
    for (const role of roles) {
      const expected = role === allowed ? 200 : 403;
      it(`${role} → GET ${path} = ${expected}`, async () => {
        const res = await request(server).get(path).set('Cookie', sessions[role]!.cookie);
        expect(res.status).toBe(expected);
        if (expected === 403) expect(res.body.error.code).toBe('FORBIDDEN');
        else expect(res.body.role).toBe(role);
      });
    }
    it(`anonymous → GET ${path} = 401`, async () => {
      const res = await request(server).get(path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  }

  it('rejects a forged access token', async () => {
    const res = await request(server).get('/api/factory/ping').set('Cookie', 'at=eyJhbGciOiJIUzI1NiJ9.e30.x');
    expect(res.status).toBe(401);
  });

  it('unknown routes return the standard error body', async () => {
    const res = await request(server).get('/api/nope').set('Cookie', sessions.FACTORY_OPERATOR!.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
