import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Role } from '@prisma/client';
import { AUTH } from '../../config/app-config';
import { ClockService } from '../../common/clock/clock.service';
import { PrismaService, TX_TIMEOUT_MS } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { TokenService } from './token.service';

const CACHE_ACTIVE_TTL_S = AUTH.accessTtlSeconds;
const CACHE_REVOKED_TTL_S = AUTH.accessTtlSeconds * 2;
const cacheKey = (familyId: string): string => `sess:${familyId}`;

export type RevokeReason = 'logout' | 'new_device' | 'reuse_detected' | 'password_changed' | 'disabled' | 'rotated';

export interface NewSession {
  familyId: string;
  sessionId: string;
  refreshToken: string;
}

export interface SessionOwner {
  id: string;
  role: Role;
  tenantId: string;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly clock: ClockService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /** Creates a new session family. Drivers keep at most one active session (BR-04). */
  async create(owner: SessionOwner, meta: { deviceInfo?: string; ip?: string }): Promise<NewSession> {
    const now = this.clock.now();
    const refreshToken = this.tokens.newRefreshToken();
    const familyId = randomUUID();
    const revokedFamilies = await this.prisma.$transaction(
      async (tx) => {
        let revoked: string[] = [];
        if (owner.role === 'DRIVER') {
          const active = await tx.session.findMany({
            where: { userId: owner.id, revokedAt: null },
            select: { familyId: true },
          });
          revoked = [...new Set(active.map((s) => s.familyId))];
          if (revoked.length > 0) {
            await tx.session.updateMany({
              where: { userId: owner.id, revokedAt: null },
              data: { revokedAt: now, revokeReason: 'new_device' },
            });
            await this.audit.log(
              {
                action: 'auth.sessions_revoked',
                entity: 'User',
                entityId: owner.id,
                after: { families: revoked.length },
                reason: 'new_device',
                actor: owner,
              },
              tx,
            );
          }
        }
        const session = await tx.session.create({
          data: {
            userId: owner.id,
            familyId,
            refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
            deviceInfo: meta.deviceInfo ?? null,
            ip: meta.ip ?? null,
            createdAt: now,
            lastUsedAt: now,
            expiresAt: new Date(now.getTime() + AUTH.refreshTtlSeconds * 1000),
          },
        });
        return { revoked, sessionId: session.id };
      },
      { timeout: TX_TIMEOUT_MS },
    );
    await Promise.all(revokedFamilies.revoked.map((f) => this.cache(f, false)));
    await this.cache(familyId, true);
    return { familyId, sessionId: revokedFamilies.sessionId, refreshToken };
  }

  /**
   * Rotates a refresh session: marks the old row 'rotated' and creates a new one in the same family.
   * Returns null if the old row was concurrently revoked (caller treats it as reuse).
   */
  async rotate(old: { id: string; familyId: string; userId: string; deviceInfo: string | null }, ip?: string) {
    const now = this.clock.now();
    const refreshToken = this.tokens.newRefreshToken();
    const newId = randomUUID();
    const ok = await this.prisma.$transaction(
      async (tx) => {
        const upd = await tx.session.updateMany({
          where: { id: old.id, revokedAt: null },
          data: { revokedAt: now, revokeReason: 'rotated', replacedById: newId },
        });
        if (upd.count !== 1) return false;
        await tx.session.create({
          data: {
            id: newId,
            userId: old.userId,
            familyId: old.familyId,
            refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
            deviceInfo: old.deviceInfo,
            ip: ip ?? null,
            createdAt: now,
            lastUsedAt: now,
            expiresAt: new Date(now.getTime() + AUTH.refreshTtlSeconds * 1000),
          },
        });
        return true;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return ok ? { refreshToken, sessionId: newId } : null;
  }

  async revokeFamily(familyId: string, reason: RevokeReason): Promise<void> {
    await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokeReason: reason },
    });
    await this.cache(familyId, false);
  }

  /** Revokes every active family of a user except `keepFamilyId`. */
  async revokeUserFamilies(userId: string, reason: RevokeReason, keepFamilyId?: string): Promise<number> {
    const where = { userId, revokedAt: null, ...(keepFamilyId ? { familyId: { not: keepFamilyId } } : {}) };
    const active = await this.prisma.session.findMany({ where, select: { familyId: true } });
    const families = [...new Set(active.map((s) => s.familyId))];
    if (families.length === 0) return 0;
    await this.prisma.session.updateMany({ where, data: { revokedAt: this.clock.now(), revokeReason: reason } });
    await Promise.all(families.map((f) => this.cache(f, false)));
    return families.length;
  }

  /** BR-04: is the session family behind an access token still active? Redis cache, DB fallback. */
  async isFamilyActive(familyId: string): Promise<boolean> {
    try {
      const cached = await this.redis.client.get(cacheKey(familyId));
      if (cached === '1') return true;
      if (cached === '0') return false;
    } catch (e) {
      this.logger.warn(`session cache unavailable: ${(e as Error).message}`);
    }
    const found = await this.prisma.session.findFirst({
      where: { familyId, revokedAt: null, expiresAt: { gt: this.clock.now() } },
      select: { id: true },
    });
    await this.cache(familyId, found !== null);
    return found !== null;
  }

  private async cache(familyId: string, active: boolean): Promise<void> {
    try {
      await this.redis.client.set(
        cacheKey(familyId),
        active ? '1' : '0',
        'EX',
        active ? CACHE_ACTIVE_TTL_S : CACHE_REVOKED_TTL_S,
      );
    } catch (e) {
      // DB stays the source of truth; a stale '1' would be dangerous, so try to drop the key.
      this.logger.warn(`session cache write failed: ${(e as Error).message}`);
      await this.redis.client.del(cacheKey(familyId)).catch(() => undefined);
    }
  }
}
