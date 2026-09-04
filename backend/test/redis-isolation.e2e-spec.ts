import { Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { IMPORT_PROCESSING_QUEUE } from '../src/modules/import/processing/import-processing.queue.js';
import {
  assertE2eRedisUrl,
  assertIsolationProbeQueueName,
  createIsolationProbeQueueName,
  DEVELOPMENT_REDIS_URL,
  E2E_REDIS_DATABASE,
  E2E_REDIS_URL,
  forceE2eRedisEnv,
  ISOLATION_PROBE_QUEUE_PREFIX,
  obliterateE2eImportQueue,
  rethrowProbeTestAndCleanupErrors,
} from './helpers/e2e-redis.js';

const developmentRedisUrl = DEVELOPMENT_REDIS_URL;
const e2eRedisUrl = E2E_REDIS_URL;

async function disposeProbeQueues(
  queues: Queue[],
): Promise<void> {
  const cleanupErrors: unknown[] = [];
  for (const queue of queues) {
    try {
      await queue.obliterate({ force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await queue.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      'Failed to clean exclusive isolation probe queues',
    );
  }
}

describe('BullMQ Redis namespace isolation (e2e)', () => {
  it('uses a dedicated E2E Redis database distinct from development', () => {
    expect(forceE2eRedisEnv()).toBe(E2E_REDIS_URL);
    expect(assertE2eRedisUrl(e2eRedisUrl)).toBe(E2E_REDIS_DATABASE);
    expect(e2eRedisUrl).not.toBe(developmentRedisUrl);
  });

  it('probes use an exclusive queue name, never the operational import queue', () => {
    const probeQueueName = createIsolationProbeQueueName();
    expect(probeQueueName).toMatch(
      new RegExp(`^${ISOLATION_PROBE_QUEUE_PREFIX}-`),
    );
    expect(probeQueueName).not.toBe(IMPORT_PROCESSING_QUEUE);
    expect(() => assertIsolationProbeQueueName(probeQueueName)).not.toThrow();
    expect(() =>
      assertIsolationProbeQueueName(IMPORT_PROCESSING_QUEUE),
    ).toThrow(/Isolation probe queue/);
  });

  it('keeps exclusive-queue jobs on DB 0 and DB 15 invisible to each other', async () => {
    const probeQueueName = createIsolationProbeQueueName();
    assertIsolationProbeQueueName(probeQueueName);
    expect(probeQueueName).not.toBe(IMPORT_PROCESSING_QUEUE);

    const local = new Queue(probeQueueName, {
      connection: { url: developmentRedisUrl, maxRetriesPerRequest: null },
    });
    const e2e = new Queue(probeQueueName, {
      connection: { url: e2eRedisUrl, maxRetriesPerRequest: null },
    });
    const queues = [local, e2e];

    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const localJobId = `isolation-local-${stamp}`;
    const e2eJobId = `isolation-e2e-${stamp}`;

    let assertionError: unknown;
    try {
      await local.add('isolation-probe', { kind: 'local' }, { jobId: localJobId });
      await e2e.add('isolation-probe', { kind: 'e2e' }, { jobId: e2eJobId });

      expect(await e2e.getJob(localJobId)).toBeUndefined();
      expect(await local.getJob(e2eJobId)).toBeUndefined();
      expect(await local.getJob(localJobId)).not.toBeNull();
      expect(await e2e.getJob(e2eJobId)).not.toBeNull();
    } catch (error) {
      assertionError = error;
    }

    let cleanupError: unknown;
    try {
      await disposeProbeQueues(queues);
    } catch (error) {
      cleanupError = error;
    }

    rethrowProbeTestAndCleanupErrors(assertionError, cleanupError);
  });

  it('obliterating the exclusive probe queue on DB 15 leaves the DB 0 probe intact', async () => {
    const probeQueueName = createIsolationProbeQueueName();
    assertIsolationProbeQueueName(probeQueueName);
    expect(probeQueueName).not.toBe(IMPORT_PROCESSING_QUEUE);

    const local = new Queue(probeQueueName, {
      connection: { url: developmentRedisUrl, maxRetriesPerRequest: null },
    });
    const e2e = new Queue(probeQueueName, {
      connection: { url: e2eRedisUrl, maxRetriesPerRequest: null },
    });
    const queues = [local, e2e];

    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const localJobId = `isolation-keep-local-${stamp}`;
    const e2eJobId = `isolation-e2e-cleanup-${stamp}`;

    let assertionError: unknown;
    try {
      await local.add('isolation-probe', { kind: 'local' }, { jobId: localJobId });
      await e2e.add('isolation-probe', { kind: 'e2e' }, { jobId: e2eJobId });

      // Destructive cleanup only on DB 15 exclusive probe queue — never DB 0,
      // never the operational import-processing queue.
      await e2e.obliterate({ force: true });

      expect(await local.getJob(localJobId)).not.toBeNull();
      expect(await e2e.getJob(e2eJobId)).toBeUndefined();

      // Operational E2E cleanup helper still refuses development URLs.
      await expect(
        obliterateE2eImportQueue(developmentRedisUrl),
      ).rejects.toThrow(/database 15/i);
    } catch (error) {
      assertionError = error;
    }

    let cleanupError: unknown;
    try {
      await disposeProbeQueues(queues);
    } catch (error) {
      cleanupError = error;
    }

    rethrowProbeTestAndCleanupErrors(assertionError, cleanupError);
  });
});
