import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';
import { RedisService } from '../../common/redis/redis.service';

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const TTL_SECONDS = 24 * 60 * 60;
const PENDING = 'pending';

/**
 * Optional `Idempotency-Key` for create/copy: the first request with a key runs, a repeat returns the same
 * resource id; a repeat while the first is still running gets 409 CONFLICT. Without a key nothing changes.
 * Redis I/O is outside the DB transaction (GUIDELINES §1.2).
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly redis: RedisService) {}

  async run(scope: string, key: string | undefined, fn: () => Promise<string>): Promise<string> {
    if (key === undefined || key === '') return fn();
    if (!KEY_RE.test(key)) {
      throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'Idempotency-Key', message: 'invalid key' }] });
    }
    const k = `idem:${scope}:${key}`;
    const claimed = await this.redis.client.set(k, PENDING, 'EX', TTL_SECONDS, 'NX');
    if (claimed !== 'OK') {
      const v = await this.redis.client.get(k);
      if (!v || v === PENDING) throw new DomainError('CONFLICT');
      return v;
    }
    try {
      const id = await fn();
      await this.redis.client.set(k, id, 'EX', TTL_SECONDS);
      return id;
    } catch (e) {
      await this.redis.client.del(k).catch(() => undefined);
      throw e;
    }
  }
}
