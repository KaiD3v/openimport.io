import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { ReadinessService } from './readiness.service.js';
import type { ReadinessProbe } from './readiness.types.js';

function envFixture(timeoutMs = 50): Env {
  return {
    HEALTH_PROBE_TIMEOUT_MS: timeoutMs,
  } as Env;
}

function probe(
  dependency: ReadinessProbe['dependency'],
  check: ReadinessProbe['check'],
): ReadinessProbe {
  return { dependency, check };
}

describe('ReadinessService', () => {
  it('returns ready when all probes succeed in parallel', async () => {
    const order: string[] = [];
    const probes = [
      probe('postgres', async () => {
        order.push('postgres');
      }),
      probe('redis', async () => {
        order.push('redis');
      }),
      probe('object_storage', async () => {
        order.push('object_storage');
      }),
    ];
    const service = new ReadinessService(envFixture(), probes);

    await expect(service.check()).resolves.toEqual({ ready: true, failed: [] });
    expect(order.sort()).toEqual(['object_storage', 'postgres', 'redis']);
  });

  it('returns not ready when PostgreSQL fails', async () => {
    const service = new ReadinessService(
      envFixture(),
      [
        probe('postgres', async () => {
          throw new Error('postgres down');
        }),
        probe('redis', async () => undefined),
        probe('object_storage', async () => undefined),
      ],
    );

    const result = await service.check();
    expect(result.ready).toBe(false);
    expect(result.failed).toEqual(['postgres']);
  });

  it('returns not ready when Redis fails', async () => {
    const service = new ReadinessService(
      envFixture(),
      [
        probe('postgres', async () => undefined),
        probe('redis', async () => {
          throw new Error('redis down');
        }),
        probe('object_storage', async () => undefined),
      ],
    );

    const result = await service.check();
    expect(result.ready).toBe(false);
    expect(result.failed).toEqual(['redis']);
  });

  it('returns not ready when object storage fails', async () => {
    const service = new ReadinessService(
      envFixture(),
      [
        probe('postgres', async () => undefined),
        probe('redis', async () => undefined),
        probe('object_storage', async () => {
          throw new Error('storage down');
        }),
      ],
    );

    const result = await service.check();
    expect(result.ready).toBe(false);
    expect(result.failed).toEqual(['object_storage']);
  });

  it('aggregates multiple simultaneous failures without unhandled rejections', async () => {
    const service = new ReadinessService(
      envFixture(),
      [
        probe('postgres', async () => {
          throw new Error('postgres down');
        }),
        probe('redis', async () => {
          throw new Error('redis down');
        }),
        probe('object_storage', async () => undefined),
      ],
    );

    const result = await service.check();
    expect(result.ready).toBe(false);
    expect(result.failed.sort()).toEqual(['postgres', 'redis']);
  });

  it('treats probe timeouts as failures and recovers on the next call', async () => {
    let slow = true;
    const service = new ReadinessService(
      envFixture(20),
      [
        probe('postgres', async () => undefined),
        probe('redis', async (_signal) => {
          if (slow) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }),
        probe('object_storage', async () => undefined),
      ],
    );

    await expect(service.check()).resolves.toMatchObject({
      ready: false,
      failed: ['redis'],
    });

    slow = false;
    await expect(service.check()).resolves.toEqual({ ready: true, failed: [] });
  });

  it('logs failed dependency names without probe error messages', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new ReadinessService(
      envFixture(),
      [
        probe('postgres', async () => {
          throw new Error('postgresql://secret-host:5432/openimport');
        }),
        probe('redis', async () => undefined),
        probe('object_storage', async () => undefined),
      ],
    );

    await service.check();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        failedDependencies: ['postgres'],
      }),
      'Readiness probe failed',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('postgresql://');
    warn.mockRestore();
  });
});
