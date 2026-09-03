import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { ObjectStorage } from './object-storage.port.js';
import {
  UploadCleanupError,
  persistUploadWithCleanup,
} from './upload-cleanup.js';

function streamOf(text: string): Readable {
  return Readable.from([Buffer.from(text, 'utf8')]);
}

describe('persistUploadWithCleanup', () => {
  it('propagates storage put failures without marking success', async () => {
    const storage: ObjectStorage = {
      putObject: vi.fn().mockRejectedValue(new Error('put failed')),
      openObject: vi.fn(),
      deleteObject: vi.fn(),
    };

    await expect(
      persistUploadWithCleanup({
        storage,
        key: 'org/session/object',
        body: streamOf('sku,name\n1,2\n'),
        afterStored: async () => {
          throw new Error('should not run');
        },
      }),
    ).rejects.toThrow('put failed');
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('deletes the object when post-store work fails', async () => {
    const storage: ObjectStorage = {
      putObject: vi.fn().mockResolvedValue(undefined),
      openObject: vi.fn().mockResolvedValue(streamOf('sku,name\n1,2\n')),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      persistUploadWithCleanup({
        storage,
        key: 'org/session/object',
        body: streamOf('sku,name\n1,2\n'),
        afterStored: async () => {
          throw new Error('parse failed');
        },
      }),
    ).rejects.toThrow('parse failed');

    expect(storage.deleteObject).toHaveBeenCalledWith('org/session/object');
  });

  it('deletes the object when database persistence fails after upload', async () => {
    const storage: ObjectStorage = {
      putObject: vi.fn().mockResolvedValue(undefined),
      openObject: vi.fn().mockResolvedValue(streamOf('sku,name\n1,2\n')),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      persistUploadWithCleanup({
        storage,
        key: 'org/session/object',
        body: streamOf('sku,name\n1,2\n'),
        afterStored: async () => {
          throw new Error('db failed');
        },
      }),
    ).rejects.toThrow('db failed');

    expect(storage.deleteObject).toHaveBeenCalledWith('org/session/object');
  });

  it('surfaces cleanup failure without hiding the original error', async () => {
    const storage: ObjectStorage = {
      putObject: vi.fn().mockResolvedValue(undefined),
      openObject: vi.fn().mockResolvedValue(streamOf('sku,name\n1,2\n')),
      deleteObject: vi.fn().mockRejectedValue(new Error('cleanup failed')),
    };
    const logger = { error: vi.fn() };

    await expect(
      persistUploadWithCleanup({
        storage,
        key: 'org/session/object',
        body: streamOf('sku,name\n1,2\n'),
        afterStored: async () => {
          throw new Error('parse failed');
        },
        logger,
      }),
    ).rejects.toBeInstanceOf(UploadCleanupError);

    try {
      await persistUploadWithCleanup({
        storage,
        key: 'org/session/object',
        body: streamOf('sku,name\n1,2\n'),
        afterStored: async () => {
          throw new Error('parse failed');
        },
        logger,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(UploadCleanupError);
      const cleanupError = error as UploadCleanupError;
      expect(cleanupError.message).toContain('parse failed');
      expect(cleanupError.cleanupMessage).toContain('cleanup failed');
      expect(logger.error).toHaveBeenCalled();
      const logged = String(logger.error.mock.calls[0]?.[0] ?? '');
      expect(logged).not.toContain('secret');
      expect(logged).toContain('org/session/object');
    }
  });

  it('propagates openObject failures after a successful put and cleans up', async () => {
    const storage: ObjectStorage = {
      putObject: vi.fn().mockResolvedValue(undefined),
      openObject: vi.fn().mockRejectedValue(new Error('open failed')),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      persistUploadWithCleanup({
        storage,
        key: 'org/session/object',
        body: streamOf('sku,name\n1,2\n'),
        afterStored: async (opened) => opened,
      }),
    ).rejects.toThrow('open failed');
    expect(storage.deleteObject).toHaveBeenCalledWith('org/session/object');
  });
});
