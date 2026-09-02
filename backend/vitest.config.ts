import { defineConfig } from 'vitest/config';

const testEnv = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL:
    'postgresql://openimport:openimport@localhost:5434/openimport_test',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  LOG_LEVEL: 'silent',
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
