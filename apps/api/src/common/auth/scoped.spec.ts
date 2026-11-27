import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error';
import type { AuthUser } from './auth.decorators';
import { scoped, scopedCarrier, scopedDriver, scopedTenant } from './scoped';

const factory: AuthUser = { id: 'u1', role: 'FACTORY_OPERATOR', tenantId: 't1', sid: 's' };
const carrier: AuthUser = { id: 'u2', role: 'CARRIER_OPERATOR', tenantId: 't1', carrierId: 'c1', sid: 's' };
const driver: AuthUser = { id: 'u3', role: 'DRIVER', tenantId: 't1', driverId: 'd1', sid: 's' };

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : 'OTHER';
  }
  return undefined;
}

describe('scoped()', () => {
  it('scopes by role', () => {
    expect(scoped(factory)).toEqual({ tenantId: 't1' });
    expect(scoped(carrier)).toEqual({ tenantId: 't1', carrierId: 'c1' });
    expect(scoped(driver)).toEqual({ tenantId: 't1', driverId: 'd1' });
  });

  it('scopedTenant works for every role', () => {
    expect(scopedTenant(driver)).toEqual({ tenantId: 't1' });
  });

  it('scopedCarrier rejects non-carrier users', () => {
    expect(code(() => scopedCarrier(driver))).toBe('FORBIDDEN');
    expect(code(() => scopedCarrier(factory))).toBe('FORBIDDEN');
    expect(code(() => scopedCarrier({ ...carrier, carrierId: undefined }))).toBe('FORBIDDEN');
  });

  it('scopedDriver rejects non-driver users', () => {
    expect(code(() => scopedDriver(carrier))).toBe('FORBIDDEN');
    expect(code(() => scopedDriver({ ...driver, driverId: undefined }))).toBe('FORBIDDEN');
  });

  it('never exposes ids beyond the user claims', () => {
    expect(Object.keys(scoped(carrier)).sort()).toEqual(['carrierId', 'tenantId']);
  });
});
