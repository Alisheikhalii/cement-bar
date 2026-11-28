import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { CarrierBulkService } from './carrier-bulk.service';
import { CarrierCancelService } from './carrier-cancel.service';
import { CarrierQueueController } from './carrier-queue.controller';
import { DriverLoadsService } from './driver-loads.service';
import { DriverQueueController } from './driver-queue.controller';
import { DriverQueueService } from './driver-queue.service';
import { DriverReservationsService } from './driver-reservations.service';
import { FactoryMonitorController } from './factory-monitor.controller';
import { FactoryMonitorService } from './factory-monitor.service';
import { QueueEngineService } from './queue-engine.service';
import { QueueSchedulerService } from './queue-scheduler.service';

/**
 * Phase 3 queue engine (SPEC §3/§4): bag allocation, bulk rotation, driver reservations, carrier
 * controls, factory monitoring and the idempotent scheduler. Realtime events are published through
 * RealtimeModule only AFTER transactions commit.
 */
@Module({
  imports: [RealtimeModule],
  controllers: [DriverQueueController, CarrierQueueController, FactoryMonitorController],
  providers: [
    QueueEngineService,
    DriverQueueService,
    DriverLoadsService,
    DriverReservationsService,
    CarrierBulkService,
    CarrierCancelService,
    FactoryMonitorService,
    QueueSchedulerService,
  ],
  exports: [QueueEngineService],
})
export class QueueModule {}
