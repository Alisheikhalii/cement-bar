import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  FACTORY_CARRIER_COLUMNS,
  carrierCreateSchema,
  carrierQuotaUpsertSchema,
  carrierUpdateSchema,
  carrierUserCreateSchema,
  resetPasswordSchema,
  userStatusSchema,
  type CarrierCreateInput,
  type CarrierQuotaUpsertInput,
  type CarrierUserCreateInput,
} from '@cb/shared';
import type { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { parseListQuery } from '../../common/list/list-query';
import { respondList } from '../../common/list/list-response';
import { ZodPipe } from '../../common/validation/zod';
import { CarriersService } from './carriers.service';
import { parsePatch, UuidPipe } from './factory.util';

@Roles('FACTORY_OPERATOR')
@Controller('factory/carriers')
export class CarriersController {
  constructor(private readonly carriers: CarriersService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const parsed = parseListQuery(query, FACTORY_CARRIER_COLUMNS);
    const { rows, total } = await this.carriers.list(user, parsed);
    return respondList(res, parsed, FACTORY_CARRIER_COLUMNS, rows, total, 'carriers');
  }

  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.carriers.options(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(carrierCreateSchema)) body: CarrierCreateInput) {
    return this.carriers.create(user, body);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.carriers.detail(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body() body: unknown) {
    return this.carriers.update(user, id, parsePatch(carrierUpdateSchema, body));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.carriers.remove(user, id);
  }

  @Get(':id/users')
  users(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.carriers.listUsers(user, id);
  }

  @Post(':id/users')
  createUser(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(carrierUserCreateSchema)) body: CarrierUserCreateInput,
  ) {
    return this.carriers.createUser(user, id, body);
  }

  @Post(':id/users/:userId/reset-password')
  @HttpCode(204)
  resetPassword(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Param('userId', UuidPipe) userId: string,
    @Body(new ZodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>,
  ) {
    return this.carriers.resetPassword(user, id, userId, body.newPassword);
  }

  @Patch(':id/users/:userId/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Param('userId', UuidPipe) userId: string,
    @Body(new ZodPipe(userStatusSchema)) body: z.infer<typeof userStatusSchema>,
  ) {
    return this.carriers.setUserActive(user, id, userId, body.active);
  }

  @Get(':id/quotas')
  quotas(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.carriers.listQuotas(user, id);
  }

  @Put(':id/quotas')
  upsertQuota(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(carrierQuotaUpsertSchema)) body: CarrierQuotaUpsertInput,
  ) {
    return this.carriers.upsertQuota(user, id, body);
  }
}
