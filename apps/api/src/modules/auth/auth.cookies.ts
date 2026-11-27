import type { CookieOptions, Request, Response } from 'express';
import { AUTH, type AppConfig } from '../../config/app-config';
import { CSRF_COOKIE } from '../../common/auth/csrf';

export interface CookieNames {
  access: string;
  refresh: string;
  csrf: string;
}

/** `__Host-` prefix requires Secure + Path=/ + no Domain, so it is used only when COOKIE_SECURE=true. */
export function cookieNames(config: Pick<AppConfig, 'cookieSecure'>): CookieNames {
  return config.cookieSecure
    ? { access: '__Host-at', refresh: '__Host-rt', csrf: CSRF_COOKIE }
    : { access: 'at', refresh: 'rt', csrf: CSRF_COOKIE };
}

function base(config: AppConfig): CookieOptions {
  return { secure: config.cookieSecure, sameSite: 'strict', path: '/' };
}

export function setAuthCookies(
  res: Response,
  config: AppConfig,
  tokens: { access: string; refresh: string; csrf: string },
): void {
  const names = cookieNames(config);
  res.cookie(names.access, tokens.access, {
    ...base(config),
    httpOnly: true,
    maxAge: AUTH.accessTtlSeconds * 1000,
  });
  res.cookie(names.refresh, tokens.refresh, {
    ...base(config),
    httpOnly: true,
    maxAge: AUTH.refreshTtlSeconds * 1000,
  });
  // Readable by JS so the SPA can echo it in X-CSRF (double-submit).
  res.cookie(names.csrf, tokens.csrf, {
    ...base(config),
    httpOnly: false,
    maxAge: AUTH.refreshTtlSeconds * 1000,
  });
}

export function clearAuthCookies(res: Response, config: AppConfig): void {
  const names = cookieNames(config);
  for (const name of [names.access, names.refresh, names.csrf]) {
    res.clearCookie(name, base(config));
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  const cookies = (req.cookies ?? {}) as Record<string, unknown>;
  const v = cookies[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
