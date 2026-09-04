import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import type { Env } from '../../../core/config/env.js';
import type { ObjectStorage } from '../../../integrations/object-storage/object-storage.port.js';
import type { ImportRepository } from '../import.repository.js';
import type { TemplateRepository } from '../../template/template.repository.js';
import type { ImportExecutionRecord } from '../import.types.js';
import { ImportProcessingWorker } from './import-processing.worker.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const importSessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const executionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function execution(
  overrides: Partial<ImportExecutionRecord> = {},
): ImportExecutionRecord {
  const now = new Date();
  return {
    id: executionId,
    organizationId,
    importSessionId,
    status: 'processing',
    confirmationFingerprint: 'f'.repeat(64),
    expectedMappingRevision: 1,
    expectedContentSha256: 'c'.repeat(64),
    jobId: 'job',
    attempt: 1,
    processedRows: 0,
    totalRows: 2,
    validRows: 0,
    invalidRows: 0,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ImportProcessingWorker failure integrity', () => {
  let imports: {
    findExecutionById: ReturnType<typeof vi.fn>;
    findByIdForOrganization: ReturnType<typeof vi.fn>;
    markExecutionProcessing: ReturnType<typeof vi.fn>;
    deleteExecutionRecords: ReturnType<typeof vi.fn>;
    failExecutionAndDiscardRecords: ReturnType<typeof vi.fn>;
    markExecutionFailed: ReturnType<typeof vi.fn>;
    upsertRecordBatch: ReturnType<typeof vi.fn>;
    updateExecutionProgress: ReturnType<typeof vi.fn>;
    markExecutionReady: ReturnType<typeof vi.fn>;
  };
  let templates: { findByIdForOrganization: ReturnType<typeof vi.fn> };
  let storage: { openObject: ReturnType<typeof vi.fn> };
  let worker: ImportProcessingWorker;

  beforeEach(() => {
    imports = {
      findExecutionById: vi.fn().mockResolvedValue(execution()),
      findByIdForOrganization: vi.fn().mockResolvedValue(null),
      markExecutionProcessing: vi.fn(),
      deleteExecutionRecords: vi.fn(),
      failExecutionAndDiscardRecords: vi.fn().mockResolvedValue(true),
      markExecutionFailed: vi.fn(),
      upsertRecordBatch: vi.fn(),
      updateExecutionProgress: vi.fn(),
      markExecutionReady: vi.fn(),
    };
    templates = { findByIdForOrganization: vi.fn() };
    storage = { openObject: vi.fn() };
    worker = new ImportProcessingWorker(
      imports as unknown as ImportRepository,
      templates as unknown as TemplateRepository,
      storage as unknown as ObjectStorage,
      {
        IMPORT_WORKER_MAX_ATTEMPTS: 3,
        IMPORT_PERSIST_BATCH_SIZE: 1,
        IMPORT_MAX_FILE_BYTES: 1024,
        IMPORT_MAX_DATA_ROWS: 100,
        IMPORT_MAX_COLUMNS: 20,
        IMPORT_MAX_FIELD_BYTES: 256,
        IMPORT_WORKER_CONCURRENCY: 2,
      } as Env,
      { enqueueBestEffort: vi.fn() } as never,
    );
  });

  it('uses atomic failExecutionAndDiscardRecords for definitive missing-session failures', async () => {
    await expect(
      worker.process({
        data: { organizationId, importSessionId, executionId },
        id: 'job',
        opts: { attempts: 3 },
        attemptsMade: 0,
      } as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(imports.failExecutionAndDiscardRecords).toHaveBeenCalledTimes(1);
    expect(imports.failExecutionAndDiscardRecords).toHaveBeenCalledWith(
      organizationId,
      executionId,
      importSessionId,
      expect.objectContaining({ code: 'IMPORT.NOT_FOUND' }),
    );
    expect(imports.markExecutionFailed).not.toHaveBeenCalled();
    expect(imports.deleteExecutionRecords).not.toHaveBeenCalled();
  });
});
