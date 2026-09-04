import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../core/config/env.js';
import type { ImportExecutionRecord, ImportSessionRecord } from '../import.types.js';
import { ImportRepository } from '../import.repository.js';
import {
  encodeValidRowsCursor,
} from './valid-rows-cursor.js';
import { ValidRowsService } from './valid-rows.service.js';

const organizationId = '11111111-1111-1111-1111-111111111111';
const importId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const executionId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const otherExecutionId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function readySession(
  overrides: Partial<ImportSessionRecord> = {},
): ImportSessionRecord {
  const now = new Date('2026-09-03T12:00:00.000Z');
  return {
    id: importId,
    organizationId,
    templateId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    status: 'ready',
    idempotencyKeyHash: 'aa',
    requestFingerprint: 'bb',
    originalFilename: 'products.csv',
    byteSize: 100,
    contentSha256: 'a'.repeat(64),
    encoding: 'utf-8',
    delimiter: ',',
    dataRowCount: 5,
    storageObjectKey: 'org/x/y.csv',
    mapping: [],
    mappingRevision: 1,
    uploadedAt: now,
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
    columns: [],
    ...overrides,
  };
}

function readyExecution(
  overrides: Partial<ImportExecutionRecord> = {},
): ImportExecutionRecord {
  const now = new Date('2026-09-03T12:00:00.000Z');
  return {
    id: executionId,
    organizationId,
    importSessionId: importId,
    status: 'ready',
    confirmationFingerprint: 'fp',
    expectedMappingRevision: 1,
    expectedContentSha256: 'a'.repeat(64),
    jobId: 'job-1',
    attempt: 1,
    processedRows: 5,
    totalRows: 5,
    validRows: 5,
    invalidRows: 0,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ValidRowsService', () => {
  let imports: {
    findByIdForOrganization: ReturnType<typeof vi.fn>;
    findLatestExecution: ReturnType<typeof vi.fn>;
    listValidRows: ReturnType<typeof vi.fn>;
  };
  let service: ValidRowsService;
  const env = {
    IMPORT_VALID_ROWS_MAX_LIMIT: 100,
  } as Env;

  beforeEach(() => {
    imports = {
      findByIdForOrganization: vi.fn(),
      findLatestExecution: vi.fn(),
      listValidRows: vi.fn(),
    };
    service = new ValidRowsService(
      imports as unknown as ImportRepository,
      env,
    );
  });

  it('returns 404 when the session is missing', async () => {
    imports.findByIdForOrganization.mockResolvedValue(null);
    await expect(
      service.list(organizationId, importId, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 409 when the session is not ready', async () => {
    imports.findByIdForOrganization.mockResolvedValue(
      readySession({ status: 'processing' }),
    );
    await expect(
      service.list(organizationId, importId, {}),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.SNAPSHOT_NOT_READY' },
    });
    expect(imports.listValidRows).not.toHaveBeenCalled();
  });

  it('returns 409 when the execution is missing or not ready', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(
      readyExecution({ status: 'processing' }),
    );
    await expect(
      service.list(organizationId, importId, {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a malformed cursor with 400', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    await expect(
      service.list(organizationId, importId, { after: 'bad' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a cursor from another execution with 400', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    const after = encodeValidRowsCursor({
      executionId: otherExecutionId,
      recordNumber: 1,
    });
    await expect(
      service.list(organizationId, importId, { after }),
    ).rejects.toMatchObject({
      response: { code: 'VALIDATION.FAILED' },
    });
    expect(imports.listValidRows).not.toHaveBeenCalled();
  });

  it('applies the default limit of 50 and caps at the configured maximum', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    imports.listValidRows.mockResolvedValue([]);

    await service.list(organizationId, importId, {});
    expect(imports.listValidRows).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 51 }),
    );

    await service.list(organizationId, importId, { limit: 999 });
    expect(imports.listValidRows).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 101 }),
    );
  });

  it('returns an empty page with null cursor when there are no valid rows', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    imports.listValidRows.mockResolvedValue([]);

    await expect(
      service.list(organizationId, importId, { limit: 2 }),
    ).resolves.toEqual({
      importId,
      executionId,
      data: [],
      nextCursor: null,
    });
  });

  it('returns the first page ordered by recordNumber and a nextCursor', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    imports.listValidRows.mockResolvedValue([
      { recordNumber: 1, payload: { sku: 'A' } },
      { recordNumber: 3, payload: { sku: 'B' } },
      { recordNumber: 5, payload: { sku: 'C' } },
    ]);

    const page = await service.list(organizationId, importId, { limit: 2 });
    expect(page.data).toEqual([
      { recordNumber: 1, data: { sku: 'A' } },
      { recordNumber: 3, data: { sku: 'B' } },
    ]);
    expect(page.nextCursor).toBe(
      encodeValidRowsCursor({ executionId, recordNumber: 3 }),
    );
    expect(imports.listValidRows).toHaveBeenCalledWith({
      organizationId,
      importSessionId: importId,
      executionId,
      afterRecordNumber: 0,
      limit: 3,
    });
  });

  it('uses the cursor recordNumber for subsequent pages', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    imports.listValidRows.mockResolvedValue([
      { recordNumber: 5, payload: { sku: 'C' } },
      { recordNumber: 7, payload: { sku: 'D' } },
      { recordNumber: 9, payload: { sku: 'E' } },
    ]);

    const after = encodeValidRowsCursor({ executionId, recordNumber: 3 });
    const page = await service.list(organizationId, importId, {
      limit: 2,
      after,
    });
    expect(page.data.map((row) => row.recordNumber)).toEqual([5, 7]);
    expect(page.nextCursor).toBe(
      encodeValidRowsCursor({ executionId, recordNumber: 7 }),
    );
    expect(imports.listValidRows).toHaveBeenCalledWith(
      expect.objectContaining({ afterRecordNumber: 3, limit: 3 }),
    );
  });

  it('returns null nextCursor on the last page', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    imports.listValidRows.mockResolvedValue([
      { recordNumber: 9, payload: { sku: 'E' } },
    ]);

    const page = await service.list(organizationId, importId, {
      limit: 2,
      after: encodeValidRowsCursor({ executionId, recordNumber: 7 }),
    });
    expect(page.data).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('does not expose an incompatible persisted payload', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    imports.listValidRows.mockResolvedValue([
      { recordNumber: 1, payload: null },
    ]);

    await expect(
      service.list(organizationId, importId, { limit: 1 }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    try {
      await service.list(organizationId, importId, { limit: 1 });
    } catch (error) {
      const body = (error as InternalServerErrorException).getResponse() as {
        code: string;
        message: string;
      };
      expect(body.code).toBe('INTERNAL.UNEXPECTED');
      expect(JSON.stringify(body)).not.toContain('sku');
    }
  });
});
