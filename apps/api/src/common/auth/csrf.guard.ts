import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { DomainError } from '../errors/domain-error';
import { SKIP_CSRF } from './auth.decorators';
import { CSRF_COOKIE, CSRF_HEADER, isCsrfValid } from './csrf';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const skipToken =
      this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()]) ?? false;
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const header = req.headers[CSRF_HEADER];
    const ok = isCsrfValid({
      method: req.method,
      skipToken,
      origin: req.headers.origin,
      headerToken: Array.isArray(header) ? header[0] : header,
      cookieToken: cookies[CSRF_COOKIE],
      webOrigin: this.config.webOrigin,
    });
    if (!ok) throw new DomainError('CSRF_FAILED');
    return true;
  }
}
