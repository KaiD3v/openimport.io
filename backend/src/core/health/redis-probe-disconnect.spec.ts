import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { forceDisconnectRedisProbeClient } from './redis-probe-disconnect.js';

function clientFixture(stream?: {
  resetAndDestroy?: () => void;
  destroy?: () => void;
}): Redis {
  const disconnect = vi.fn();
  return {
    stream,
    disconnect,
  } as unknown as Redis;
}

describe('forceDisconnectRedisProbeClient', () => {
  it('uses resetAndDestroy when available', () => {
    const resetAndDestroy = vi.fn();
    const destroy = vi.fn();
    const client = clientFixture({ resetAndDestroy, destroy });

    forceDisconnectRedisProbeClient(client);

    expect(resetAndDestroy).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(false);
  });

  it('falls back to destroy when resetAndDestroy throws', () => {
    const destroy = vi.fn();
    const client = clientFixture({
      resetAndDestroy: () => {
        throw new Error('reset failed');
      },
      destroy,
    });

    expect(() => forceDisconnectRedisProbeClient(client)).not.toThrow();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalledWith(false);
  });

  it('disconnects when no stream is available yet', () => {
    const client = clientFixture(undefined);

    expect(() => forceDisconnectRedisProbeClient(client)).not.toThrow();
    expect(client.disconnect).toHaveBeenCalledWith(false);
  });

  it('remains idempotent when called concurrently', () => {
    const resetAndDestroy = vi.fn();
    const client = clientFixture({ resetAndDestroy });

    forceDisconnectRedisProbeClient(client);
    forceDisconnectRedisProbeClient(client);

    expect(resetAndDestroy).toHaveBeenCalledTimes(2);
    expect(client.disconnect).toHaveBeenCalledTimes(2);
  });
});
