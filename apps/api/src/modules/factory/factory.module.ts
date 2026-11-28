import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditSessionsController } from './audit-sessions.controller';
import { AuditSessionsService } from './audit-sessions.service';
import { CarriersController } from './carriers.controller';
import { CarriersService } from './carriers.service';
import { DailyFilesController } from './daily-files.controller';
import { DailyFilesService } from './daily-files.service';
import { FactoryDashboardService } from './dashboard.service';
import { FactoryDriversController } from './drivers.controller';
import { FactoryDriversService } from './drivers.service';
import { HallsController } from './halls.controller';
import { HallsService } from './halls.service';
import { MasterDataController } from './master-data.controller';
import { MasterDataService } from './master-data.service';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';

/**
 * Factory panel API: carriers, quotas, carrier users, halls/schedules/days, master data, policies, drivers, daily files, audit, sessions, dashboard.
 * OWNED BY AGENT D (Phase 2). Register this slice's controllers/providers here only.
 * Every route is @Roles('FACTORY_OPERATOR') and scoped by the session tenant.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    AuditSessionsController,
    CarriersController,
    DailyFilesController,
    FactoryDriversController,
    HallsController,
    MasterDataController,
    PoliciesController,
  ],
  providers: [
    AuditSessionsService,
    CarriersService,
    DailyFilesService,
    FactoryDashboardService,
    FactoryDriversService,
    HallsService,
    MasterDataService,
    PoliciesService,
  ],
})
export class FactoryModule {}
