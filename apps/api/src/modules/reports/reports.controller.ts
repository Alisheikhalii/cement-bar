import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AGGREGATE_COLUMNS, PERMIT_COLUMNS, QUOTA_USAGE_COLUMNS, type ReportCarrierOptionDto } from '@cb/shared';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { scopedCarrier, scopedTenant } from '../../common/auth/scoped';
import { parseListQuery } from '../../common/list/list-query';
import { respondList } from '../../common/list/list-response';
import { parseView } from '../carrier/permits.controller';
import { ReportsService, parseCarrierFilter, parseDateRange, type ReportScope } from './reports.service';

type Q = Record<string, unknown>;

/** Shared handlers; the scope is built from the session by each controller. */
abstract class ReportsHandlers {
  constructor(protected readonly reports: ReportsService) {}

  protected async permits(scope: ReportScope, query: Q, res: Response, allow: string[]) {
    const parsed = parseListQuery(query, PERMIT_COLUMNS, { allowParams: ['view', ...allow] });
    const { rows, total } = await this.reports.permits(scope, parsed, parseView(query.view));
    return respondList(res, parsed, PERMIT_COLUMNS, rows, total, 'issued-permits');
  }

  protected async aggregate(scope: ReportScope, query: Q, res: Response, allow: string[]) {
    const parsed = parseListQuery(query, AGGREGATE_COLUMNS, { allowParams: ['from', 'to', ...allow] });
    const { rows, total } = await this.reports.aggregate(scope, parseDateRange(query), parsed);
    return respondList(res, parsed, AGGREGATE_COLUMNS, rows, total, 'aggregate');
  }

  protected async quota(scope: ReportScope, query: Q, res: Response, allow: string[]) {
    const parsed = parseListQuery(query, QUOTA_USAGE_COLUMNS, { allowParams: ['yearMonth', ...allow] });
    const { rows, total } = await this.reports.quotaUsage(scope, query.yearMonth, parsed);
    return respondList(res, parsed, QUOTA_USAGE_COLUMNS, rows, total, 'quota-usage');
  }
}

/** /carrier/reports/* (US-B11): only the caller's own carrier. */
@Roles('CARRIER_OPERATOR')
@Controller('carrier/reports')
export class CarrierReportsController extends ReportsHandlers {
  constructor(reports: ReportsService) {
    super(reports);
  }

  @Get('permits')
  permitsReport(@CurrentUser() user: AuthUser, @Query() query: Q, @Res({ passthrough: true }) res: Response) {
    return this.permits(scopedCarrier(user), query, res, []);
  }

  @Get('aggregate')
  aggregateReport(@CurrentUser() user: AuthUser, @Query() query: Q, @Res({ passthrough: true }) res: Response) {
    return this.aggregate(scopedCarrier(user), query, res, []);
  }

  @Get('quota')
  quotaReport(@CurrentUser() user: AuthUser, @Query() query: Q, @Res({ passthrough: true }) res: Response) {
    return this.quota(scopedCarrier(user), query, res, []);
  }
}

/** /factory/reports/* (US-F9): the whole tenant, optionally filtered by `carrierId` (tenant-scoped). */
@Roles('FACTORY_OPERATOR')
@Controller('factory/reports')
export class FactoryReportsController extends ReportsHandlers {
  constructor(reports: ReportsService) {
    super(reports);
  }

  private scope(user: AuthUser, query: Q): ReportScope {
    return { tenantId: scopedTenant(user).tenantId, carrierId: parseCarrierFilter(query.carrierId) };
  }

  @Get('carriers')
  carriers(@CurrentUser() user: AuthUser): Promise<ReportCarrierOptionDto[]> {
    return this.reports.carrierOptions(scopedTenant(user).tenantId);
  }

  @Get('permits')
  permitsReport(@CurrentUser() user: AuthUser, @Query() query: Q, @Res({ passthrough: true }) res: Response) {
    return this.permits(this.scope(user, query), query, res, ['carrierId']);
  }

  @Get('aggregate')
  aggregateReport(@CurrentUser() user: AuthUser, @Query() query: Q, @Res({ passthrough: true }) res: Response) {
    return this.aggregate(this.scope(user, query), query, res, ['carrierId']);
  }

  @Get('quota')
  quotaReport(@CurrentUser() user: AuthUser, @Query() query: Q, @Res({ passthrough: true }) res: Response) {
    return this.quota(this.scope(user, query), query, res, ['carrierId']);
  }
}
