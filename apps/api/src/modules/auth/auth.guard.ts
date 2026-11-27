import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { IS_PUBLIC, type AuthedRequest } from '../../common/auth/auth.decorators';
import { requestContext } from '../../common/context/request-context';
import { DomainError } from '../../common/errors/domain-error';
import { cookieNames, readCookie } from './auth.cookies';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

/** Global guard: verifies the access JWT and that its session family is still active (BR-04). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = readCookie(req, cookieNames(this.config).access);
    if (!token) throw new DomainError('UNAUTHENTICATED');
    const user = await this.tokens.verifyAccess(token);
    if (!(await this.sessions.isFamilyActive(user.sid))) throw new DomainError('SESSION_REVOKED');
    req.user = user;
    requestContext.setUser(user);
    return true;
  }
}
