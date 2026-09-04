import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.token.js';
import { forceDisconnectRedisProbeClient } from './redis-probe-disconnect.js';
import type { ReadinessProbe } from './readiness.types.js';
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('aborted');
  }
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('aborted')), {
      once: true,
    });
  });
}

async function withAbort<T>(
  signal: AbortSignal,
  promise: Promise<T>,
): Promise<T> {
  throwIfAborted(signal);
  return Promise.race([promise, rejectOnAbort(signal)]);
}

@Injectable()
export class RedisReadinessProbe implements ReadinessProbe {  readonly dependency = 'redis' as const;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async check(signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);

    const client = new Redis(this.env.REDIS_URL, {
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    client.on('error', () => undefined);

    let disconnected = false;
    const disconnectImmediate = (): void => {
      if (!disconnected) {
        disconnected = true;
        forceDisconnectRedisProbeClient(client);
      }
    };

    const onAbort = (): void => {
      disconnectImmediate();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      await withAbort(signal, client.connect());
      const response = await withAbort(signal, client.ping());
      if (response !== 'PONG') {
        throw new Error('redis ping failed');
      }
      try {
        await withAbort(signal, client.quit());
        disconnected = true;
      } catch {
        disconnectImmediate();
      }
    } catch (error) {
      disconnectImmediate();
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
