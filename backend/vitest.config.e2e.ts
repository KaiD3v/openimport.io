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
    },
    globalSetup: ['./test/global-setup.ts'],
  },
});
