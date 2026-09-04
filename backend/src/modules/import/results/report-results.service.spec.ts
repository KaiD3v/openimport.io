import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportResultsService } from './report-results.service.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const importId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const executionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function readySession() {
  return {
    id: importId,
    organizationId,
    status: 'ready' as const,
  };
}

function readyExecution(overrides: { validRows?: number } = {}) {
  return {
    id: executionId,
    organizationId,
    importSessionId: importId,
    status: 'ready' as const,
    validRows: overrides.validRows ?? 5,
  };
}

describe('ReportResultsService', () => {
  let imports: {
    findByIdForOrganization: ReturnType<typeof vi.fn>;
    findLatestExecution: ReturnType<typeof vi.fn>;
    findExecutionById: ReturnType<typeof vi.fn>;
    findResultBatchByIdempotencyKeyHash: ReturnType<typeof vi.fn>;
    findValidRecordNumbers: ReturnType<typeof vi.fn>;
    findExistingRecordResults: ReturnType<typeof vi.fn>;
    createResultBatchWithItems: ReturnType<typeof vi.fn>;
    summarizeClientResults: ReturnType<typeof vi.fn>;
  };
  let service: ReportResultsService;

  beforeEach(() => {
    imports = {
      findByIdForOrganization: vi.fn(),
      findLatestExecution: vi.fn(),
      findExecutionById: vi.fn(),
      findResultBatchByIdempotencyKeyHash: vi.fn(),
      findValidRecordNumbers: vi.fn(),
      findExistingRecordResults: vi.fn(),
      createResultBatchWithItems: vi.fn(),
      summarizeClientResults: vi.fn(),
    };
    service = new ReportResultsService(imports as never, {
      IMPORT_RESULT_BATCH_MAX_SIZE: 100,
    } as never);
  });

  it('rejects missing Idempotency-Key', async () => {
    await expect(
      service.report(organizationId, importId, {
        executionId,
        results: [{ recordNumber: 1, outcome: 'accepted' }],
      }, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 404 when the session is missing', async () => {
    imports.findByIdForOrganization.mockResolvedValue(null);
    await expect(
      service.summarize(organizationId, importId),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.NOT_FOUND' },
    });
  });

  it('returns RESULTS_NOT_ALLOWED before ready', async () => {
    imports.findByIdForOrganization.mockResolvedValue({
      ...readySession(),
      status: 'uploaded',
    });
    await expect(
      service.summarize(organizationId, importId),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.summarize(organizationId, importId),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.RESULTS_NOT_ALLOWED' },
    });
  });

  it('rejects duplicate record numbers in the request', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    imports.findResultBatchByIdempotencyKeyHash.mockResolvedValue(null);

    await expect(
      service.report(
        organizationId,
        importId,
        {
          executionId,
          results: [
            { recordNumber: 1, outcome: 'accepted' },
            { recordNumber: 1, outcome: 'rejected', error: { code: 'X', message: 'y' } },
          ],
        },
        'results-key-001',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects unknown or invalid record numbers', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    imports.findResultBatchByIdempotencyKeyHash.mockResolvedValue(null);
    imports.findValidRecordNumbers.mockResolvedValue([1]);

    await expect(
      service.report(
        organizationId,
        importId,
        {
          executionId,
          results: [
            { recordNumber: 1, outcome: 'accepted' },
            { recordNumber: 2, outcome: 'accepted' },
          ],
        },
        'results-key-002',
      ),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.RESULTS_INVALID' },
    });
  });

  it('rejects wrong executionId', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());

    await expect(
      service.report(
        organizationId,
        importId,
        {
          executionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          results: [{ recordNumber: 1, outcome: 'accepted' }],
        },
        'results-key-003',
      ),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.RESULTS_INVALID' },
    });
  });

  it('persists a mixed batch and returns summary', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    imports.findResultBatchByIdempotencyKeyHash.mockResolvedValue(null);
    imports.findValidRecordNumbers.mockResolvedValue([1, 3]);
    imports.findExistingRecordResults.mockResolvedValue([]);
    imports.createResultBatchWithItems.mockResolvedValue({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      organizationId,
      importSessionId: importId,
      executionId,
      idempotencyKeyHash: 'hash',
      requestFingerprint: 'fp',
      itemCount: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    imports.findExecutionById.mockResolvedValue(readyExecution());
    imports.summarizeClientResults.mockResolvedValue({
      totalValid: 5,
      reported: 2,
      accepted: 1,
      rejected: 1,
      pending: 3,
      isComplete: false,
    });

    const response = await service.report(
      organizationId,
      importId,
      {
        executionId,
        results: [
          { recordNumber: 1, outcome: 'accepted', clientRecordId: 'c1' },
          {
            recordNumber: 3,
            outcome: 'rejected',
            error: { code: 'SKU_EXISTS', message: 'exists' },
          },
        ],
      },
      'results-key-004',
    );

    expect(response.replayed).toBe(false);
    expect(response.summary).toEqual({
      importId,
      executionId,
      totalValid: 5,
      reported: 2,
      accepted: 1,
      rejected: 1,
      pending: 3,
      isComplete: false,
    });
    expect(imports.createResultBatchWithItems).toHaveBeenCalledOnce();
  });

  it('replays an identical idempotent batch without creating again', async () => {
    const batch = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      organizationId,
      importSessionId: importId,
      executionId,
      idempotencyKeyHash: 'hash',
      requestFingerprint: '',
      itemCount: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    // fingerprint filled after first call path — stub by accepting any existing batch match via spy
    const dto = {
      executionId,
      results: [{ recordNumber: 1, outcome: 'accepted' as const }],
    };
    // Precompute by running create path once with fingerprint from service internals:
    imports.findResultBatchByIdempotencyKeyHash.mockImplementation(async () => {
      // Return batch with matching fingerprint by letting service compute then we set it
      return null;
    });

    // First create to capture fingerprint from create call
    imports.findValidRecordNumbers.mockResolvedValue([1]);
    imports.findExistingRecordResults.mockResolvedValue([]);
    let storedFingerprint = '';
    imports.createResultBatchWithItems.mockImplementation(async (params) => {
      storedFingerprint = params.requestFingerprint;
      return { ...batch, requestFingerprint: storedFingerprint };
    });
    imports.findExecutionById.mockResolvedValue(readyExecution());
    imports.summarizeClientResults.mockResolvedValue({
      totalValid: 5,
      reported: 1,
      accepted: 1,
      rejected: 0,
      pending: 4,
      isComplete: false,
    });

    const first = await service.report(
      organizationId,
      importId,
      dto,
      'results-key-005',
    );
    expect(first.replayed).toBe(false);

    imports.findResultBatchByIdempotencyKeyHash.mockResolvedValue({
      ...batch,
      requestFingerprint: storedFingerprint,
    });
    const second = await service.report(
      organizationId,
      importId,
      dto,
      'results-key-005',
    );
    expect(second.replayed).toBe(true);
    expect(second.batchId).toBe(batch.id);
    expect(imports.createResultBatchWithItems).toHaveBeenCalledOnce();
  });

  it('returns KEY_REUSED when the same key carries a different payload', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    imports.findResultBatchByIdempotencyKeyHash.mockResolvedValue({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      organizationId,
      importSessionId: importId,
      executionId,
      idempotencyKeyHash: 'hash',
      requestFingerprint: 'different',
      itemCount: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.report(
        organizationId,
        importId,
        {
          executionId,
          results: [{ recordNumber: 1, outcome: 'accepted' }],
        },
        'results-key-006',
      ),
    ).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY.KEY_REUSED' },
    });
  });

  it('returns RESULTS_CONFLICT when a record was already finalized', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution());
    imports.findResultBatchByIdempotencyKeyHash.mockResolvedValue(null);
    imports.findValidRecordNumbers.mockResolvedValue([1]);
    imports.findExistingRecordResults.mockResolvedValue([
      { recordNumber: 1, outcome: 'accepted' },
    ]);

    await expect(
      service.report(
        organizationId,
        importId,
        {
          executionId,
          results: [
            {
              recordNumber: 1,
              outcome: 'rejected',
              error: { code: 'X', message: 'no' },
            },
          ],
        },
        'results-key-007',
      ),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.RESULTS_CONFLICT' },
    });
  });

  it('marks zero-valid executions as complete in the summary', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution({ validRows: 0 }));
    imports.summarizeClientResults.mockResolvedValue({
      totalValid: 0,
      reported: 0,
      accepted: 0,
      rejected: 0,
      pending: 0,
      isComplete: true,
    });

    await expect(service.summarize(organizationId, importId)).resolves.toEqual({
      importId,
      executionId,
      totalValid: 0,
      reported: 0,
      accepted: 0,
      rejected: 0,
      pending: 0,
      isComplete: true,
    });
  });

  it('does not throw NotFound for summarize of a ready zero-valid import', async () => {
    imports.findByIdForOrganization.mockResolvedValue(readySession());
    imports.findLatestExecution.mockResolvedValue(readyExecution({ validRows: 0 }));
    imports.summarizeClientResults.mockResolvedValue({
      totalValid: 0,
      reported: 0,
      accepted: 0,
      rejected: 0,
      pending: 0,
      isComplete: true,
    });
    await expect(service.summarize(organizationId, importId)).resolves.not.toBeInstanceOf(
      NotFoundException,
    );
  });
});
