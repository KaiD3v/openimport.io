import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  assertE2eRedisReachable,
  forceE2eRedisEnv,
  obliterateE2eImportQueue,
} from './helpers/e2e-redis.js';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default async function globalSetup(): Promise<() => Promise<void>> {
  const redisUrl = forceE2eRedisEnv();
  await assertE2eRedisReachable(redisUrl);
  await obliterateE2eImportQueue(redisUrl);

  const databaseUrl =
    process.env.DATABASE_URL ??
    'postgresql://openimport:openimport@localhost:5434/openimport_test';

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    cwd: backendRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });

  return async () => {
    try {
      await obliterateE2eImportQueue(redisUrl);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown teardown error';
      console.error(`E2E Redis teardown failed: ${message}`);
    }
  };
}
