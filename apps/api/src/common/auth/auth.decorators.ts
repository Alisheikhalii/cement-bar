import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@cb/shared';
import type { Request } from 'express';
import { DomainError } from '../errors/domain-error';

/** Authenticated principal — the ONLY source of tenantId/carrierId/driverId. */
export interface AuthUser {
  id: string;
  role: Role;
  tenantId: string;
  /** Only for CARRIER_OPERATOR. */
  carrierId?: string;
  /** Only for DRIVER. */
  driverId?: string;
  /** Session family id (stable across refresh rotation). */
  sid: string;
}

export type AuthedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = 'cb:isPublic';
export const ROLES_KEY = 'cb:roles';
export const SKIP_CSRF = 'cb:skipCsrf';
export const RATE_BUCKET = 'cb:rateBucket';

/** Route needs no authentication. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Restrict a route/controller to the given roles (checked by RolesGuard). */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

/** Exempt from the X-CSRF double-submit check (Origin check still applies). */
export const SkipCsrf = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_CSRF, true);

export type RateBucket = 'login' | 'register';
/** Apply a named Redis-backed rate-limit bucket in addition to the global one. */
export const RateLimitBucket = (bucket: RateBucket): MethodDecorator => SetMetadata(RATE_BUCKET, bucket);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new DomainError('UNAUTHENTICATED');
  return req.user;
});
