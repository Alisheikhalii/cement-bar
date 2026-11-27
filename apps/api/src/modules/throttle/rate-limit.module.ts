import { ExecutionContext, Module } from '@nestjs/common';
import { ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import { RATE_LIMITS } from '../../config/app-config';
import { RATE_BUCKET, type RateBucket } from '../../common/auth/auth.decorators';
import { RedisService } from '../../common/redis/redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

function bucketOf(ctx: ExecutionContext): RateBucket | undefined {
  return Reflect.getMetadata(RATE_BUCKET, ctx.getHandler()) as RateBucket | undefined;
}

function ipOf(req: Record<string, unknown>): string {
  const r = req as unknown as Request;
  return r.ip ?? r.socket?.remoteAddress ?? 'unknown';
}

function identifierOf(req: Record<string, unknown>): string {
  const body = (req as unknown as Request).body as { identifier?: unknown } | undefined;
  const id = typeof body?.identifier === 'string' ? body.identifier.trim().toLowerCase() : '';
  return id.slice(0, 64);
}

export function throttlerOptions(redis: RedisService): ThrottlerModuleOptions {
  return {
    storage: new RedisThrottlerStorage(redis.client),
    throttlers: [
      {
        name: 'global',
        ttl: RATE_LIMITS.global.ttlMs,
        limit: RATE_LIMITS.global.limit,
        getTracker: (req) => ipOf(req),
        generateKey: (_ctx, tracker) => tracker,
      },
      {
        name: 'login',
        ttl: RATE_LIMITS.login.ttlMs,
        limit: RATE_LIMITS.login.limit,
        skipIf: (ctx) => bucketOf(ctx) !== 'login',
        getTracker: (req) => `${ipOf(req)}|${identifierOf(req)}`,
        generateKey: (_ctx, tracker) => tracker,
      },
      {
        name: 'register',
        ttl: RATE_LIMITS.register.ttlMs,
        limit: RATE_LIMITS.register.limit,
        skipIf: (ctx) => bucketOf(ctx) !== 'register',
        getTracker: (req) => ipOf(req),
        generateKey: (_ctx, tracker) => tracker,
      },
    ],
  };
}

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => throttlerOptions(redis),
    }),
  ],
})
export class RateLimitModule {}
