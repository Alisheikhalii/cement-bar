import type { Server } from 'node:http';
import request from 'supertest';
import type { TestApp } from './app';
import { freshIp } from './app';
import { createFixture, login, type Fixture, type Session } from './fixtures';

/** Authenticated supertest wrapper: cookie + X-CSRF on every call. */
export interface Client {
  get: (path: string) => request.Test;
  post: (path: string, body?: object) => request.Test;
  put: (path: string, body?: object) => request.Test;
  patch: (path: string, body?: object) => request.Test;
  del: (path: string) => request.Test;
  session: Session;
}

export function client(server: Server, session: Session): Client {
  const auth = (r: request.Test) => r.set('Cookie', session.cookie).set('X-CSRF', session.csrf);
  return {
    get: (p) => auth(request(server).get(p)),
    post: (p, b) => auth(request(server).post(p)).send(b ?? {}),
    put: (p, b) => auth(request(server).put(p)).send(b ?? {}),
    patch: (p, b) => auth(request(server).patch(p)).send(b ?? {}),
    del: (p) => auth(request(server).delete(p)),
    session,
  };
}

export async function loginAs(server: Server, identifier: string, password?: string): Promise<Client> {
  const { res, session } = await login(server, identifier, password, freshIp());
  if (res.status !== 200) throw new Error(`login failed for ${identifier}: ${res.status} ${JSON.stringify(res.body)}`);
  return client(server, session);
}

export interface FactoryWorld {
  server: Server;
  a: Fixture;
  b: Fixture;
  /** Factory operator of tenant A (the actor under test). */
  factory: Client;
  /** Factory operator of tenant B (cross-tenant IDOR checks). */
  otherFactory: Client;
  carrier: Client;
  driver: Client;
  dispose: () => Promise<void>;
}

/** Two isolated tenants (A = under test, B = attacker) and logged-in clients. Never touches global data. */
export async function createFactoryWorld(t: TestApp): Promise<FactoryWorld> {
  const server = t.app.getHttpServer() as Server;
  const a = await createFixture(t);
  const b = await createFixture(t).catch(async (e: unknown) => {
    await a.dispose();
    throw e;
  });
  try {
    return {
      server,
      a,
      b,
      factory: await loginAs(server, a.factory.username),
      otherFactory: await loginAs(server, b.factory.username),
      carrier: await loginAs(server, a.carrierOp.username),
      driver: await loginAs(server, a.driver.mobile),
      dispose: async () => {
        await a.dispose();
        await b.dispose();
      },
    };
  } catch (e) {
    await a.dispose();
    await b.dispose();
    throw e;
  }
}
