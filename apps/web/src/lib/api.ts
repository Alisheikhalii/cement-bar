import { ERRORS, type ApiErrorBody, type ErrorCode } from '@cb/shared';
import { fa } from '@/i18n/fa';
import { deviceNow, recordServerTime } from './server-clock';

/** Client-only error codes (no server round trip). */
export type ClientErrorCode = 'NETWORK_ERROR' | 'UNKNOWN';
export type ApiErrorCode = ErrorCode | ClientErrorCode;

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type AuthFailureReason = 'SESSION_REVOKED' | 'UNAUTHENTICATED';

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Reads the readable `csrf` cookie. Default: document.cookie. */
  getCsrf?: () => string | null;
  /** Called once when the session cannot be recovered (UI shows toast + redirects to /login). */
  onAuthFailure?: (reason: AuthFailureReason) => void;
  now?: () => number;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
  /** Internal: skip refresh-and-retry (auth endpoints themselves). */
  noRefresh?: boolean;
}

const REFRESH_LOCK = 'cb-auth-refresh';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Endpoints where a 401 is a business answer, not an expired session. */
const NO_REFRESH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/register-driver'];

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const hit = document.cookie.split('; ').find((c) => c.startsWith(prefix));
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : null;
}

function isApiErrorBody(v: unknown): v is ApiErrorBody {
  if (typeof v !== 'object' || v === null || !('error' in v)) return false;
  const e = (v as { error: unknown }).error;
  return typeof e === 'object' && e !== null && 'code' in e && typeof (e as { code: unknown }).code === 'string';
}

function isKnownCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERRORS, code);
}

/** Map any non-OK response body to an ApiError with a Persian message. */
export function toApiError(status: number, body: unknown): ApiError {
  if (isApiErrorBody(body)) {
    const { code, message, details } = body.error;
    if (isKnownCode(code)) return new ApiError(code, message || ERRORS[code].fa, status, details);
    return new ApiError('UNKNOWN', message || fa.common.unknownError, status, details);
  }
  if (status === 401) return new ApiError('UNAUTHENTICATED', ERRORS.UNAUTHENTICATED.fa, status);
  if (status === 403) return new ApiError('FORBIDDEN', ERRORS.FORBIDDEN.fa, status);
  if (status === 404) return new ApiError('NOT_FOUND', ERRORS.NOT_FOUND.fa, status);
  if (status === 429) return new ApiError('RATE_LIMITED', ERRORS.RATE_LIMITED.fa, status);
  if (status >= 500) return new ApiError('INTERNAL', ERRORS.INTERNAL.fa, status);
  return new ApiError('UNKNOWN', fa.common.unknownError, status);
}

function buildUrl(base: string, path: string, query?: RequestOptions['query']): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) qs.set(k, String(v));
  const s = qs.toString();
  return `${base}${path}${s ? `?${s}` : ''}`;
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function createApiClient(opts: ApiClientOptions = {}) {
  const base = opts.baseUrl ?? '/api';
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const getCsrf = opts.getCsrf ?? (() => readCookie('csrf'));
  const now = opts.now ?? deviceNow;
  let refreshing: Promise<boolean> | null = null;

  async function raw(method: string, path: string, o: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (!SAFE_METHODS.has(method)) {
      const csrf = getCsrf();
      if (csrf) headers['X-CSRF'] = csrf;
    }
    const sentAt = now();
    let res: Response;
    try {
      res = await doFetch(buildUrl(base, path, o.query), {
        method,
        headers,
        credentials: 'include',
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        signal: o.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new ApiError('NETWORK_ERROR', fa.common.networkError, 0);
    }
    const serverTime = res.headers.get('X-Server-Time');
    if (serverTime) recordServerTime(serverTime, sentAt, now());
    return res;
  }

  /**
   * Single-flight: concurrent 401s in this tab share one refresh call. Across tabs, the Web Locks API
   * serializes refreshes so a second tab sends the already-rotated cookie instead of the old one
   * (the API treats a reused refresh token as theft and revokes the family — DECISIONS Q-A4).
   */
  function refresh(): Promise<boolean> {
    const run = () =>
      raw('POST', '/auth/refresh', { noRefresh: true })
        .then((r) => r.ok)
        .catch(() => false);
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    refreshing ??= (locks ? locks.request(REFRESH_LOCK, run) : run())
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function request<T>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
    let res = await raw(method, path, o);
    if (res.status === 401 && !o.noRefresh && !NO_REFRESH_PATHS.includes(path)) {
      const body = await parseBody(res);
      const err = toApiError(401, body);
      if (err.code === 'SESSION_REVOKED') {
        opts.onAuthFailure?.('SESSION_REVOKED');
        throw err;
      }
      if (await refresh()) {
        res = await raw(method, path, o);
      } else {
        opts.onAuthFailure?.('UNAUTHENTICATED');
        throw err;
      }
      if (res.status === 401) {
        const again = toApiError(401, await parseBody(res));
        opts.onAuthFailure?.(again.code === 'SESSION_REVOKED' ? 'SESSION_REVOKED' : 'UNAUTHENTICATED');
        throw again;
      }
    }
    const body = await parseBody(res);
    if (!res.ok) throw toApiError(res.status, body);
    return body as T;
  }

  return {
    request,
    get: <T>(path: string, o?: Omit<RequestOptions, 'body'>) => request<T>('GET', path, o),
    post: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>('POST', path, { ...o, body }),
    put: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>('PUT', path, { ...o, body }),
    patch: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>('PATCH', path, { ...o, body }),
    del: <T>(path: string, o?: RequestOptions) => request<T>('DELETE', path, o),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

let authFailureHandler: ((reason: AuthFailureReason) => void) | null = null;

/** Registered by <AuthEvents/> so the plain API client can trigger a toast + navigation. */
export function setAuthFailureHandler(h: ((reason: AuthFailureReason) => void) | null): void {
  authFailureHandler = h;
}

export const api = createApiClient({ onAuthFailure: (r) => authFailureHandler?.(r) });

/** Persian message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return fa.common.unknownError;
}
