import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';

let t: TestApp;
let server: Server;

beforeAll(async () => {
  t = await createTestApp();
  server = t.app.getHttpServer() as Server;
});

afterAll(async () => {
  await t?.close();
});

describe('ops endpoints', () => {
  it('GET /api/healthz → 200 with security headers', async () => {
    const res = await request(server).get('/api/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-server-time']).toBe(t.clock.now().toISOString());
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /api/readyz → 200 when DB and Redis are up', async () => {
    const res = await request(server).get('/api/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: true, redis: true });
  });

  it('GET /api/metrics → prometheus text from loopback, 403 for a public client IP', async () => {
    const res = await request(server).get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('cb_http_request_duration_seconds');
    const pub = await request(server).get('/api/metrics').set('X-Forwarded-For', '8.8.8.8');
    expect(pub.status).toBe(403);
  });

  it('malformed JSON → 400 VALIDATION_FAILED without stack trace', async () => {
    const res = await request(server)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"identifier": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js/);
  });
});
