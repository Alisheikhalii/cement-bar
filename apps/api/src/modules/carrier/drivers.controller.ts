import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  CARRIER_DRIVER_COLUMNS,
  driverBlockSchema,
  driverDecisionSchema,
  vehicleChangeDecisionSchema,
  type CarrierDriverDetailDto,
  type DriverDecisionInput,
} from '@cb/shared';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { parseListQuery } from '../../common/list/list-query';
import { respondList } from '../../common/list/list-response';
import { ZodPipe } from '../../common/validation/zod';
import { CarrierDriversService, type DriverBlockInput } from './drivers.service';

@Roles('CARRIER_OPERATOR')
@Controller('carrier/drivers')
export class CarrierDriversController {
  constructor(private readonly drivers: CarrierDriversService) {}

  /** List with `?vehicleChange=true` to show only drivers with a pending vehicle change. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const parsed = parseListQuery(query, CARRIER_DRIVER_COLUMNS, { allowParams: ['vehicleChange'] });
    const { rows, total } = await this.drivers.list(user, parsed, { vehicleChange: query.vehicleChange === 'true' });
    return respondList(res, parsed, CARRIER_DRIVER_COLUMNS, rows, total, 'drivers');
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<CarrierDriverDetailDto> {
    return this.drivers.detail(user, id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(driverDecisionSchema)) body: DriverDecisionInput) {
    return this.drivers.decide(user, id, body);
  }

  @Post(':id/block')
  @HttpCode(200)
  block(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(driverBlockSchema)) body: DriverBlockInput) {
    return this.drivers.block(user, id, body);
  }

  @Post(':id/vehicle-change')
  @HttpCode(200)
  vehicleChange(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(vehicleChangeDecisionSchema)) body: DriverDecisionInput,
  ) {
    return this.drivers.decideVehicleChange(user, id, body);
  }
}
