import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import {
  ANNOUNCEMENT_COLUMNS,
  announcementInputSchema,
  reasonSchema,
  unitAllocationChangeSchema,
  unitsAllocationBulkSchema,
  type AllocationChangeResultDto,
  type AnnouncementDetailDto,
  type AnnouncementInput,
  type AnnouncementLookupsDto,
  type AnnouncementSummaryDto,
  type Paginated,
  type ReasonInput,
  type TableRow,
  type UnitAllocationChangeInput,
} from '@cb/shared';
import type { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { scopedCarrier, scopedTenant } from '../../common/auth/scoped';
import { DomainError } from '../../common/errors/domain-error';
import { parseListQuery } from '../../common/list/list-query';
import { respondList } from '../../common/list/list-response';
import { parseWith, ZodPipe } from '../../common/validation/zod';
import { AnnouncementQueryService, parseView } from './announcement-query.service';
import { AnnouncementRefsService } from './announcement-refs.service';
import { AnnouncementsService } from './announcements.service';
import { IdempotencyService } from './idempotency';
import { UnitAllocationService } from './unit-allocation.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Malformed ids are indistinguishable from foreign ones (404, no existence leak). */
export function uuidParam(v: string): string {
  if (!UUID_RE.test(v)) throw new DomainError('NOT_FOUND');
  return v;
}

const isEmptyBody = (b: unknown) =>
  b === undefined || b === null || (typeof b === 'object' && !Array.isArray(b) && Object.keys(b).length === 0);

/** /carrier/announcements — carrierId/tenantId only from the session (CLAUDE.md §1.3). */
@Roles('CARRIER_OPERATOR')
@Controller('carrier/announcements')
export class CarrierAnnouncementsController {
  constructor(
    private readonly service: AnnouncementsService,
    private readonly query: AnnouncementQueryService,
    private readonly refs: AnnouncementRefsService,
    private readonly allocation: UnitAllocationService,
    private readonly idem: IdempotencyService,
  ) {}

  @Get('lookups')
  lookups(@CurrentUser() user: AuthUser): Promise<AnnouncementLookupsDto> {
    return this.refs.lookups(scopedCarrier(user));
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query('view') view: unknown): Promise<AnnouncementSummaryDto> {
    return this.query.summary(scopedCarrier(user), parseView(view));
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() raw: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Paginated<TableRow> | StreamableFile> {
    const parsed = parseListQuery(raw, ANNOUNCEMENT_COLUMNS, { allowParams: ['view'] });
    const { rows, total } = await this.query.list(scopedCarrier(user), parseView(raw.view), parsed);
    return respondList(res, parsed, ANNOUNCEMENT_COLUMNS, rows, total, 'announcements');
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AnnouncementDetailDto> {
    return this.query.detail(scopedCarrier(user), uuidParam(id));
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(announcementInputSchema)) body: AnnouncementInput,
    @Headers('idempotency-key') key?: string,
  ): Promise<AnnouncementDetailDto> {
    const id = await this.idem.run(`ann:create:${user.id}`, key, () => this.service.create(user, body));
    return this.query.detail(scopedCarrier(user), id);
  }

  @Put(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(announcementInputSchema)) body: AnnouncementInput,
  ): Promise<AnnouncementDetailDto> {
    await this.service.update(user, uuidParam(id), body);
    return this.query.detail(scopedCarrier(user), id);
  }

  /** Body = the (edited) prefilled form, or empty for a server-side clone dated today. */
  @Post(':id/copy')
  async copy(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('idempotency-key') key?: string,
  ): Promise<AnnouncementDetailDto> {
    const src = uuidParam(id);
    const input = isEmptyBody(raw) ? null : parseWith(announcementInputSchema, raw);
    const newId = await this.idem.run(`ann:copy:${user.id}`, key, () => this.service.copy(user, src, input));
    return this.query.detail(scopedCarrier(user), newId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(reasonSchema)) body: ReasonInput,
  ): Promise<AnnouncementDetailDto> {
    await this.service.cancel(user, uuidParam(id), body.reason);
    return this.query.detail(scopedCarrier(user), id);
  }

  @Patch(':id/units/allocation')
  changeMany(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(unitsAllocationBulkSchema)) body: z.infer<typeof unitsAllocationBulkSchema>,
  ): Promise<AllocationChangeResultDto> {
    return this.allocation.change(user, uuidParam(id), body.unitIds, body.to, body.reason);
  }

  @Patch(':id/units/:unitId/allocation')
  changeOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('unitId') unitId: string,
    @Body(new ZodPipe(unitAllocationChangeSchema)) body: UnitAllocationChangeInput,
  ): Promise<AllocationChangeResultDto> {
    return this.allocation.change(user, uuidParam(id), [uuidParam(unitId)], body.to, body.reason);
  }
}

/** /factory/announcements — read-only, tenant-wide (factory monitor uses the same columns/export). */
@Roles('FACTORY_OPERATOR')
@Controller('factory/announcements')
export class FactoryAnnouncementsController {
  constructor(private readonly query: AnnouncementQueryService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query('view') view: unknown): Promise<AnnouncementSummaryDto> {
    return this.query.summary(scopedTenant(user), parseView(view));
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() raw: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Paginated<TableRow> | StreamableFile> {
    const parsed = parseListQuery(raw, ANNOUNCEMENT_COLUMNS, { allowParams: ['view'] });
    const { rows, total } = await this.query.list(scopedTenant(user), parseView(raw.view), parsed);
    return respondList(res, parsed, ANNOUNCEMENT_COLUMNS, rows, total, 'announcements');
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AnnouncementDetailDto> {
    return this.query.detail(scopedTenant(user), uuidParam(id));
  }
}
