import { describe, expect, it } from 'vitest';
import {
  assertE2eRedisUrl,
  E2E_REDIS_DATABASE,
  forceE2eRedisEnv,
  obliterateE2eImportQueue,
  parseRedisDatabase,
  redisUrlWithoutCredentials,
} from './e2e-redis.js';

describe('e2e Redis isolation helpers', () => {
  it('treats a bare redis URL as database 0 (development)', () => {
    expect(parseRedisDatabase('redis://localhost:6379')).toBe(0);
    expect(parseRedisDatabase('redis://localhost:6379/')).toBe(0);
    expect(parseRedisDatabase('redis://localhost:6379/0')).toBe(0);
  });

  it('parses the E2E logical database from the URL path', () => {
    expect(parseRedisDatabase('redis://localhost:6379/15')).toBe(
      E2E_REDIS_DATABASE,
    );
  });

  it('accepts only the dedicated E2E database', () => {
    expect(assertE2eRedisUrl('redis://localhost:6379/15')).toBe(15);
  });

  it('refuses development database 0 and other non-E2E databases', () => {
    expect(() => assertE2eRedisUrl('redis://localhost:6379')).toThrow(
      /database 15/i,
    );
    expect(() => assertE2eRedisUrl('redis://localhost:6379/0')).toThrow(
      /database 15/i,
    );
    expect(() => assertE2eRedisUrl('redis://localhost:6379/1')).toThrow(
      /database 15/i,
    );
  });

  it('redacts credentials when formatting Redis URLs for errors', () => {
    const safe = redisUrlWithoutCredentials(
      'redis://user:supersecret@localhost:6379/15',
    );
    expect(safe).toContain('localhost:6379/15');
    expect(safe).not.toContain('supersecret');
    expect(safe).not.toContain('user:');
  });

  it('forceE2eRedisEnv overwrites an ambient development REDIS_URL', () => {
    process.env.REDIS_URL = 'redis://localhost:6379/0';
    expect(forceE2eRedisEnv()).toBe('redis://localhost:6379/15');
    expect(process.env.REDIS_URL).toBe('redis://localhost:6379/15');
  });

  it('refuses to obliterate when the URL is not the E2E database', async () => {
    await expect(
      obliterateE2eImportQueue('redis://localhost:6379/0'),
    ).rejects.toThrow(/database 15/i);
  });
});
