import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default async function globalSetup(): Promise<void> {
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
}
