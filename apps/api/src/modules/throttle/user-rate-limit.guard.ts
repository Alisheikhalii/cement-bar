import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClockService } from '../../common/clock/clock.service';
import { RATE_BUCKET, type AuthedRequest, type RateBucket } from '../../common/auth/auth.decorators';
import { RATE_LIMITS } from '../../config/app-config';
import { RedisService } from '../../common/redis/redis.service';

type UserBucket = Extract<RateBucket, 'turn' | 'reserve'>;

function isUserBucket(bucket: RateBucket | undefined): bucket is UserBucket {
  return bucket === 'turn' || bucket === 'reserve';
}

/**
 * Per-driver fixed-window limiter for the hot queue endpoints (SPEC §6: 5 req/s per driver).
 * Runs AFTER AuthGuard, so the tracker is the authenticated user id (not a shared CGNAT IP).
 * The global ThrottlerGuard keeps protecting the IP level; this guard cannot be bypassed by
 * spoofing headers because `user.id` comes from the verified session.
 */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly clock: ClockService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bucket = this.reflector.get<RateBucket | undefined>(RATE_BUCKET, context.getHandler());
    if (!isUserBucket(bucket)) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const userId = req.user?.id;
    if (!userId) return true; // AuthGuard rejects unauthenticated requests.
    const { ttlMs, limit } = RATE_LIMITS[bucket];
    const window = Math.floor(this.clock.now().getTime() / ttlMs);
    const key = `cb:rl:${bucket}:${userId}:${window}`;
    const hits = await this.redis.client.incr(key);
    if (hits === 1) await this.redis.client.pexpire(key, ttlMs);
    if (hits > limit) throw new HttpException('RATE_LIMITED', 429);
    return true;
  }
}
