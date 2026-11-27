import { timingSafeEqual } from 'node:crypto';

export const CSRF_COOKIE = 'csrf';
export const CSRF_HEADER = 'x-csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfInput {
  method: string;
  /** true for login/register-driver/refresh (double-submit not yet possible). */
  skipToken: boolean;
  origin: string | undefined;
  headerToken: string | undefined;
  cookieToken: string | undefined;
  webOrigin: string;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * CSRF policy (SPEC §6): for unsafe methods, a present `Origin` must equal WEB_ORIGIN,
 * and (unless exempt) header `X-CSRF` must equal the `csrf` cookie.
 */
export function isCsrfValid(i: CsrfInput): boolean {
  if (SAFE_METHODS.has(i.method.toUpperCase())) return true;
  if (i.origin !== undefined && i.origin.replace(/\/$/, '') !== i.webOrigin) return false;
  if (i.skipToken) return true;
  if (!i.headerToken || !i.cookieToken) return false;
  return safeEqual(i.headerToken, i.cookieToken);
}
