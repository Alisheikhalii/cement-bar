import { Module } from '@nestjs/common';
import { AnnouncementQueryService } from './announcement-query.service';
import { AnnouncementRefsService } from './announcement-refs.service';
import { CarrierAnnouncementsController, FactoryAnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';
import { IdempotencyService } from './idempotency';
import { UnitAllocationService } from './unit-allocation.service';

/**
 * Announcements + load units (carrier CRUD, copy, cancel, allocation changes, quota check) and the factory read-only list.
 * OWNED BY AGENT E (Phase 2). Register this slice's controllers/providers here only.
 */
@Module({
  controllers: [CarrierAnnouncementsController, FactoryAnnouncementsController],
  providers: [
    AnnouncementsService,
    AnnouncementQueryService,
    AnnouncementRefsService,
    UnitAllocationService,
    IdempotencyService,
  ],
})
export class AnnouncementsModule {}
