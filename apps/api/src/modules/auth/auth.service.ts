import { Injectable } from '@nestjs/common';
import { normalizeMobile, type LoginInput, type MeResponse } from '@cb/shared';
import { AUTH } from '../../config/app-config';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { assertAccountUsable, toAuthUser, toMe, UserLookupService, type UserWithOrg } from './user-lookup.service';

export interface IssuedTokens {
  access: string;
  refresh: string;
  csrf: string;
}

export interface LoginResult {
  tokens: IssuedTokens;
  me: MeResponse;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly users: UserLookupService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput, ip: string | undefined): Promise<LoginResult> {
    const mobile = normalizeMobile(input.identifier);
    const user = await this.users.byIdentifier(
      mobile ? { mobile } : { username: input.identifier.trim().toLowerCase() },
    );
    if (!user) {
      await this.passwords.dummyVerify(input.password);
      throw new DomainError('INVALID_CREDENTIALS');
    }
    const now = this.clock.now();
    if (user.lockedUntil && user.lockedUntil > now) throw new DomainError('ACCOUNT_LOCKED');

    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      const locked = await this.registerFailure(user, now);
      throw new DomainError(locked ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS');
    }
    assertAccountUsable(user);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now },
    });
    const session = await this.sessions.create(user, { deviceInfo: input.deviceInfo, ip });
    const principal = toAuthUser(user, session.familyId);
    await this.audit.log({
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      after: { sessionId: session.sessionId },
      actor: principal,
    });
    return { tokens: await this.issue(principal, session.refreshToken), me: toMe(user) };
  }

  /** Increments the failure counter atomically; locks the account at the threshold. */
  private async registerFailure(user: UserWithOrg, now: Date): Promise<boolean> {
    const { failedLogins } = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: { increment: 1 } },
      select: { failedLogins: true },
    });
    const locked = failedLogins >= AUTH.maxFailedLogins;
    if (locked) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: new Date(now.getTime() + AUTH.lockMinutes * 60_000) },
      });
    }
    await this.audit.log({
      action: locked ? 'auth.account_locked' : 'auth.login_failed',
      entity: 'User',
      entityId: user.id,
      tenantId: user.tenantId,
      after: { failedLogins },
    });
    return locked;
  }

  async refresh(refreshToken: string | undefined, ip: string | undefined): Promise<IssuedTokens> {
    if (!refreshToken) throw new DomainError('UNAUTHENTICATED');
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: this.tokens.hashRefreshToken(refreshToken) },
    });
    if (!session) throw new DomainError('UNAUTHENTICATED');
    if (session.revokedAt) {
      if (session.revokeReason === 'rotated') await this.handleReuse(session.familyId, session.userId);
      throw new DomainError('SESSION_REVOKED');
    }
    if (session.expiresAt <= this.clock.now()) throw new DomainError('UNAUTHENTICATED');

    const user = await this.users.byId(session.userId);
    if (!user) throw new DomainError('UNAUTHENTICATED');
    try {
      assertAccountUsable(user);
    } catch (e) {
      await this.sessions.revokeFamily(session.familyId, 'disabled');
      throw e;
    }
    const rotated = await this.sessions.rotate(session, ip);
    if (!rotated) {
      await this.handleReuse(session.familyId, session.userId);
      throw new DomainError('SESSION_REVOKED');
    }
    return this.issue(toAuthUser(user, session.familyId), rotated.refreshToken);
  }

  /** Refresh-token reuse ⇒ the whole family is compromised: revoke it. */
  private async handleReuse(familyId: string, userId: string): Promise<void> {
    await this.sessions.revokeFamily(familyId, 'reuse_detected');
    const user = await this.users.byId(userId);
    await this.audit.log({
      action: 'auth.refresh_reuse_detected',
      entity: 'Session',
      entityId: familyId,
      tenantId: user?.tenantId ?? null,
      reason: 'reuse_detected',
      ...(user ? { actor: { id: user.id, role: user.role, tenantId: user.tenantId } } : {}),
    });
  }

  /** Revokes the family identified by a valid access token and/or refresh token. Never throws. */
  async logout(accessToken: string | undefined, refreshToken: string | undefined): Promise<void> {
    const families = new Set<string>();
    let actor: AuthUser | undefined;
    if (accessToken) {
      actor = await this.tokens.verifyAccess(accessToken).catch(() => undefined);
      if (actor) families.add(actor.sid);
    }
    if (refreshToken) {
      const s = await this.prisma.session.findUnique({
        where: { refreshTokenHash: this.tokens.hashRefreshToken(refreshToken) },
        select: { familyId: true },
      });
      if (s) families.add(s.familyId);
    }
    for (const f of families) await this.sessions.revokeFamily(f, 'logout');
    if (actor) {
      await this.audit.log({ action: 'auth.logout', entity: 'User', entityId: actor.id, actor });
    }
  }

  async me(user: AuthUser): Promise<MeResponse> {
    const u = await this.users.byId(user.id);
    if (!u || u.tenantId !== user.tenantId) throw new DomainError('UNAUTHENTICATED');
    return toMe(u);
  }

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string): Promise<void> {
    const u = await this.users.byId(user.id);
    if (!u || u.tenantId !== user.tenantId) throw new DomainError('UNAUTHENTICATED');
    if (!(await this.passwords.verify(u.passwordHash, currentPassword))) {
      throw new DomainError('INVALID_CREDENTIALS');
    }
    if (currentPassword === newPassword) {
      throw new DomainError('VALIDATION_FAILED', { field: 'newPassword' });
    }
    await this.prisma.user.update({
      where: { id: u.id },
      data: { passwordHash: await this.passwords.hash(newPassword), mustChangePassword: false },
    });
    const revoked = await this.sessions.revokeUserFamilies(u.id, 'password_changed', user.sid);
    await this.audit.log({
      action: 'auth.password_changed',
      entity: 'User',
      entityId: u.id,
      after: { otherSessionsRevoked: revoked },
    });
  }

  private async issue(principal: AuthUser, refresh: string): Promise<IssuedTokens> {
    return {
      access: await this.tokens.signAccess(principal),
      refresh,
      csrf: this.tokens.newCsrfToken(),
    };
  }
}
