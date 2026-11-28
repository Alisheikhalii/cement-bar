import { Injectable } from '@nestjs/common';
import type { QueueSseEvent } from '@cb/shared';
import { RedisService } from '../../common/redis/redis.service';

/** Single Redis pub/sub channel carrying queue SSE events between API instances. */
export const QUEUE_EVENT_CHANNEL = 'cb:queue-events';

/**
 * Publishes queue events (unit.reserved / unit.freed / window.changed / notification). Services must
 * call this AFTER their transaction commits (never inside a tx).
 */
@Injectable()
export class RealtimePublisher {
  constructor(private readonly redis: RedisService) {}

  async publish(event: QueueSseEvent): Promise<void> {
    try {
      await this.redis.client.publish(QUEUE_EVENT_CHANNEL, JSON.stringify(event));
    } catch {
      // Realtime is best-effort; a Redis hiccup must not fail the committed operation.
    }
  }

  async publishAll(events: readonly QueueSseEvent[]): Promise<void> {
    for (const e of events) await this.publish(e);
  }
}
