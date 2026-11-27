import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { uuidv7 } from 'uuidv7';
import type { AuthUser } from '../auth/auth.decorators';

export interface RequestContext {
  requestId: string;
  ip: string | undefined;
  userAgent: string | undefined;
  user?: AuthUser;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  setUser(user: AuthUser): void {
    const ctx = storage.getStore();
    if (ctx) ctx.user = user;
  },
};

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

export type RequestWithId = Request & { id?: string };

/** Express middleware: assigns a request id and opens the AsyncLocalStorage scope. */
export function requestContextMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const requestId = candidate && REQUEST_ID_RE.test(candidate) ? candidate : uuidv7();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  const ua = req.headers['user-agent'];
  storage.run({ requestId, ip: req.ip, userAgent: ua ? ua.slice(0, 300) : undefined }, () => next());
}
