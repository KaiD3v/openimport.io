import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Env } from '../config/env.js';
import { runWithTimeout } from './readiness-timeout.js';
import { RedisReadinessProbe } from './redis-readiness.probe.js';

function rethrowTestAndCleanupErrors(
  assertionError: unknown,
  cleanupError: unknown,
): void {
  if (assertionError != null && cleanupError != null) {
    throw new AggregateError(
      [assertionError, cleanupError],
      'Redis readiness TCP probe test and cleanup both failed',
    );
  }
  if (assertionError != null) {
    throw assertionError;
  }
  if (cleanupError != null) {
    throw cleanupError;
  }
}

describe('RedisReadinessProbe silent TCP server', () => {
  let server: Server | undefined;
  let activeSockets = new Set<Socket>();

  async function teardownSilentServer(): Promise<void> {
    for (const socket of activeSockets) {
      try {
        socket.destroy();
      } catch {
        // ignore per-socket cleanup failures
      }
    }
    activeSockets.clear();

    if (!server) {
      return;
    }

    const closing = server;
    server = undefined;
    await new Promise<void>((resolve, reject) => {
      closing.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async function startSilentServer(): Promise<number> {
    server = createServer((socket) => {
      activeSockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => {
        activeSockets.delete(socket);
      });
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', resolve);
    });

    const address = server!.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP port');
    }
    return address.port;
  }

  afterEach(async () => {
    await teardownSilentServer();
  });

  it('closes the TCP listener after teardown', async () => {
    const port = await startSilentServer();
    const listeningServer = server!;

    expect(port).toBeGreaterThan(0);
    expect(listeningServer.listening).toBe(true);

    await teardownSilentServer();

    expect(server).toBeUndefined();
    expect(listeningServer.listening).toBe(false);
  });

  it('times out and releases the socket when the server accepts but never responds', async () => {
    let assertionError: unknown;

    try {
      const port = await startSilentServer();
      expect(server?.listening).toBe(true);

      const probe = new RedisReadinessProbe({
        REDIS_URL: `redis://127.0.0.1:${port}/0`,
      } as Env);

      const timeoutMs = 80;
      const startedAt = Date.now();

      await expect(
        runWithTimeout((signal) => probe.check(signal), timeoutMs),
      ).rejects.toThrow('timeout');

      const elapsedMs = Date.now() - startedAt;

      await new Promise((resolve) => setTimeout(resolve, 50));
      const socketsAfter50ms = activeSockets.size;

      await new Promise((resolve) => setTimeout(resolve, 650));
      const socketsAfter700ms = activeSockets.size;

      expect(elapsedMs).toBeGreaterThanOrEqual(timeoutMs - 5);
      expect(elapsedMs).toBeLessThan(timeoutMs + 250);
      expect(socketsAfter50ms).toBe(0);
      expect(socketsAfter700ms).toBe(0);
    } catch (error) {
      assertionError = error;
    }

    let cleanupError: unknown;
    try {
      await teardownSilentServer();
      expect(server).toBeUndefined();
    } catch (error) {
      cleanupError = error;
    }

    rethrowTestAndCleanupErrors(assertionError, cleanupError);
  });
});
