import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@cb/shared';
import { DomainError } from '../errors/domain-error';
import { IS_PUBLIC, ROLES_KEY, type AuthedRequest } from './auth.decorators';

/** Enforces @Roles(). Runs after AuthGuard. Non-public routes without @Roles allow any authenticated user. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw new DomainError('UNAUTHENTICATED');
    if (!roles || roles.length === 0) return true;
    if (!roles.includes(user.role)) throw new DomainError('FORBIDDEN');
    return true;
  }
}
