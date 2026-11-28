import { Body, Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  driverProfileUpdateSchema,
  vehicleChangeRequestSchema,
  vehicleUpdateSchema,
  type DriverCompanyDto,
  type DriverDashboardDto,
  type DriverHallHoursDto,
  type DriverProfileDto,
  type DriverProfileUpdateInput,
  type DriverVehicleDto,
} from '@cb/shared';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { scopedDriver } from '../../common/auth/scoped';
import { ZodPipe } from '../../common/validation/zod';
import { DriverService, type VehicleChangeRequestInput, type VehicleUpdateInput } from './driver.service';
import { HallHoursService } from './hall-hours.service';

/**
 * Driver panel (non-queue). Every handler derives tenantId/driverId from the session (scopedDriver);
 * no route takes a driver id from params, query or body.
 */
@Roles('DRIVER')
@Controller('driver')
export class DriverController {
  constructor(
    private readonly drivers: DriverService,
    private readonly hallHours: HallHoursService,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser): Promise<DriverDashboardDto> {
    return this.drivers.dashboard(scopedDriver(user));
  }

  @Get('profile')
  profile(@CurrentUser() user: AuthUser): Promise<DriverProfileDto> {
    return this.drivers.profile(scopedDriver(user));
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(driverProfileUpdateSchema)) body: DriverProfileUpdateInput,
  ): Promise<DriverProfileDto> {
    return this.drivers.updateProfile(scopedDriver(user), body);
  }

  @Get('profile/vehicle')
  vehicle(@CurrentUser() user: AuthUser): Promise<DriverVehicleDto> {
    return this.drivers.vehicle(scopedDriver(user));
  }

  @Patch('profile/vehicle')
  updateVehicle(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(vehicleUpdateSchema)) body: VehicleUpdateInput,
  ): Promise<DriverVehicleDto> {
    return this.drivers.updateVehicle(scopedDriver(user), body);
  }

  @Post('profile/vehicle/change')
  @HttpCode(200)
  requestVehicleChange(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(vehicleChangeRequestSchema)) body: VehicleChangeRequestInput,
  ): Promise<DriverVehicleDto> {
    return this.drivers.requestVehicleChange(scopedDriver(user), body);
  }

  @Delete('profile/vehicle/change')
  withdrawVehicleChange(@CurrentUser() user: AuthUser): Promise<DriverVehicleDto> {
    return this.drivers.withdrawVehicleChange(scopedDriver(user));
  }

  @Get('companies')
  companies(@CurrentUser() user: AuthUser): Promise<DriverCompanyDto[]> {
    return this.drivers.companies(scopedDriver(user));
  }

  @Get('hall-hours')
  hours(@CurrentUser() user: AuthUser): Promise<DriverHallHoursDto> {
    return this.hallHours.forDriver(scopedDriver(user));
  }
}
