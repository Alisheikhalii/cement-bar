import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { ROLES, type Role } from '@cb/shared';
import { APP_CONFIG, AUTH, type AppConfig } from '../../config/app-config';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';

const ALG = 'HS256';
const ISSUER = 'cement-bar';

interface AccessClaims {
  role: Role;
  tid: string;
  cid?: string;
  did?: string;
  sid: string;
}

function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

@Injectable()
export class TokenService {
  private readonly accessKey: Uint8Array;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: ClockService,
  ) {
    this.accessKey = new TextEncoder().encode(config.jwtAccessSecret);
  }

  async signAccess(user: AuthUser): Promise<string> {
    const nowSec = Math.floor(this.clock.now().getTime() / 1000);
    const claims: AccessClaims = { role: user.role, tid: user.tenantId, sid: user.sid };
    if (user.carrierId) claims.cid = user.carrierId;
    if (user.driverId) claims.did = user.driverId;
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: ALG })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + AUTH.accessTtlSeconds)
      .sign(this.accessKey);
  }

  /** Verifies signature + expiry against ClockService. Throws UNAUTHENTICATED. */
  async verifyAccess(token: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify(token, this.accessKey, {
        algorithms: [ALG],
        issuer: ISSUER,
        currentDate: this.clock.now(),
      });
      const { sub, role, tid, cid, did, sid } = payload;
      if (!sub || !isRole(role) || typeof tid !== 'string' || typeof sid !== 'string') {
        throw new Error('bad claims');
      }
      const user: AuthUser = { id: sub, role, tenantId: tid, sid };
      if (typeof cid === 'string') user.carrierId = cid;
      if (typeof did === 'string') user.driverId = did;
      return user;
    } catch {
      throw new DomainError('UNAUTHENTICATED');
    }
  }

  /** Opaque refresh token (32 random bytes). Only its keyed hash is stored. */
  newRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHmac('sha256', this.config.jwtRefreshSecret).update(token).digest('hex');
  }

  newCsrfToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
