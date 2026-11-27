import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, toApiError } from './api';
import { getServerOffset, resetServerClock } from './server-clock';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function setup(handler: Handler, csrf: string | null = 'tok123') {
  const calls: { url: string; init: RequestInit }[] = [];
  const onAuthFailure = vi.fn();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const i = init ?? {};
    calls.push({ url, init: i });
    return handler(url, i);
  }) as unknown as typeof fetch;
  const client = createApiClient({ fetchImpl, getCsrf: () => csrf, onAuthFailure, now: () => 1_000_000 });
  return { client, calls, onAuthFailure };
}

const header = (init: RequestInit, name: string) => (init.headers as Record<string, string> | undefined)?.[name];

afterEach(() => resetServerClock());

describe('api client — CSRF & credentials', () => {
  it('sends X-CSRF on non-GET and always includes credentials', async () => {
    const { client, calls } = setup(() => json(200, { ok: true }));
    await client.post('/auth/logout', { a: 1 });
    expect(calls[0]?.url).toBe('/api/auth/logout');
    expect(header(calls[0]!.init, 'X-CSRF')).toBe('tok123');
    expect(header(calls[0]!.init, 'Content-Type')).toBe('application/json');
    expect(calls[0]?.init.credentials).toBe('include');
    expect(calls[0]?.init.body).toBe('{"a":1}');
  });

  it('does not send X-CSRF on GET and serializes query params', async () => {
    const { client, calls } = setup(() => json(200, []));
    await client.get('/public/cities', { query: { q: 'شیراز', empty: undefined } });
    expect(header(calls[0]!.init, 'X-CSRF')).toBeUndefined();
    expect(calls[0]?.url).toBe(`/api/public/cities?q=${encodeURIComponent('شیراز')}`);
    expect(calls[0]?.init.credentials).toBe('include');
  });
});

describe('api client — error mapping', () => {
  it('maps {error:{code,message}} to ApiError with status', async () => {
    const { client } = setup(() => json(409, { error: { code: 'UNIT_TAKEN', message: 'رزرو شد' } }));
    const err = await client.post('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'UNIT_TAKEN', message: 'رزرو شد', status: 409 });
  });

  it('falls back to Persian messages for bodies without an error envelope', () => {
    expect(toApiError(500, 'oops')).toMatchObject({ code: 'INTERNAL', status: 500 });
    expect(toApiError(418, undefined).code).toBe('UNKNOWN');
    expect(toApiError(400, { error: { code: 'WHATEVER', message: '' } }).code).toBe('UNKNOWN');
  });

  it('maps network failures to NETWORK_ERROR', async () => {
    const { client } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(client.get('/auth/me')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('records the X-Server-Time offset', async () => {
    const serverIso = new Date(1_000_000 + 5_000).toISOString();
    const { client } = setup(() => json(200, {}, { 'X-Server-Time': serverIso }));
    await client.get('/auth/me');
    expect(getServerOffset()).toEqual({ offsetMs: 5_000, synced: true });
  });
});

describe('api client — refresh on 401', () => {
  it('refreshes once (single-flight) for concurrent 401s and retries', async () => {
    let refreshed = false;
    const { client, calls } = setup((url) => {
      if (url.endsWith('/auth/refresh')) {
        refreshed = true;
        return json(200, {});
      }
      return refreshed ? json(200, { url }) : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    });
    const results = await Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);
    expect(results).toHaveLength(3);
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
    const refreshCall = calls.find((c) => c.url.endsWith('/auth/refresh'));
    expect(header(refreshCall!.init, 'X-CSRF')).toBe('tok123');
  });

  it('reports UNAUTHENTICATED when refresh fails, without retrying', async () => {
    const { client, calls, onAuthFailure } = setup((url) =>
      url.endsWith('/auth/refresh') ? json(401, {}) : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    );
    await expect(client.get('/auth/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onAuthFailure).toHaveBeenCalledWith('UNAUTHENTICATED');
    expect(calls.filter((c) => c.url.endsWith('/auth/me'))).toHaveLength(1);
  });

  it('does not refresh on SESSION_REVOKED and signals it', async () => {
    const { client, calls, onAuthFailure } = setup(() =>
      json(401, { error: { code: 'SESSION_REVOKED', message: 'باطل' } }),
    );
    await expect(client.get('/driver/me')).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    expect(onAuthFailure).toHaveBeenCalledWith('SESSION_REVOKED');
    expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(false);
  });

  it('does not refresh for a failed login (401 is a business answer)', async () => {
    const { client, calls, onAuthFailure } = setup(() =>
      json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'اشتباه' } }),
    );
    await expect(client.post('/auth/login', {})).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(calls).toHaveLength(1);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });
});
