import { Inject, Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { TemplateRepository } from '../../template/template.repository.js';
import { ENV } from '../../../core/config/env.token.js';
import type { Env } from '../../../core/config/env.js';
import { env as bootEnv } from '../../../core/config/env.singleton.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../../integrations/object-storage/object-storage.port.js';
import {
  CsvParseError,
  parseCsvStream,
  type CsvParseResult,
} from '../csv/csv-parser.js';
import {
  FileTooLargeError,
  HashAndLimitTransform,
} from '../hash-and-limit.transform.js';
import { ImportRepository } from '../import.repository.js';
import type { ImportRecordWrite } from '../import.types.js';
import {
  buildMappingView,
  parseStoredMapping,
  type MappingPair,
} from '../mapping/column-mapping.js';
import {
  normalizeRecord,
  type TemplateFieldForNormalize,
} from '../normalize/normalize.js';
import {
  classifyNormalizedRecord,
  buildPersistBatch,
} from './persist-batch.js';
import {
  applyBatchDelta,
  emptyProgress,
  type ProgressCounters,
} from './progress.js';
import {
  IMPORT_PROCESSING_QUEUE,
  type ImportProcessingJobData,
} from './import-processing.queue.js';
import { resolveImportWorkerConcurrency } from './worker-concurrency.js';

function abortStream(stream: Readable | undefined): void {
  if (!stream || stream.destroyed) {
    return;
  }
  try {
    stream.destroy();
  } catch {
    // ignore
  }
}

function asReadable(source: Readable | AsyncIterable<unknown>): Readable {
  return source instanceof Readable ? source : Readable.from(source);
}

@Injectable()
@Processor(IMPORT_PROCESSING_QUEUE, {
  concurrency: resolveImportWorkerConcurrency(bootEnv),
})
export class ImportProcessingWorker extends WorkerHost {
  private readonly logger = new Logger(ImportProcessingWorker.name);

  constructor(
    private readonly imports: ImportRepository,
    private readonly templates: TemplateRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  async process(job: Job<ImportProcessingJobData>): Promise<void> {
    const { organizationId, importSessionId, executionId, traceId } = job.data;

    const execution = await this.imports.findExecutionById(
      organizationId,
      executionId,
    );
    if (!execution) {
      this.logger.warn({
        msg: 'import.processing.missing_execution',
        executionId,
        importSessionId,
        organizationId,
        traceId,
        jobId: job.id,
      });
      return;
    }

    if (execution.status === 'ready' || execution.status === 'failed') {
      this.logger.log({
        msg: 'import.processing.already_terminal',
        executionId,
        importSessionId,
        organizationId,
        traceId,
        jobId: job.id,
        status: execution.status,
      });
      return;
    }

    const session = await this.imports.findByIdForOrganization(
      organizationId,
      importSessionId,
    );
    if (!session) {
      await this.failDefinitive(organizationId, executionId, importSessionId, {
        code: 'IMPORT.NOT_FOUND',
        message: 'Import session not found during processing.',
      });
      throw new UnrecoverableError('Import session missing');
    }

    if (
      !session.storageObjectKey ||
      !session.contentSha256 ||
      session.delimiter === null ||
      session.encoding === null
    ) {
      await this.failDefinitive(organizationId, executionId, importSessionId, {
        code: 'IMPORT.FILE_CHANGED',
        message: 'Import file metadata is incomplete for processing.',
      });
      throw new UnrecoverableError('Incomplete file metadata');
    }

    const template = await this.templates.findByIdForOrganization(
      organizationId,
      session.templateId,
    );
    if (!template) {
      await this.failDefinitive(organizationId, executionId, importSessionId, {
        code: 'IMPORT.NOT_FOUND',
        message: 'Import template not found during processing.',
      });
      throw new UnrecoverableError('Template missing');
    }

    const mappingView = buildMappingView(
      parseStoredMapping(session.mapping),
      template.fields,
      session.columns,
    );
    if (
      !mappingView.isComplete ||
      session.mappingRevision !== execution.expectedMappingRevision
    ) {
      await this.failDefinitive(organizationId, executionId, importSessionId, {
        code: 'IMPORT.MAPPING_INCOMPLETE',
        message: 'Frozen mapping is incomplete or revision diverged.',
      });
      throw new UnrecoverableError('Mapping incomplete');
    }

    if (session.contentSha256 !== execution.expectedContentSha256) {
      await this.failDefinitive(organizationId, executionId, importSessionId, {
        code: 'IMPORT.FILE_CHANGED',
        message: 'Stored file hash diverged from the confirmed snapshot.',
      });
      throw new UnrecoverableError('File hash diverged');
    }

    const claimed = await this.imports.markExecutionProcessing(
      organizationId,
      executionId,
      importSessionId,
    );
    if (!claimed) {
      const latest = await this.imports.findExecutionById(
        organizationId,
        executionId,
      );
      if (latest?.status === 'ready' || latest?.status === 'failed') {
        return;
      }
    }

    // Clear prior attempt rows before (re)processing — not a terminal fail.
    await this.imports.deleteExecutionRecords(organizationId, executionId);

    const fields: TemplateFieldForNormalize[] = template.fields.map(
      (field) => ({
        key: field.key,
        type: field.type,
        required: field.required,
      }),
    );
    const mappings = mappingView.mappings as MappingPair[];

    let progress = emptyProgress(session.dataRowCount);
    let pending: ReturnType<typeof classifyNormalizedRecord>[] = [];
    const batchSize = this.env.IMPORT_PERSIST_BATCH_SIZE;
    let opened: Readable | undefined;
    const hasher = new HashAndLimitTransform(this.env.IMPORT_MAX_FILE_BYTES);

    try {
      opened = await this.storage.openObject(session.storageObjectKey);

      const limits = {
        maxDataRows: this.env.IMPORT_MAX_DATA_ROWS,
        maxColumns: this.env.IMPORT_MAX_COLUMNS,
        maxFieldBytes: this.env.IMPORT_MAX_FIELD_BYTES,
      };

      const run = pipeline(opened, hasher, async (source) =>
        parseCsvStream(asReadable(source), limits, {
          onRecord: async (row, recordNumber) => {
            const normalized = normalizeRecord(row, mappings, fields);
            pending.push(classifyNormalizedRecord(recordNumber, normalized));

            const { flush, rest } = buildPersistBatch(pending, batchSize);
            pending = rest;
            if (flush.length > 0) {
              progress = await this.flushBatch(
                organizationId,
                importSessionId,
                executionId,
                flush,
                progress,
              );
            }
          },
        }),
      ) as Promise<CsvParseResult>;

      const parsed = await run;

      if (pending.length > 0) {
        progress = await this.flushBatch(
          organizationId,
          importSessionId,
          executionId,
          pending,
          progress,
        );
        pending = [];
      }

      if (hasher.digest() !== execution.expectedContentSha256) {
        await this.failDefinitive(organizationId, executionId, importSessionId, {
          code: 'IMPORT.FILE_CHANGED',
          message: 'Recalculated content hash diverged during processing.',
        });
        throw new UnrecoverableError('Hash mismatch after processing');
      }

      if (
        session.dataRowCount !== null &&
        parsed.dataRowCount !== session.dataRowCount
      ) {
        await this.failDefinitive(organizationId, executionId, importSessionId, {
          code: 'IMPORT.FILE_CHANGED',
          message: 'Parsed row count diverged from the uploaded snapshot.',
        });
        throw new UnrecoverableError('Row count mismatch');
      }

      progress = {
        ...progress,
        totalRows: parsed.dataRowCount,
        processedRows: parsed.dataRowCount,
      };

      const published = await this.imports.markExecutionReady(
        organizationId,
        executionId,
        importSessionId,
        progress,
      );
      if (!published) {
        this.logger.warn({
          msg: 'import.processing.ready_cas_miss',
          executionId,
          importSessionId,
          organizationId,
          traceId,
          jobId: job.id,
        });
        return;
      }

      this.logger.log({
        msg: 'import.processing.ready',
        executionId,
        importSessionId,
        organizationId,
        traceId,
        jobId: job.id,
        processedRows: progress.processedRows,
        validRows: progress.validRows,
        invalidRows: progress.invalidRows,
      });
    } catch (error) {
      abortStream(opened);
      abortStream(hasher);

      if (error instanceof UnrecoverableError) {
        throw error;
      }

      if (error instanceof CsvParseError || error instanceof FileTooLargeError) {
        await this.failDefinitive(organizationId, executionId, importSessionId, {
          code:
            error instanceof FileTooLargeError
              ? 'IMPORT.FILE_TOO_LARGE'
              : 'IMPORT.INVALID_CSV',
          message: error.message,
        });
        throw new UnrecoverableError(error.message);
      }

      const attempts = job.opts.attempts ?? this.env.IMPORT_WORKER_MAX_ATTEMPTS;
      if (job.attemptsMade + 1 >= attempts) {
        await this.failDefinitive(organizationId, executionId, importSessionId, {
          code: 'IMPORT.PROCESSING_FAILED',
          message: 'Import processing failed after exhausting retries.',
        });
      }

      this.logger.error({
        msg: 'import.processing.transient_failure',
        executionId,
        importSessionId,
        organizationId,
        traceId,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
      });
      throw error;
    }
  }

  private async flushBatch(
    organizationId: string,
    importSessionId: string,
    executionId: string,
    batch: ReturnType<typeof classifyNormalizedRecord>[],
    progress: ProgressCounters,
  ): Promise<ProgressCounters> {
    const writes: ImportRecordWrite[] = batch.map((item) => ({
      recordNumber: item.recordNumber,
      classification: item.classification,
      payload: item.payload,
      errors: item.errors,
    }));

    await this.imports.upsertRecordBatch(
      organizationId,
      importSessionId,
      executionId,
      writes,
    );

    const delta = {
      valid: batch.filter((item) => item.classification === 'valid').length,
      invalid: batch.filter((item) => item.classification === 'invalid').length,
    };
    const next = applyBatchDelta(progress, delta);
    await this.imports.updateExecutionProgress(
      organizationId,
      executionId,
      next,
    );
    return next;
  }

  private async failDefinitive(
    organizationId: string,
    executionId: string,
    importSessionId: string,
    error: { code: string; message: string },
  ): Promise<void> {
    await this.imports.failExecutionAndDiscardRecords(
      organizationId,
      executionId,
      importSessionId,
      error,
    );
    this.logger.error({
      msg: 'import.processing.failed',
      executionId,
      importSessionId,
      organizationId,
      code: error.code,
    });
  }
}
