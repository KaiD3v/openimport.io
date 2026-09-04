import type { Redis } from 'ioredis';

type DestroyableStream = {
  resetAndDestroy?: () => void;
  destroy?: () => void;
};

function destroyRedisStream(stream: DestroyableStream | undefined): void {
  if (!stream) {
    return;
  }
  try {
    if (typeof stream.resetAndDestroy === 'function') {
      stream.resetAndDestroy();
      return;
    }
  } catch {
    // fall through to destroy()
  }
  try {
    stream.destroy?.();
  } catch {
    // ignore cleanup failures during abort
  }
}

/**
 * Immediately tears down a probe-scoped Redis client. Uses the public Redis#stream
 * handle (not the private connector) so a silent TCP peer cannot linger open.
 */
export function forceDisconnectRedisProbeClient(client: Redis): void {
  destroyRedisStream(client.stream as DestroyableStream | undefined);
  try {
    client.disconnect(false);
  } catch {
    // disconnect is idempotent for probe cleanup
  }
}
