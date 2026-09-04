import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithTimeout } from './readiness-timeout.js';

describe('runWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when the operation completes before the timeout', async () => {
    await expect(
      runWithTimeout(async () => 'ok', 50),
    ).resolves.toBe('ok');
  });

  it('passes a live AbortSignal to the operation', async () => {
    let receivedSignal: AbortSignal | undefined;
    await runWithTimeout(async (signal) => {
      receivedSignal = signal;
      return 'ok';
    }, 50);
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal?.aborted).toBe(false);
  });

  it('rejects when the operation exceeds the timeout', async () => {
    await expect(
      runWithTimeout(
        () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 100)),
        20,
      ),
    ).rejects.toThrow('timeout');
  });

  it('aborts the signal when the timeout elapses', async () => {
    let aborted = false;
    await expect(
      runWithTimeout(async (signal) => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }, 20),
    ).rejects.toThrow('timeout');
    expect(aborted).toBe(true);
  });

  it('clears the timer when the callback throws synchronously', async () => {
    vi.useFakeTimers();
    await expect(
      runWithTimeout(() => {
        throw new Error('sync');
      }, 1000),
    ).rejects.toThrow('sync');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not leave rejected operations as unhandled rejections after timeout', async () => {
    const unhandled: unknown[] = [];
    const previous = process.listeners('unhandledRejection');
    for (const listener of previous) {
      process.removeListener('unhandledRejection', listener);
    }
    process.on('unhandledRejection', (reason) => {
      unhandled.push(reason);
    });

    try {
      await expect(
        runWithTimeout(
          () =>
            new Promise<void>((_, reject) => {
              setTimeout(() => reject(new Error('slow failure')), 100);
            }),
          20,
        ),
      ).rejects.toThrow('timeout');

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(unhandled).toEqual([]);
    } finally {
      process.removeAllListeners('unhandledRejection');
      for (const listener of previous) {
        process.on('unhandledRejection', listener);
      }
    }
  });

  it('does not leave rejections after abort as unhandled rejections', async () => {
    const unhandled: unknown[] = [];
    const previous = process.listeners('unhandledRejection');
    for (const listener of previous) {
      process.removeListener('unhandledRejection', listener);
    }
    process.on('unhandledRejection', (reason) => {
      unhandled.push(reason);
    });

    try {
      await expect(
        runWithTimeout(async (signal) => {
          await new Promise<void>((_, reject) => {
            signal.addEventListener('abort', () => {
              setTimeout(() => reject(new Error('late after abort')), 30);
            });
            setTimeout(() => reject(new Error('never')), 200);
          });
        }, 20),
      ).rejects.toThrow('timeout');

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(unhandled).toEqual([]);
    } finally {
      process.removeAllListeners('unhandledRejection');
      for (const listener of previous) {
        process.on('unhandledRejection', listener);
      }
    }
  });

  it('allows a later call to succeed after a timeout', async () => {
    let calls = 0;
    const operation = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'late';
      }
      return 'ok';
    });

    await expect(runWithTimeout(operation, 20)).rejects.toThrow('timeout');
    await expect(runWithTimeout(operation, 200)).resolves.toBe('ok');
  });
});
