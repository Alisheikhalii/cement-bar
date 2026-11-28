import { Module } from '@nestjs/common';
import { CarrierDailyFilesController } from './daily-files.controller';
import { CarrierDailyFilesService } from './daily-files.service';
import { CarrierDashboardController, CarrierDashboardService } from './dashboard.service';
import { CarrierDriversController } from './drivers.controller';
import { CarrierDriversService } from './drivers.service';
import { CarrierMasterDataController } from './master-data.controller';
import { CarrierMasterDataService } from './master-data.service';
import { PermitRowsService } from './permit-rows.service';
import { CarrierPermitsController } from './permits.controller';
import { CarrierPermitsService } from './permits.service';

/**
 * Carrier panel API (except announcements): dashboard, drivers approval, master data, daily files, permits.
 * OWNED BY AGENT F (Phase 2). Register this slice's controllers/providers here only.
 * Exports PermitRowsService for the reports module.
 */
@Module({
  controllers: [
    CarrierDashboardController,
    CarrierDriversController,
    CarrierMasterDataController,
    CarrierDailyFilesController,
    CarrierPermitsController,
  ],
  providers: [
    CarrierDashboardService,
    CarrierDriversService,
    CarrierMasterDataService,
    CarrierDailyFilesService,
    CarrierPermitsService,
    PermitRowsService,
  ],
  exports: [PermitRowsService],
})
export class CarrierModule {}
