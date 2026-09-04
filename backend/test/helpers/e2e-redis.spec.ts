import { describe, expect, it } from 'vitest';
import { IMPORT_PROCESSING_QUEUE } from '../../src/modules/import/processing/import-processing.queue.js';
import {
  assertE2eRedisUrl,
  assertIsolationProbeQueueName,
  createIsolationProbeQueueName,
  E2E_REDIS_DATABASE,
  forceE2eRedisEnv,
  ISOLATION_PROBE_QUEUE_PREFIX,
  obliterateE2eImportQueue,
  parseRedisDatabase,
  redisUrlWithoutCredentials,
  rethrowProbeTestAndCleanupErrors,
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

  it('creates isolation probe queue names that never match the operational queue', () => {
    const name = createIsolationProbeQueueName();
    expect(name.startsWith(`${ISOLATION_PROBE_QUEUE_PREFIX}-`)).toBe(true);
    expect(name).not.toBe(IMPORT_PROCESSING_QUEUE);
    expect(() => assertIsolationProbeQueueName(name)).not.toThrow();
    expect(() =>
      assertIsolationProbeQueueName(IMPORT_PROCESSING_QUEUE),
    ).toThrow(/Isolation probe queue/);
  });

  describe('rethrowProbeTestAndCleanupErrors', () => {
    it('returns without throwing when neither error is present', () => {
      expect(() =>
        rethrowProbeTestAndCleanupErrors(undefined, undefined),
      ).not.toThrow();
    });

    it('rethrows only the assertion error when cleanup succeeded', () => {
      const assertionError = new Error('assertion failed');
      expect(() =>
        rethrowProbeTestAndCleanupErrors(assertionError, undefined),
      ).toThrow(assertionError);
    });

    it('rethrows only the cleanup error when the test succeeded', () => {
      const cleanupError = new Error('cleanup failed');
      expect(() =>
        rethrowProbeTestAndCleanupErrors(undefined, cleanupError),
      ).toThrow(cleanupError);
    });

    it('aggregates both errors with assertion first when both fail', () => {
      const assertionError = new Error('assertion failed');
      const cleanupError = new Error('cleanup failed');
      try {
        rethrowProbeTestAndCleanupErrors(assertionError, cleanupError);
        expect.unreachable('expected AggregateError');
      } catch (error) {
        expect(error).toBeInstanceOf(AggregateError);
        const aggregate = error as AggregateError;
        expect(aggregate.message).toMatch(/test and cleanup both failed/i);
        expect(aggregate.errors).toHaveLength(2);
        expect(aggregate.errors[0]).toBe(assertionError);
        expect(aggregate.errors[1]).toBe(cleanupError);
      }
    });
  });
});
