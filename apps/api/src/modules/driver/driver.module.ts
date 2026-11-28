import { Module } from '@nestjs/common';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';
import { HallHoursService } from './hall-hours.service';

/**
 * Driver panel API (non-queue): dashboard, profile, vehicle, companies, hall hours.
 * OWNED BY AGENT G (Phase 2). Register this slice's controllers/providers here only.
 */
@Module({ controllers: [DriverController], providers: [DriverService, HallHoursService] })
export class DriverModule {}
