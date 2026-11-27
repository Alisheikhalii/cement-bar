import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { MeResponse } from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';

export const userWithOrg = {
  carrier: { select: { id: true, name: true, code: true, status: true, deletedAt: true } },
  driver: { select: { id: true, status: true, carrierId: true } },
} satisfies Prisma.UserInclude;

export type UserWithOrg = Prisma.UserGetPayload<{ include: typeof userWithOrg }>;

export function toMe(u: UserWithOrg): MeResponse {
  return {
    id: u.id,
    role: u.role,
    displayName: u.displayName,
    username: u.username,
    mobile: u.mobile,
    carrier: u.carrier ? { id: u.carrier.id, name: u.carrier.name, code: u.carrier.code } : null,
    driver: u.driver ? { id: u.driver.id, status: u.driver.status } : null,
    mustChangePassword: u.mustChangePassword,
  };
}

/** Builds the principal (claims) for a user + session family. Throws ACCOUNT_DISABLED if inconsistent. */
export function toAuthUser(u: UserWithOrg, sid: string): AuthUser {
  const user: AuthUser = { id: u.id, role: u.role, tenantId: u.tenantId, sid };
  if (u.role === 'CARRIER_OPERATOR') {
    if (!u.carrierId) throw new DomainError('ACCOUNT_DISABLED');
    user.carrierId = u.carrierId;
  }
  if (u.role === 'DRIVER') {
    if (!u.driver) throw new DomainError('ACCOUNT_DISABLED');
    user.driverId = u.driver.id;
  }
  return user;
}

/**
 * Account-level gate: disabled user, or carrier operator of a suspended/deleted carrier.
 * NOTE (DECISIONS open question): drivers of a suspended carrier are NOT blocked at login.
 */
export function assertAccountUsable(u: UserWithOrg): void {
  if (u.status !== 'ACTIVE' || u.deletedAt) throw new DomainError('ACCOUNT_DISABLED');
  if (u.role === 'CARRIER_OPERATOR') {
    if (!u.carrier || u.carrier.status !== 'ACTIVE' || u.carrier.deletedAt) {
      throw new DomainError('ACCOUNT_DISABLED');
    }
  }
}

@Injectable()
export class UserLookupService {
  constructor(private readonly prisma: PrismaService) {}

  byId(id: string): Promise<UserWithOrg | null> {
    return this.prisma.user.findUnique({ where: { id }, include: userWithOrg });
  }

  /** Operators log in by username (case-insensitive storage = lowercase); drivers by normalized mobile. */
  byIdentifier(identifier: { mobile: string } | { username: string }): Promise<UserWithOrg | null> {
    if ('mobile' in identifier) {
      return this.prisma.user.findFirst({
        where: { mobile: identifier.mobile, role: 'DRIVER', deletedAt: null },
        include: userWithOrg,
      });
    }
    return this.prisma.user.findFirst({
      where: { username: identifier.username, role: { not: 'DRIVER' }, deletedAt: null },
      include: userWithOrg,
    });
  }
}
