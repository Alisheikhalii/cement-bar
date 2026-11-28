import { Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller';
import { RealtimePublisher } from './realtime.publisher';

/** Phase 3 realtime: SSE stream + pub/sub publisher (Redis-backed, multi-instance safe). */
@Module({
  controllers: [RealtimeController],
  providers: [RealtimePublisher],
  exports: [RealtimePublisher],
})
export class RealtimeModule {}
