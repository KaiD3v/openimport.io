import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const REQUIRED = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://openimport:openimport@localhost:5432/openimport',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'openimport',
  S3_SECRET_ACCESS_KEY: 'openimportsecret',
  S3_BUCKET: 'openimport',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadEnv', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('returns validated configuration for a complete environment', () => {
    Object.assign(process.env, REQUIRED);

    const env = loadEnv();

    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
    expect(env.ALLOWED_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('fails closed when DATABASE_URL is missing without leaking other secrets', () => {
    Object.assign(process.env, REQUIRED);
    delete process.env.DATABASE_URL;
    process.env.SEED_API_KEY = 'supersecret-seed-key-should-not-leak';

    expect(() => loadEnv()).toThrow(/DATABASE_URL/);
    try {
      loadEnv();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('supersecret-seed-key-should-not-leak');
    }
  });

  it('rejects a non-PostgreSQL DATABASE_URL without echoing the value', () => {
    Object.assign(process.env, REQUIRED);
    process.env.DATABASE_URL = 'https://example.com/not-postgres?password=supersecret-db-password';

    expect(() => loadEnv()).toThrow(/DATABASE_URL/);
    try {
      loadEnv();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('supersecret-db-password');
      expect(message).not.toContain('https://example.com');
    }
  });

  it('rejects a non-Redis REDIS_URL without echoing the value', () => {
    Object.assign(process.env, REQUIRED);
    process.env.REDIS_URL = 'https://example.com/not-redis?password=supersecret-redis-password';

    expect(() => loadEnv()).toThrow(/REDIS_URL/);
    try {
      loadEnv();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('supersecret-redis-password');
      expect(message).not.toContain('https://example.com');
    }
  });

  it('rejects PORT values outside the TCP range', () => {
    Object.assign(process.env, REQUIRED);
    process.env.PORT = '70000';

    expect(() => loadEnv()).toThrow(/PORT/);
  });

  it('rejects wildcard CORS origins in production', () => {
    Object.assign(process.env, REQUIRED, {
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: '*',
    });

    expect(() => loadEnv()).toThrow(/ALLOWED_ORIGINS/);
  });
});
