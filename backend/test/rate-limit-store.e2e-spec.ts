import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { RateLimitStore } from '../src/common/http/rate-limit.store.js';
import { buildRateLimitRedisKey } from '../src/common/http/rate-limit.keys.js';
import type { Env } from '../src/core/config/env.js';
import {
  assertE2eRedisUrl,
  forceE2eRedisEnv,
} from './helpers/e2e-redis.js';

describe('RateLimitStore Redis (e2e DB 15)', () => {
  let storeA: RateLimitStore;
  let storeB: RateLimitStore;
  let redis: Redis;
  const identity = {
    kind: 'apiKey' as const,
    organizationId: `org-${Date.now()}`,
    apiKeyId: `key-${Date.now()}`,
  };

  beforeAll(async () => {
    const redisUrl = forceE2eRedisEnv();
    assertE2eRedisUrl(redisUrl);
    const env = { REDIS_URL: redisUrl } as Env;
    storeA = new RateLimitStore(env);
    storeB = new RateLimitStore(env);
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
  });

  afterAll(async () => {
    await storeA.deleteKey('general', identity);
    await storeA.onModuleDestroy();
    await storeB.onModuleDestroy();
    await redis.quit();
  });

  it('shares counters across two store instances', async () => {
    const windowMs = 60_000;
    const limit = 3;
    const first = await storeA.consume('general', identity, limit, windowMs);
    const second = await storeB.consume('general', identity, limit, windowMs);
    const third = await storeA.consume('general', identity, limit, windowMs);
    const fourth = await storeB.consume('general', identity, limit, windowMs);

    expect(first).toMatchObject({ allowed: true, count: 1 });
    expect(second).toMatchObject({ allowed: true, count: 2 });
    expect(third).toMatchObject({ allowed: true, count: 3 });
    expect(fourth).toMatchObject({ allowed: false, count: 4 });
  });

  it('expires buckets with TTL without permanent accumulation', async () => {
    const shortIdentity = {
      kind: 'ip' as const,
      ip: `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
    };
    const result = await storeA.consume('pre_auth', shortIdentity, 1, 200);
    expect(result.allowed).toBe(true);

    const key = buildRateLimitRedisKey('pre_auth', shortIdentity);
    const ttl = await redis.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(200);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(await redis.exists(key)).toBe(0);

    const after = await storeA.consume('pre_auth', shortIdentity, 1, 200);
    expect(after).toMatchObject({ allowed: true, count: 1 });
  });

  it('fails closed with 503 when Redis is unreachable', async () => {
    const broken = new RateLimitStore({
      REDIS_URL: 'redis://127.0.0.1:1',
    } as Env);
    try {
      await broken.consume('general', identity, 1, 1000);
      expect.unreachable('expected ServiceUnavailableException');
    } catch (error) {
      expect(error).toMatchObject({
        response: expect.objectContaining({
          code: 'SERVICE.UNAVAILABLE',
        }),
        status: 503,
      });
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('6379');
      expect(message).not.toMatch(/password/i);
    } finally {
      await broken.onModuleDestroy();
    }
  });
});
