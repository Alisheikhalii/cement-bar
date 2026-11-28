import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { QueueSseEvent } from '@cb/shared';
import { CurrentUser, type AuthUser } from '../../common/auth/auth.decorators';
import { RedisService } from '../../common/redis/redis.service';
import { QUEUE_EVENT_CHANNEL } from './realtime.publisher';

const HEARTBEAT_MS = 25_000;

/**
 * GET /api/events — Server-Sent Events stream (cookie auth). Each connection subscribes to the
 * Redis channel on its own duplicated connection and re-emits only events of its tenant, and
 * `userId`-targeted events only to that user (SPEC §4 Realtime).
 */
@Controller()
export class RealtimeController {
  constructor(private readonly redis: RedisService) {}

  @Get('events')
  events(@CurrentUser() user: AuthUser, @Req() req: { on: (e: string, cb: () => void) => void; socket?: unknown }, @Res() res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(': connected\n\n');
    const sub = this.redis.client.duplicate();
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        cleanup();
      }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    let closed = false;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      try {
        sub.disconnect();
      } catch {
        // ignore
      }
    };

    sub.on('message', (_channel: string, message: string) => {
      let event: QueueSseEvent;
      try {
        event = JSON.parse(message) as QueueSseEvent;
      } catch {
        return;
      }
      if (event.tenantId !== user.tenantId) return;
      if (event.userId && event.userId !== user.id) return;
      try {
        res.write(`event: ${event.type}\ndata: ${message}\n\n`);
      } catch {
        cleanup();
      }
    });
    sub.subscribe(QUEUE_EVENT_CHANNEL).catch(cleanup);

    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('finish', cleanup);
  }
}
