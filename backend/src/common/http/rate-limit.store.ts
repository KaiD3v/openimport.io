import {
  Inject,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV } from '../../core/config/env.token.js';
import type { Env } from '../../core/config/env.js';
import {
  assertRateLimitKeySafe,
  buildRateLimitRedisKey,
} from './rate-limit.keys.js';
import type {
  RateLimitConsumeResult,
  RateLimitIdentity,
  RateLimitTier,
} from './rate-limit.types.js';

const CONSUME_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`;

@Injectable()
export class RateLimitStore implements OnModuleDestroy {
  private readonly redis: Redis;
  private connectPromise: Promise<void> | undefined;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 2_000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  async consume(
    tier: RateLimitTier,
    identity: RateLimitIdentity,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitConsumeResult> {
    const key = buildRateLimitRedisKey(tier, identity);
    assertRateLimitKeySafe(key);

    try {
      await this.ensureConnected();
      const raw = (await this.redis.eval(
        CONSUME_LUA,
        1,
        key,
        String(windowMs),
      )) as [number, number];
      const count = Number(raw[0]);
      const ttlMs = Number(raw[1]);
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((ttlMs > 0 ? ttlMs : windowMs) / 1000),
      );
      return {
        allowed: count <= limit,
        count,
        limit,
        retryAfterSeconds,
      };
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        (error &&
          typeof error === 'object' &&
          'status' in error &&
          (error as { status?: number }).status === 503)
      ) {
        throw error;
      }
      throw new ServiceUnavailableException({
        code: 'SERVICE.UNAVAILABLE',
        message: 'Service temporarily unavailable.',
      });
    }
  }

  /** Test helper: delete a specific key without SCAN/KEYS. */
  async deleteKey(
    tier: RateLimitTier,
    identity: RateLimitIdentity,
  ): Promise<void> {
    const key = buildRateLimitRedisKey(tier, identity);
    assertRateLimitKeySafe(key);
    await this.ensureConnected();
    await this.redis.del(key);
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'ready') {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.redis.connect().then(
        () => undefined,
        (error: unknown) => {
          this.connectPromise = undefined;
          throw error;
        },
      );
    }
    await this.connectPromise;
  }
}
