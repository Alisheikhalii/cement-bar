import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

// Fixed-window counter: INCR, set expiry on first hit, return hits + remaining ms.
const INCR_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {hits, ttl}
`;

/** Redis-backed storage for @nestjs/throttler so limits are shared across API instances. */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'rl:',
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `${this.prefix}${throttlerName}:${key}`;
    const res = (await this.redis.eval(INCR_SCRIPT, 1, redisKey, String(ttl))) as [number, number];
    const [hits, ttlMs] = res;
    const seconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const isBlocked = hits > limit;
    return { totalHits: hits, timeToExpire: seconds, isBlocked, timeToBlockExpire: isBlocked ? seconds : 0 };
  }
}
