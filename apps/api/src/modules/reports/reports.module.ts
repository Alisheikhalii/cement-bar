import { Module } from '@nestjs/common';
import { CarrierModule } from '../carrier/carrier.module';
import { CarrierReportsController, FactoryReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Reports for carrier and factory: issued permits, aggregate, quota usage (xlsx via common/list).
 * OWNED BY AGENT F (Phase 2). Register this slice's controllers/providers here only.
 */
@Module({
  imports: [CarrierModule],
  controllers: [CarrierReportsController, FactoryReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
