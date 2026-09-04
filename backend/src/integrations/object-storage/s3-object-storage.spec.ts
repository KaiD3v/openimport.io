import { describe, expect, it, vi } from 'vitest';
import {
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { S3ObjectStorage } from './s3-object-storage.js';
import type { Env } from '../../core/config/env.js';

function envFixture(overrides?: Partial<Env>): Env {
  return {
    NODE_ENV: 'development',
    PORT: 3000,
    DATABASE_URL: 'postgresql://openimport:openimport@localhost:5434/openimport',
    ALLOWED_ORIGINS: ['http://localhost:5173'],
    LOG_LEVEL: 'silent',
    ENABLE_DOCS: false,
    IMPORT_MAX_FILE_BYTES: 1024,
    IMPORT_MAX_DATA_ROWS: 10,
    IMPORT_MAX_COLUMNS: 10,
    IMPORT_MAX_FIELD_BYTES: 64,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'openimport',
    S3_SECRET_ACCESS_KEY: 'openimportsecret',
    S3_BUCKET: 'openimport',
    S3_FORCE_PATH_STYLE: true,
    ...overrides,
  } as Env;
}

function notFoundError(): Error {
  return Object.assign(new Error('Not Found'), {
    name: 'NotFound',
    $metadata: { httpStatusCode: 404 },
  });
}

describe('S3ObjectStorage bucket bootstrap', () => {
  it('retries HeadBucket after a transient failure instead of caching the rejection', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({});
    const storage = new S3ObjectStorage(envFixture(), {
      send,
    });

    await expect(storage.ensureReady()).rejects.toThrow('timeout');
    await expect(storage.ensureReady()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadBucketCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(HeadBucketCommand);
  });

  it('does not create a bucket on AccessDenied', async () => {
    const denied = Object.assign(new Error('Access Denied'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    });
    const send = vi.fn().mockRejectedValue(denied);
    const storage = new S3ObjectStorage(envFixture(), { send });

    await expect(storage.ensureReady()).rejects.toBe(denied);
    expect(
      send.mock.calls.some((call) => call[0] instanceof CreateBucketCommand),
    ).toBe(false);
  });

  it('creates a missing bucket only in local environments', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(notFoundError())
      .mockResolvedValueOnce({});
    const storage = new S3ObjectStorage(envFixture({ NODE_ENV: 'development' }), {
      send,
    });

    await storage.ensureReady();
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(CreateBucketCommand);
  });

  it('does not create a missing bucket in production', async () => {
    const missing = notFoundError();
    const send = vi.fn().mockRejectedValue(missing);
    const storage = new S3ObjectStorage(envFixture({ NODE_ENV: 'production' }), {
      send,
    });

    await expect(storage.ensureReady()).rejects.toBe(missing);
    expect(
      send.mock.calls.some((call) => call[0] instanceof CreateBucketCommand),
    ).toBe(false);
  });
});

describe('S3ObjectStorage checkReady', () => {
  it('uses HeadBucket only and never creates a bucket', async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new S3ObjectStorage(envFixture({ NODE_ENV: 'development' }), {
      send,
    });

    await storage.checkReady();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadBucketCommand);
    expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal: undefined });
    expect(
      send.mock.calls.some((call) => call[0] instanceof CreateBucketCommand),
    ).toBe(false);
  });

  it('forwards AbortSignal to HeadBucket send options', async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new S3ObjectStorage(envFixture(), { send });
    const controller = new AbortController();

    await storage.checkReady({ signal: controller.signal });

    expect(send).toHaveBeenCalledWith(
      expect.any(HeadBucketCommand),
      { abortSignal: controller.signal },
    );
  });

  it('does not call CreateBucket when HeadBucket is aborted', async () => {
    const send = vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
    );
    const storage = new S3ObjectStorage(envFixture({ NODE_ENV: 'development' }), {
      send,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(storage.checkReady({ signal: controller.signal })).rejects.toThrow(
      'aborted',
    );
    expect(
      send.mock.calls.some((call) => call[0] instanceof CreateBucketCommand),
    ).toBe(false);
  });

  it('does not cache failures between checkReady calls', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({});
    const storage = new S3ObjectStorage(envFixture(), { send });

    await expect(storage.checkReady()).rejects.toThrow('timeout');
    await expect(storage.checkReady()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
