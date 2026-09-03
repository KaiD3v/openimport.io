import { defineConfig } from 'vitest/config';

const testEnv = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL:
    'postgresql://openimport:openimport@localhost:5434/openimport_test',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  LOG_LEVEL: 'silent',
  IMPORT_MAX_FILE_BYTES: '5242880',
  IMPORT_MAX_DATA_ROWS: '10000',
  IMPORT_MAX_COLUMNS: '50',
  IMPORT_MAX_FIELD_BYTES: '65536',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'openimport',
  S3_SECRET_ACCESS_KEY: 'openimportsecret',
  S3_BUCKET: 'openimport',
  S3_FORCE_PATH_STYLE: 'true',
};

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    exclude: ['src/generated/**', 'dist/**', 'node_modules/**'],
    env: testEnv,
  },
});
