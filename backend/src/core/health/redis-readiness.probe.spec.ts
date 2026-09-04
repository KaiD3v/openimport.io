import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { runWithTimeout } from './readiness-timeout.js';
import { RedisReadinessProbe } from './redis-readiness.probe.js';

const connect = vi.fn().mockResolvedValue(undefined);
const ping = vi.fn().mockResolvedValue('PONG');
const quit = vi.fn().mockResolvedValue('OK');
const disconnect = vi.fn();
const on = vi.fn();

vi.mock('ioredis', () => ({
  Redis: vi.fn(function MockRedis() {
    return {
      status: 'ready',
      connect,
      ping,
      quit,
      disconnect,
      on,
    };
  }),
}));

function envFixture(): Env {
  return {
    REDIS_URL: 'redis://localhost:6379/15',
  } as Env;
}

describe('RedisReadinessProbe', () => {
  afterEach(() => {
    connect.mockClear();
    ping.mockClear();
    quit.mockClear();
    disconnect.mockClear();
    on.mockClear();
    connect.mockResolvedValue(undefined);
    ping.mockResolvedValue('PONG');
    quit.mockResolvedValue('OK');
  });

  it('pings Redis without publishing or cleaning queues', async () => {
    const probe = new RedisReadinessProbe(envFixture());
    const controller = new AbortController();

    await probe.check(controller.signal);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('quits even when ping fails', async () => {
    ping.mockRejectedValueOnce(new Error('down'));
    const probe = new RedisReadinessProbe(envFixture());
    const controller = new AbortController();

    await expect(probe.check(controller.signal)).rejects.toThrow('down');
    expect(quit).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('fails when ping does not return PONG', async () => {
    ping.mockResolvedValueOnce('NOPE');
    const probe = new RedisReadinessProbe(envFixture());
    const controller = new AbortController();

    await expect(probe.check(controller.signal)).rejects.toThrow('redis ping failed');
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects immediately when aborted during connect', async () => {
    connect.mockImplementation(
      () =>
        new Promise<void>(() => {
          /* hang until abort */
        }),
    );
    const probe = new RedisReadinessProbe(envFixture());
    const controller = new AbortController();

    const pending = probe.check(controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow('aborted');
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it('disconnects immediately when aborted during ping', async () => {
    ping.mockImplementation(
      () =>
        new Promise<string>(() => {
          /* hang until abort */
        }),
    );
    const probe = new RedisReadinessProbe(envFixture());
    const controller = new AbortController();

    const pending = probe.check(controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow('aborted');
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it('disconnect cleanup is idempotent when abort races with failure', async () => {
    ping.mockRejectedValueOnce(new Error('down'));
    const probe = new RedisReadinessProbe(envFixture());
    const controller = new AbortController();

    const pending = probe.check(controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow(/down|aborted/);
    expect(disconnect.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const probe = new RedisReadinessProbe(envFixture());
    const controller = new AbortController();
    controller.abort();

    await expect(probe.check(controller.signal)).rejects.toThrow('aborted');
    expect(connect).not.toHaveBeenCalled();
  });

  it('closes the probe connection when runWithTimeout times out', async () => {
    connect.mockImplementation(
      () =>
        new Promise<void>(() => {
          /* hang */
        }),
    );
    const probe = new RedisReadinessProbe(envFixture());

    await expect(runWithTimeout((signal) => probe.check(signal), 30)).rejects.toThrow(
      'timeout',
    );
    expect(disconnect).toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });
});
