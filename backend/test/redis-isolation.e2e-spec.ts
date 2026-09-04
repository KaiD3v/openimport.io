import { Queue } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import { IMPORT_PROCESSING_QUEUE } from '../src/modules/import/processing/import-processing.queue.js';
import {
  assertE2eRedisUrl,
  DEVELOPMENT_REDIS_URL,
  E2E_REDIS_DATABASE,
  E2E_REDIS_URL,
  forceE2eRedisEnv,
  obliterateE2eImportQueue,
} from './helpers/e2e-redis.js';

const developmentRedisUrl = DEVELOPMENT_REDIS_URL;
const e2eRedisUrl = E2E_REDIS_URL;

describe('BullMQ Redis namespace isolation (e2e)', () => {
  const queues: Queue[] = [];

  afterAll(async () => {
    await Promise.all(queues.map((queue) => queue.close()));
  });

  function openQueue(redisUrl: string): Queue {
    const queue = new Queue(IMPORT_PROCESSING_QUEUE, {
      connection: {
        url: redisUrl,
        maxRetriesPerRequest: null,
      },
    });
    queues.push(queue);
    return queue;
  }

  it('uses a dedicated E2E Redis database distinct from development', () => {
    expect(forceE2eRedisEnv()).toBe(E2E_REDIS_URL);
    expect(assertE2eRedisUrl(e2eRedisUrl)).toBe(E2E_REDIS_DATABASE);
    expect(e2eRedisUrl).not.toBe(developmentRedisUrl);
  });

  it('keeps development and E2E queue jobs invisible to each other', async () => {
    const local = openQueue(developmentRedisUrl);
    const e2e = openQueue(e2eRedisUrl);
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const localJobId = `isolation-local-${stamp}`;
    const e2eJobId = `isolation-e2e-${stamp}`;

    await local.add(
      'isolation-probe',
      {
        organizationId: '00000000-0000-4000-8000-000000000001',
        importSessionId: '00000000-0000-4000-8000-000000000002',
        executionId: '00000000-0000-4000-8000-000000000003',
      },
      { jobId: localJobId },
    );
    await e2e.add(
      'isolation-probe',
      {
        organizationId: '00000000-0000-4000-8000-000000000004',
        importSessionId: '00000000-0000-4000-8000-000000000005',
        executionId: '00000000-0000-4000-8000-000000000006',
      },
      { jobId: e2eJobId },
    );

    expect(await e2e.getJob(localJobId)).toBeUndefined();
    expect(await local.getJob(e2eJobId)).toBeUndefined();
    expect(await local.getJob(localJobId)).not.toBeNull();
    expect(await e2e.getJob(e2eJobId)).not.toBeNull();

    await local.remove(localJobId);
    await e2e.remove(e2eJobId);
  });

  it('obliterates only the E2E queue and leaves the development probe intact', async () => {
    const local = openQueue(developmentRedisUrl);
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const localJobId = `isolation-keep-local-${stamp}`;

    await local.add(
      'isolation-probe',
      {
        organizationId: '00000000-0000-4000-8000-000000000007',
        importSessionId: '00000000-0000-4000-8000-000000000008',
        executionId: '00000000-0000-4000-8000-000000000009',
      },
      { jobId: localJobId },
    );

    await obliterateE2eImportQueue(e2eRedisUrl);

    expect(await local.getJob(localJobId)).not.toBeNull();
    await local.remove(localJobId);
  });
});
