import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { CarrierMasterOptionDto, CarrierMasterRecordDto } from '@cb/shared';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { parseListQuery } from '../../common/list/list-query';
import { respondList } from '../../common/list/list-response';
import { CarrierMasterDataService } from './master-data.service';

/** /carrier/master/{parties,goods-owners,loading-locations,cargo-descriptions,loading-conditions} (US-B10). */
@Roles('CARRIER_OPERATOR')
@Controller('carrier/master/:kind')
export class CarrierMasterDataController {
  constructor(private readonly master: CarrierMasterDataService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const def = this.master.kind(kind);
    const parsed = parseListQuery(query, def.columns);
    const { rows, total } = await this.master.list(user, kind, parsed);
    return respondList(res, parsed, def.columns, rows, total, kind);
  }

  /** Compact {id,label} list for form selects (own + shared rows). */
  @Get('options')
  options(@CurrentUser() user: AuthUser, @Param('kind') kind: string, @Query('q') q?: string): Promise<CarrierMasterOptionDto[]> {
    return this.master.options(user, kind, typeof q === 'string' ? q : undefined);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('kind') kind: string, @Param('id') id: string): Promise<CarrierMasterRecordDto> {
    return this.master.get(user, kind, id);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Param('kind') kind: string, @Body() body: unknown) {
    return this.master.create(user, kind, body);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('kind') kind: string, @Param('id') id: string, @Body() body: unknown) {
    return this.master.update(user, kind, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('kind') kind: string, @Param('id') id: string): Promise<void> {
    await this.master.remove(user, kind, id);
  }
}
