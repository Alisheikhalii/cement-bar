import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@cb/shared';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error';
import { IS_PUBLIC, ROLES_KEY, type AuthUser } from './auth.decorators';
import { RolesGuard } from './roles.guard';

function ctxFor(meta: Record<string, unknown>, user?: Partial<AuthUser>): ExecutionContext {
  const handler = (): void => undefined;
  for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, handler);
  class Ctl {}
  return {
    getHandler: () => handler,
    getClass: () => Ctl,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const user = (role: Role): Partial<AuthUser> => ({ id: 'u', role, tenantId: 't', sid: 's' });

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : 'OTHER';
  }
  return undefined;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows public routes without a user', () => {
    expect(guard.canActivate(ctxFor({ [IS_PUBLIC]: true }))).toBe(true);
  });

  it('rejects non-public routes without a user (UNAUTHENTICATED)', () => {
    expect(codeOf(() => guard.canActivate(ctxFor({ [ROLES_KEY]: ['DRIVER'] })))).toBe('UNAUTHENTICATED');
  });

  it('allows a matching role', () => {
    const ctx = ctxFor({ [ROLES_KEY]: ['CARRIER_OPERATOR'] }, user('CARRIER_OPERATOR'));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('forbids a non-matching role', () => {
    const ctx = ctxFor({ [ROLES_KEY]: ['FACTORY_OPERATOR'] }, user('DRIVER'));
    expect(codeOf(() => guard.canActivate(ctx))).toBe('FORBIDDEN');
  });

  it('allows any authenticated user when no roles are declared', () => {
    expect(guard.canActivate(ctxFor({}, user('DRIVER')))).toBe(true);
  });
});
