import type { Server } from 'node:http';
import request from 'supertest';
import { freshIp } from './app';
import { login, type Session } from './fixtures';

export { createFixture, randomMobile, validNationalId, type Fixture, type Session } from './fixtures';

/** Authenticated request helpers (cookie + CSRF double-submit header). */
export function as(server: Server, s: Session) {
  return {
    get: (path: string) => request(server).get(`/api${path}`).set('Cookie', s.cookie),
    post: (path: string, body: object = {}) => request(server).post(`/api${path}`).set('Cookie', s.cookie).set('X-CSRF', s.csrf).send(body),
    put: (path: string, body: object = {}) => request(server).put(`/api${path}`).set('Cookie', s.cookie).set('X-CSRF', s.csrf).send(body),
    del: (path: string) => request(server).delete(`/api${path}`).set('Cookie', s.cookie).set('X-CSRF', s.csrf),
  };
}

/** Logs in from a fresh fake IP (per-IP login rate limit) and fails loudly if login did not work. */
export async function freshLogin(server: Server, identifier: string): Promise<Session> {
  const { res, session } = await login(server, identifier, undefined, freshIp());
  if (res.status !== 200) throw new Error(`login failed for ${identifier}: ${res.status} ${JSON.stringify(res.body)}`);
  return session;
}
