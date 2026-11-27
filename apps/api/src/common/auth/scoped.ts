import { DomainError } from '../errors/domain-error';
import type { AuthUser } from './auth.decorators';

export interface TenantScope {
  tenantId: string;
}
export interface CarrierScope extends TenantScope {
  carrierId: string;
}
export interface DriverScope extends TenantScope {
  driverId: string;
}

/**
 * Prisma `where` fragment derived ONLY from the authenticated user.
 * - FACTORY_OPERATOR → { tenantId }
 * - CARRIER_OPERATOR → { tenantId, carrierId }
 * - DRIVER           → { tenantId, driverId }
 * Spread it into every query on tenant/carrier/driver-owned data.
 */
export function scoped(user: AuthUser): TenantScope | CarrierScope | DriverScope {
  switch (user.role) {
    case 'FACTORY_OPERATOR':
      return scopedTenant(user);
    case 'CARRIER_OPERATOR':
      return scopedCarrier(user);
    case 'DRIVER':
      return scopedDriver(user);
    default:
      throw new DomainError('FORBIDDEN');
  }
}

export function scopedTenant(user: AuthUser): TenantScope {
  if (!user.tenantId) throw new DomainError('FORBIDDEN');
  return { tenantId: user.tenantId };
}

/** For carrier-owned data. Throws FORBIDDEN unless the user is a carrier operator with a carrier. */
export function scopedCarrier(user: AuthUser): CarrierScope {
  if (user.role !== 'CARRIER_OPERATOR' || !user.carrierId) throw new DomainError('FORBIDDEN');
  return { tenantId: scopedTenant(user).tenantId, carrierId: user.carrierId };
}

/** For driver-owned data. Throws FORBIDDEN unless the user is a driver. */
export function scopedDriver(user: AuthUser): DriverScope {
  if (user.role !== 'DRIVER' || !user.driverId) throw new DomainError('FORBIDDEN');
  return { tenantId: scopedTenant(user).tenantId, driverId: user.driverId };
}
