import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../core/config/env.js';
import type { ObjectStorage } from '../../../integrations/object-storage/object-storage.port.js';
import type { ImportRepository } from '../import.repository.js';
import type { FileRetentionCandidate } from '../import.types.js';
import { ImportFileRetentionCleaner } from './import-file-retention.cleaner.js';

function candidate(
  overrides: Partial<FileRetentionCandidate> = {},
): FileRetentionCandidate {
  return {
    id: 'sess-1',
    organizationId: 'org-1',
    status: 'ready',
    storageObjectKey: 'org/org-1/imports/sess-1/file.csv',
    finishedAt: new Date('2020-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ImportFileRetentionCleaner', () => {
  let imports: {
    listFileRetentionCandidates: ReturnType<typeof vi.fn>;
    claimFileRetentionCandidate: ReturnType<typeof vi.fn>;
    completeFileRetentionCleanup: ReturnType<typeof vi.fn>;
    releaseFileRetentionClaim: ReturnType<typeof vi.fn>;
  };
  let storage: {
    deleteObject: ReturnType<typeof vi.fn>;
  };
  let cleaner: ImportFileRetentionCleaner;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const env = {
    NODE_ENV: 'test',
    IMPORT_FILE_RETENTION_HOURS: 168,
    IMPORT_FILE_CLEANUP_INTERVAL_MS: 60_000,
    IMPORT_FILE_CLEANUP_BATCH_SIZE: 2,
    IMPORT_FILE_CLEANUP_CLAIM_MS: 120_000,
  } as Env;

  beforeEach(() => {
    imports = {
      listFileRetentionCandidates: vi.fn().mockResolvedValue([]),
      claimFileRetentionCandidate: vi.fn().mockResolvedValue({
        claimed: true,
        storageObjectKey: 'org/org-1/imports/sess-1/file.csv',
      }),
      completeFileRetentionCleanup: vi.fn().mockResolvedValue(true),
      releaseFileRetentionClaim: vi.fn().mockResolvedValue(undefined),
    };
    storage = {
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };
    cleaner = new ImportFileRetentionCleaner(
      imports as unknown as ImportRepository,
      storage as unknown as ObjectStorage,
      env,
    );
    cleaner.resetCursor();
    logSpy = vi.spyOn(cleaner['logger'], 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(cleaner['logger'], 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(cleaner['logger'], 'error').mockImplementation(() => undefined);
  });

  it('does not start a background timer when NODE_ENV is test', () => {
    cleaner.onModuleInit();
    expect(cleaner['timer']).toBeNull();
  });

  it('deletes ready expired objects and completes cleanup', async () => {
    imports.listFileRetentionCandidates
      .mockResolvedValueOnce([candidate()])
      .mockResolvedValue([]);

    await cleaner.cleanupOnce();

    expect(storage.deleteObject).toHaveBeenCalledWith(
      'org/org-1/imports/sess-1/file.csv',
    );
    expect(imports.completeFileRetentionCleanup).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        expectedKey: 'org/org-1/imports/sess-1/file.csv',
        claimToken: expect.any(String),
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'import.file_retention.completed',
        importId: 'sess-1',
        organizationId: 'org-1',
        status: 'ready',
      }),
    );
  });

  it('deletes processing_failed expired objects', async () => {
    imports.listFileRetentionCandidates
      .mockResolvedValueOnce([
        candidate({ id: 'sess-fail', status: 'processing_failed' }),
      ])
      .mockResolvedValue([]);
    imports.claimFileRetentionCandidate.mockResolvedValue({
      claimed: true,
      storageObjectKey: 'org/org-1/imports/sess-1/file.csv',
    });

    await cleaner.cleanupOnce();

    expect(storage.deleteObject).toHaveBeenCalledOnce();
    expect(imports.completeFileRetentionCleanup).toHaveBeenCalledWith(
      'sess-fail',
      expect.any(Object),
    );
  });

  it('does not delete when the repository lists no candidates', async () => {
    imports.listFileRetentionCandidates.mockResolvedValue([]);

    await cleaner.cleanupOnce();

    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(imports.claimFileRetentionCandidate).not.toHaveBeenCalled();
  });

  it('skips when claim is lost and continues', async () => {
    imports.listFileRetentionCandidates
      .mockResolvedValueOnce([
        candidate({ id: 'a' }),
        candidate({
          id: 'b',
          storageObjectKey: 'org/org-1/imports/b/file.csv',
          finishedAt: new Date('2020-01-01T00:00:01.000Z'),
        }),
      ])
      .mockResolvedValue([]);
    imports.claimFileRetentionCandidate
      .mockResolvedValueOnce({ claimed: false, storageObjectKey: null })
      .mockResolvedValueOnce({
        claimed: true,
        storageObjectKey: 'org/org-1/imports/b/file.csv',
      });

    await cleaner.cleanupOnce();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'import.file_retention.claim_lost',
        importId: 'a',
      }),
    );
    expect(storage.deleteObject).toHaveBeenCalledOnce();
    expect(storage.deleteObject).toHaveBeenCalledWith(
      'org/org-1/imports/b/file.csv',
    );
  });

  it('preserves state and releases claim when S3 delete fails', async () => {
    imports.listFileRetentionCandidates
      .mockResolvedValueOnce([candidate()])
      .mockResolvedValue([]);
    storage.deleteObject.mockRejectedValue(new Error('s3 down'));

    await cleaner.cleanupOnce();

    expect(imports.completeFileRetentionCleanup).not.toHaveBeenCalled();
    expect(imports.releaseFileRetentionClaim).toHaveBeenCalledWith(
      'sess-1',
      expect.any(String),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'import.file_retention.delete_failed',
        importId: 'sess-1',
      }),
    );
  });

  it('treats missing object as success and still completes CAS', async () => {
    imports.listFileRetentionCandidates
      .mockResolvedValueOnce([candidate()])
      .mockResolvedValue([]);
    storage.deleteObject.mockResolvedValue(undefined);

    await cleaner.cleanupOnce();

    expect(imports.completeFileRetentionCleanup).toHaveBeenCalledOnce();
  });

  it('retries to completion when CAS misses after a successful delete', async () => {
    const row = candidate();
    imports.listFileRetentionCandidates
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([row])
      .mockResolvedValue([]);
    imports.completeFileRetentionCleanup
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await cleaner.cleanupOnce();
    expect(imports.completeFileRetentionCleanup).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'import.file_retention.complete_cas_miss',
        importId: 'sess-1',
      }),
    );

    cleaner.resetCursor();
    await cleaner.cleanupOnce();
    expect(imports.completeFileRetentionCleanup).toHaveBeenCalledTimes(2);
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
  });

  it('pages beyond the first batch so later candidates are not starved', async () => {
    const t0 = new Date('2020-01-01T00:00:00.000Z');
    const t1 = new Date('2020-01-01T00:00:01.000Z');
    const t2 = new Date('2020-01-01T00:00:02.000Z');

    imports.listFileRetentionCandidates
      .mockResolvedValueOnce([
        candidate({ id: 'a', finishedAt: t0 }),
        candidate({
          id: 'b',
          finishedAt: t1,
          storageObjectKey: 'org/x/b.csv',
        }),
      ])
      .mockResolvedValueOnce([
        candidate({
          id: 'c',
          finishedAt: t2,
          storageObjectKey: 'org/x/c.csv',
        }),
      ])
      .mockResolvedValue([]);

    imports.claimFileRetentionCandidate.mockImplementation(
      async (_id: string, _token: string) => ({
        claimed: true,
        storageObjectKey: 'org/x/key.csv',
      }),
    );

    await cleaner.cleanupOnce();

    expect(imports.listFileRetentionCandidates).toHaveBeenCalledTimes(2);
    expect(imports.listFileRetentionCandidates.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        limit: 2,
        after: { finishedAt: t1, id: 'b' },
      }),
    );
    expect(storage.deleteObject).toHaveBeenCalledTimes(3);
  });

  it('continues after one candidate fails', async () => {
    imports.listFileRetentionCandidates
      .mockResolvedValueOnce([
        candidate({ id: 'bad' }),
        candidate({
          id: 'good',
          finishedAt: new Date('2020-01-01T00:00:01.000Z'),
          storageObjectKey: 'org/x/good.csv',
        }),
      ])
      .mockResolvedValue([]);
    imports.claimFileRetentionCandidate
      .mockResolvedValueOnce({
        claimed: true,
        storageObjectKey: 'org/x/bad.csv',
      })
      .mockResolvedValueOnce({
        claimed: true,
        storageObjectKey: 'org/x/good.csv',
      });
    storage.deleteObject
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await cleaner.cleanupOnce();

    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(imports.completeFileRetentionCleanup).toHaveBeenCalledWith(
      'good',
      expect.any(Object),
    );
  });

  it('never logs object keys or CSV content', async () => {
    const key = 'org/secret-org/imports/sess/secret-name.csv';
    imports.listFileRetentionCandidates
      .mockResolvedValueOnce([candidate({ storageObjectKey: key })])
      .mockResolvedValue([]);
    imports.claimFileRetentionCandidate.mockResolvedValue({
      claimed: true,
      storageObjectKey: key,
    });

    await cleaner.cleanupOnce();

    const payloads = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .map((call) => JSON.stringify(call[0]));
    for (const payload of payloads) {
      expect(payload).not.toContain(key);
      expect(payload).not.toContain('secret-name');
      expect(payload).not.toContain('storageObjectKey');
    }
  });

  it('passes retention and claim TTL into the candidate listing', async () => {
    await cleaner.cleanupOnce();

    expect(imports.listFileRetentionCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 2,
        retentionHours: 168,
        claimTtlMs: 120_000,
        after: null,
      }),
    );
  });
});
