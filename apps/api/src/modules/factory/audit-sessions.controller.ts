import { Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FACTORY_AUDIT_COLUMNS, FACTORY_SESSION_COLUMNS } from '@cb/shared';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { parseListQuery } from '../../common/list/list-query';
import { respondList } from '../../common/list/list-response';
import { AuditSessionsService } from './audit-sessions.service';
import { FactoryDashboardService } from './dashboard.service';
import { UuidPipe } from './factory.util';

@Roles('FACTORY_OPERATOR')
@Controller('factory')
export class AuditSessionsController {
  constructor(
    private readonly svc: AuditSessionsService,
    private readonly dashboard: FactoryDashboardService,
  ) {}

  @Get('dashboard')
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboard.summary(user);
  }

  @Get('audit')
  async audit(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const parsed = parseListQuery(query, FACTORY_AUDIT_COLUMNS);
    const { rows, total } = await this.svc.listAudit(user, parsed);
    return respondList(res, parsed, FACTORY_AUDIT_COLUMNS, rows, total, 'audit');
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const parsed = parseListQuery(query, FACTORY_SESSION_COLUMNS);
    const { rows, total } = await this.svc.listSessions(user, parsed);
    return respondList(res, parsed, FACTORY_SESSION_COLUMNS, rows, total, 'sessions');
  }

  @Post('sessions/:id/revoke')
  @HttpCode(204)
  revoke(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.svc.revokeSession(user, id);
  }
}
