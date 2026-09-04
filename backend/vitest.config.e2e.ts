import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      PORT: '3001',
      DATABASE_URL:
        'postgresql://openimport:openimport@localhost:5434/openimport_test',
      ALLOWED_ORIGINS: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
      IMPORT_MAX_FILE_BYTES: '1024',
      IMPORT_MAX_DATA_ROWS: '100',
      IMPORT_MAX_COLUMNS: '20',
      IMPORT_MAX_FIELD_BYTES: '256',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'openimport',
      S3_SECRET_ACCESS_KEY: 'openimportsecret',
      S3_BUCKET: 'openimport',
      S3_FORCE_PATH_STYLE: 'true',
      REDIS_URL: 'redis://localhost:6379',
      IMPORT_WORKER_CONCURRENCY: '1',
      IMPORT_WORKER_MAX_ATTEMPTS: '3',
      IMPORT_WORKER_BACKOFF_MS: '100',
      IMPORT_PERSIST_BATCH_SIZE: '1',
      IMPORT_REJECTED_ROWS_MAX_LIMIT: '50',
      IMPORT_JOB_RECONCILE_INTERVAL_MS: '60000',
      IMPORT_JOB_RECONCILE_BATCH_SIZE: '10',
    },
    globalSetup: ['./test/global-setup.ts'],
  },
});
