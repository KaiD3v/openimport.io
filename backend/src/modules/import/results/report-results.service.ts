import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ENV } from '../../../core/config/env.token.js';
import type { Env } from '../../../core/config/env.js';
import type { ReportImportResultsDto } from '../dto/report-import-results.dto.js';
import type {
  ImportResultsSummaryDto,
  ReportImportResultsResponseDto,
} from '../dto/report-import-results-response.dto.js';
import {
  assertIdempotencyKey,
  hashIdempotencyKey,
  IdempotencyKeyError,
} from '../idempotency/idempotency.js';
import { ImportRepository } from '../import.repository.js';
import type {
  ImportRecordResultWrite,
  ImportResultBatchRecord,
} from '../import.types.js';
import { fingerprintReportResultsRequest } from './results-fingerprint.js';

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

@Injectable()
export class ReportResultsService {
  constructor(
    private readonly imports: ImportRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async summarize(
    organizationId: string,
    importId: string,
  ): Promise<ImportResultsSummaryDto> {
    const { execution } = await this.loadReadySession(organizationId, importId);
    const counts = await this.imports.summarizeClientResults({
      organizationId,
      executionId: execution.id,
      totalValid: execution.validRows,
    });
    return {
      importId,
      executionId: execution.id,
      ...counts,
    };
  }

  async report(
    organizationId: string,
    importId: string,
    dto: ReportImportResultsDto,
    idempotencyKeyHeader: string | string[] | undefined,
  ): Promise<ReportImportResultsResponseDto> {
    let idempotencyKey: string;
    try {
      idempotencyKey = assertIdempotencyKey(idempotencyKeyHeader);
    } catch (error) {
      if (error instanceof IdempotencyKeyError) {
        throw new BadRequestException({
          code: 'VALIDATION.FAILED',
          message: error.message,
        });
      }
      throw error;
    }

    const { execution } = await this.loadReadySession(organizationId, importId);

    if (dto.executionId !== execution.id || execution.status !== 'ready') {
      throw new UnprocessableEntityException({
        code: 'IMPORT.RESULTS_INVALID',
        message:
          'One or more result items are invalid for this ready execution.',
        details: [{ field: 'executionId', reason: 'execution_mismatch' }],
      });
    }

    if (dto.results.length > this.env.IMPORT_RESULT_BATCH_MAX_SIZE) {
      throw new BadRequestException({
        code: 'VALIDATION.FAILED',
        message: `results must contain at most ${this.env.IMPORT_RESULT_BATCH_MAX_SIZE} items.`,
      });
    }

    this.assertNoDuplicateRecordNumbers(dto);
    this.assertAcceptedItemsHaveNoError(dto);

    const idempotencyKeyHash = hashIdempotencyKey(idempotencyKey);
    const requestFingerprint = fingerprintReportResultsRequest({
      executionId: dto.executionId,
      results: dto.results.map((item) => ({
        recordNumber: item.recordNumber,
        outcome: item.outcome,
        clientRecordId: item.clientRecordId,
        error: item.error,
      })),
    });

    const existingBatch = await this.imports.findResultBatchByIdempotencyKeyHash(
      organizationId,
      idempotencyKeyHash,
    );
    if (existingBatch) {
      return this.replayOrConflict(
        importId,
        execution.id,
        existingBatch,
        requestFingerprint,
      );
    }

    const items = this.toWrites(dto);
    const recordNumbers = items.map((item) => item.recordNumber);

    const validNumbers = await this.imports.findValidRecordNumbers({
      organizationId,
      importSessionId: importId,
      executionId: execution.id,
      recordNumbers,
    });
    if (validNumbers.length !== recordNumbers.length) {
      throw new UnprocessableEntityException({
        code: 'IMPORT.RESULTS_INVALID',
        message:
          'One or more result items are invalid for this ready execution.',
        details: [{ field: 'results', reason: 'invalid_or_unknown_record' }],
      });
    }

    const existingResults = await this.imports.findExistingRecordResults({
      organizationId,
      executionId: execution.id,
      recordNumbers,
    });
    if (existingResults.length > 0) {
      throw new ConflictException({
        code: 'IMPORT.RESULTS_CONFLICT',
        message:
          'A final client result already exists for one or more records.',
      });
    }

    try {
      const batch = await this.imports.createResultBatchWithItems({
        organizationId,
        importSessionId: importId,
        executionId: execution.id,
        idempotencyKeyHash,
        requestFingerprint,
        items,
      });
      return this.toReportResponse(importId, execution.id, batch, false);
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const racedBatch =
        await this.imports.findResultBatchByIdempotencyKeyHash(
          organizationId,
          idempotencyKeyHash,
        );
      if (racedBatch) {
        return this.replayOrConflict(
          importId,
          execution.id,
          racedBatch,
          requestFingerprint,
        );
      }

      throw new ConflictException({
        code: 'IMPORT.RESULTS_CONFLICT',
        message:
          'A final client result already exists for one or more records.',
      });
    }
  }

  private replayOrConflict(
    importId: string,
    executionId: string,
    existingBatch: ImportResultBatchRecord,
    requestFingerprint: string,
  ): Promise<ReportImportResultsResponseDto> {
    if (existingBatch.requestFingerprint !== requestFingerprint) {
      throw new ConflictException({
        code: 'IDEMPOTENCY.KEY_REUSED',
        message:
          'Idempotency-Key was already used with a different request payload.',
      });
    }
    if (
      existingBatch.importSessionId !== importId ||
      existingBatch.executionId !== executionId
    ) {
      throw new ConflictException({
        code: 'IDEMPOTENCY.KEY_REUSED',
        message:
          'Idempotency-Key was already used with a different request payload.',
      });
    }
    return this.toReportResponse(importId, executionId, existingBatch, true);
  }

  private async loadReadySession(organizationId: string, importId: string) {
    const session = await this.imports.findByIdForOrganization(
      organizationId,
      importId,
    );
    if (!session) {
      throw new NotFoundException({
        code: 'IMPORT.NOT_FOUND',
        message: 'Import session not found.',
      });
    }

    if (session.status !== 'ready') {
      throw new ConflictException({
        code: 'IMPORT.RESULTS_NOT_ALLOWED',
        message:
          'Client results can only be reported after processing completes successfully.',
      });
    }

    const execution = await this.imports.findLatestExecution(
      organizationId,
      importId,
    );
    if (!execution || execution.status !== 'ready') {
      throw new ConflictException({
        code: 'IMPORT.RESULTS_NOT_ALLOWED',
        message:
          'Client results can only be reported after processing completes successfully.',
      });
    }

    return { session, execution };
  }

  private assertNoDuplicateRecordNumbers(dto: ReportImportResultsDto): void {
    const seen = new Set<number>();
    for (const item of dto.results) {
      if (seen.has(item.recordNumber)) {
        throw new UnprocessableEntityException({
          code: 'IMPORT.RESULTS_INVALID',
          message:
            'One or more result items are invalid for this ready execution.',
          details: [
            {
              field: 'results',
              reason: 'duplicate_record_number',
              recordNumber: item.recordNumber,
            },
          ],
        });
      }
      seen.add(item.recordNumber);
    }
  }

  private assertAcceptedItemsHaveNoError(dto: ReportImportResultsDto): void {
    for (const item of dto.results) {
      if (item.outcome === 'accepted' && item.error !== undefined) {
        throw new UnprocessableEntityException({
          code: 'IMPORT.RESULTS_INVALID',
          message:
            'One or more result items are invalid for this ready execution.',
          details: [
            {
              field: 'results',
              reason: 'accepted_must_omit_error',
              recordNumber: item.recordNumber,
            },
          ],
        });
      }
    }
  }

  private toWrites(dto: ReportImportResultsDto): ImportRecordResultWrite[] {
    return dto.results.map((item) => ({
      recordNumber: item.recordNumber,
      outcome: item.outcome,
      clientRecordId: item.clientRecordId ?? null,
      errorCode: item.outcome === 'rejected' ? (item.error?.code ?? null) : null,
      errorMessage:
        item.outcome === 'rejected' ? (item.error?.message ?? null) : null,
    }));
  }

  private async toReportResponse(
    importId: string,
    executionId: string,
    batch: ImportResultBatchRecord,
    replayed: boolean,
  ): Promise<ReportImportResultsResponseDto> {
    const execution = await this.imports.findExecutionById(
      batch.organizationId,
      executionId,
    );
    const totalValid = execution?.validRows ?? 0;
    const counts = await this.imports.summarizeClientResults({
      organizationId: batch.organizationId,
      executionId,
      totalValid,
    });
    return {
      importId,
      executionId,
      batchId: batch.id,
      replayed,
      summary: {
        importId,
        executionId,
        ...counts,
      },
    };
  }
}
