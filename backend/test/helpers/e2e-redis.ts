export const E2E_REDIS_DATABASE = 15;
export const E2E_REDIS_URL = `redis://localhost:6379/${E2E_REDIS_DATABASE}`;
export const DEVELOPMENT_REDIS_URL = 'redis://localhost:6379/0';

/** Logical Redis DBs reserved for local Nest (`start:dev` / `start:prod`). */
export const DEVELOPMENT_REDIS_DATABASES = new Set<number>([0]);

/**
 * Pin E2E to Redis DB 15 even when the shell/.env exports a development REDIS_URL.
 * Vitest `test.env` does not overwrite existing process env vars.
 */
export function forceE2eRedisEnv(): string {
  process.env.REDIS_URL = E2E_REDIS_URL;
  assertE2eRedisUrl(process.env.REDIS_URL);
  return process.env.REDIS_URL;
}

export function parseRedisDatabase(redisUrl: string): number {
  let url: URL;
  try {
    url = new URL(redisUrl);
  } catch {
    throw new Error('REDIS_URL is not a valid URL.');
  }

  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use the redis: or rediss: protocol.');
  }

  const path = url.pathname.replace(/^\//, '');
  if (path.length === 0) {
    return 0;
  }

  if (!/^\d+$/.test(path)) {
    throw new Error(
      'REDIS_URL database path must be a non-negative integer.',
    );
  }

  return Number(path);
}

export function redisUrlWithoutCredentials(redisUrl: string): string {
  try {
    const url = new URL(redisUrl);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return 'redis://[redacted]';
  }
}

/**
 * Fail closed when E2E would share the development BullMQ namespace.
 * Cleanup and obliterate may only run after this check succeeds.
 */
export function assertE2eRedisUrl(redisUrl: string): number {
  const database = parseRedisDatabase(redisUrl);

  if (
    DEVELOPMENT_REDIS_DATABASES.has(database) ||
    database !== E2E_REDIS_DATABASE
  ) {
    throw new Error(
      `E2E REDIS_URL must use Redis logical database ${E2E_REDIS_DATABASE} ` +
        `(got ${database} from ${redisUrlWithoutCredentials(redisUrl)}). ` +
        'Refusing to share the development queue namespace.',
    );
  }

  return database;
}

export async function withE2eImportQueue<T>(
  redisUrl: string,
  run: (queue: import('bullmq').Queue) => Promise<T>,
): Promise<T> {
  assertE2eRedisUrl(redisUrl);
  const { Queue } = await import('bullmq');
  const { IMPORT_PROCESSING_QUEUE } = await import(
    '../../src/modules/import/processing/import-processing.queue.js'
  );

  const queue = new Queue(IMPORT_PROCESSING_QUEUE, {
    connection: {
      url: redisUrl,
      maxRetriesPerRequest: null,
    },
  });

  try {
    return await run(queue);
  } finally {
    await queue.close();
  }
}

/** Obliterate only the E2E logical DB queue. Never call with development URLs. */
export async function obliterateE2eImportQueue(redisUrl: string): Promise<void> {
  await withE2eImportQueue(redisUrl, async (queue) => {
    await queue.obliterate({ force: true });
  });
}

export async function assertE2eRedisReachable(redisUrl: string): Promise<void> {
  try {
    await withE2eImportQueue(redisUrl, async (queue) => {
      await queue.waitUntilReady();
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.split('\n')[0] : 'unknown error';
    throw new Error(
      `E2E Redis is unreachable at ${redisUrlWithoutCredentials(redisUrl)}: ${detail}`,
    );
  }
}
