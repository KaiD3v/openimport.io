import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import type {
  CreateExecutionData,
  CreateImportSessionData,
  ImportExecutionRecord,
  ImportMappingPairRecord,
  ImportRecordWrite,
  ImportRejectedRecord,
  ImportSessionRecord,
  MarkUploadedData,
} from './import.types.js';
import type { ProgressCounters } from './processing/progress.js';
import type { FieldError } from './normalize/normalize.js';

const sessionInclude = {
  columns: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      name: true,
      position: true,
    },
  },
};

@Injectable()
export class ImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    organizationId: string,
    data: CreateImportSessionData,
  ): Promise<ImportSessionRecord> {
    return this.prisma.importSession.create({
      data: {
        organizationId,
        templateId: data.templateId,
        idempotencyKeyHash: data.idempotencyKeyHash,
        requestFingerprint: data.requestFingerprint,
        status: 'created',
      },
      include: sessionInclude,
    });
  }

  findByIdempotencyKeyHash(
    organizationId: string,
    idempotencyKeyHash: string,
  ): Promise<ImportSessionRecord | null> {
    return this.prisma.importSession.findFirst({
      where: { organizationId, idempotencyKeyHash },
      include: sessionInclude,
    });
  }

  findByIdForOrganization(
    organizationId: string,
    importId: string,
  ): Promise<ImportSessionRecord | null> {
    return this.prisma.importSession.findFirst({
      where: { id: importId, organizationId },
      include: sessionInclude,
    });
  }

  async markUploaded(
    organizationId: string,
    importId: string,
    data: MarkUploadedData,
  ): Promise<ImportSessionRecord> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.importSession.updateMany({
        where: {
          id: importId,
          organizationId,
          status: 'created',
        },
        data: {
          status: 'uploaded',
          originalFilename: data.originalFilename,
          byteSize: data.byteSize,
          contentSha256: data.contentSha256,
          encoding: data.encoding,
          delimiter: data.delimiter,
          dataRowCount: data.dataRowCount,
          storageObjectKey: data.storageObjectKey,
          uploadedAt: new Date(),
        },
      });

      if (updated.count !== 1) {
        throw new Error('IMPORT_STATUS_CONFLICT');
      }

      await tx.importColumn.createMany({
        data: data.columns.map((column) => ({
          importSessionId: importId,
          name: column.name,
          position: column.position,
        })),
      });

      const session = await tx.importSession.findFirst({
        where: { id: importId, organizationId },
        include: sessionInclude,
      });
      if (!session) {
        throw new Error('IMPORT_NOT_FOUND_AFTER_UPLOAD');
      }
      return session;
    });
  }

  async markUploadFailed(
    organizationId: string,
    importId: string,
  ): Promise<void> {
    await this.prisma.importSession.updateMany({
      where: {
        id: importId,
        organizationId,
        status: 'created',
      },
      data: {
        status: 'upload_failed',
      },
    });
  }

  async replaceMapping(
    organizationId: string,
    importId: string,
    expectedRevision: number,
    mappings: ImportMappingPairRecord[],
  ): Promise<ImportSessionRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.importSession.updateMany({
        where: {
          id: importId,
          organizationId,
          status: 'uploaded',
          mappingRevision: expectedRevision,
        },
        data: {
          mapping: mappings as Prisma.InputJsonValue,
          mappingRevision: expectedRevision + 1,
        },
      });

      if (updated.count !== 1) {
        return null;
      }

      const session = await tx.importSession.findFirst({
        where: { id: importId, organizationId },
        include: sessionInclude,
      });
      if (!session) {
        throw new Error('IMPORT_NOT_FOUND_AFTER_MAPPING');
      }
      return session;
    });
  }

  findLatestExecution(
    organizationId: string,
    importSessionId: string,
  ): Promise<ImportExecutionRecord | null> {
    return this.prisma.importExecution.findFirst({
      where: { organizationId, importSessionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findExecutionById(
    organizationId: string,
    executionId: string,
  ): Promise<ImportExecutionRecord | null> {
    return this.prisma.importExecution.findFirst({
      where: { id: executionId, organizationId },
    });
  }

  findExecutionByFingerprint(
    organizationId: string,
    importSessionId: string,
    confirmationFingerprint: string,
  ): Promise<ImportExecutionRecord | null> {
    return this.prisma.importExecution.findFirst({
      where: {
        organizationId,
        importSessionId,
        confirmationFingerprint,
      },
    });
  }

  /**
   * Compare-and-swap confirm: uploaded → queued + create execution.
   * Returns null when CAS loses (caller should load existing execution).
   */
  async confirmSession(
    organizationId: string,
    importId: string,
    data: CreateExecutionData,
  ): Promise<{
    session: ImportSessionRecord;
    execution: ImportExecutionRecord;
  } | null> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.importSession.updateMany({
        where: {
          id: importId,
          organizationId,
          status: 'uploaded',
          mappingRevision: data.expectedMappingRevision,
          contentSha256: data.expectedContentSha256,
        },
        data: {
          status: 'queued',
          confirmedAt: new Date(),
        },
      });

      if (updated.count !== 1) {
        return null;
      }

      const execution = await tx.importExecution.create({
        data: {
          organizationId,
          importSessionId: importId,
          status: 'queued',
          confirmationFingerprint: data.confirmationFingerprint,
          expectedMappingRevision: data.expectedMappingRevision,
          expectedContentSha256: data.expectedContentSha256,
          jobId: data.jobId,
          totalRows: data.totalRows,
        },
      });

      const session = await tx.importSession.findFirst({
        where: { id: importId, organizationId },
        include: sessionInclude,
      });
      if (!session) {
        throw new Error('IMPORT_NOT_FOUND_AFTER_CONFIRM');
      }

      return { session, execution };
    });
  }

  async markExecutionProcessing(
    organizationId: string,
    executionId: string,
    importSessionId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const executionUpdated = await tx.importExecution.updateMany({
        where: {
          id: executionId,
          organizationId,
          status: { in: ['queued', 'processing'] },
        },
        data: {
          status: 'processing',
          startedAt: new Date(),
          attempt: { increment: 1 },
        },
      });
      if (executionUpdated.count !== 1) {
        return false;
      }

      await tx.importSession.updateMany({
        where: {
          id: importSessionId,
          organizationId,
          status: { in: ['queued', 'processing'] },
        },
        data: { status: 'processing' },
      });
      return true;
    });
  }

  async updateExecutionProgress(
    organizationId: string,
    executionId: string,
    progress: ProgressCounters,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE import_executions
      SET
        processed_rows = GREATEST(processed_rows, ${progress.processedRows}),
        valid_rows = GREATEST(valid_rows, ${progress.validRows}),
        invalid_rows = GREATEST(invalid_rows, ${progress.invalidRows}),
        total_rows = COALESCE(${progress.totalRows}, total_rows),
        updated_at = NOW()
      WHERE id = ${executionId}::uuid
        AND organization_id = ${organizationId}::uuid
    `;
  }

  async upsertRecordBatch(
    organizationId: string,
    importSessionId: string,
    executionId: string,
    records: ImportRecordWrite[],
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    await this.prisma.$transaction(
      records.map((record) =>
        this.prisma.importRecord.upsert({
          where: {
            executionId_recordNumber: {
              executionId,
              recordNumber: record.recordNumber,
            },
          },
          create: {
            organizationId,
            importSessionId,
            executionId,
            recordNumber: record.recordNumber,
            classification: record.classification,
            payload:
              record.payload === null
                ? Prisma.JsonNull
                : (record.payload as Prisma.InputJsonValue),
            errors:
              record.errors === null
                ? Prisma.JsonNull
                : (record.errors as Prisma.InputJsonValue),
          },
          update: {
            classification: record.classification,
            payload:
              record.payload === null
                ? Prisma.JsonNull
                : (record.payload as Prisma.InputJsonValue),
            errors:
              record.errors === null
                ? Prisma.JsonNull
                : (record.errors as Prisma.InputJsonValue),
          },
        }),
      ),
    );
  }

  async markExecutionReady(
    organizationId: string,
    executionId: string,
    importSessionId: string,
    progress: ProgressCounters,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.importExecution.updateMany({
        where: {
          id: executionId,
          organizationId,
          importSessionId,
          status: 'processing',
        },
        data: {
          status: 'ready',
          processedRows: progress.processedRows,
          validRows: progress.validRows,
          invalidRows: progress.invalidRows,
          totalRows: progress.totalRows,
          finishedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });

      if (updated.count !== 1) {
        return false;
      }

      const sessionUpdated = await tx.importSession.updateMany({
        where: {
          id: importSessionId,
          organizationId,
          status: 'processing',
        },
        data: { status: 'ready' },
      });
      if (sessionUpdated.count !== 1) {
        throw new Error(
          'Import session ready CAS missed after execution was marked ready',
        );
      }
      return true;
    });
  }

  /**
   * Atomically mark execution failed, discard records, then fail the session.
   * CAS on the execution happens before any cleanup. Returns false only when
   * no mutations occurred (lost CAS against ready/missing). Throws after a won
   * execution CAS if session CAS fails so the transaction rolls back.
   */
  async failExecutionAndDiscardRecords(
    organizationId: string,
    executionId: string,
    importSessionId: string,
    error: { code: string; message: string },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.importExecution.updateMany({
        where: {
          id: executionId,
          organizationId,
          importSessionId,
          status: { in: ['queued', 'processing'] },
        },
        data: {
          status: 'failed',
          errorCode: error.code.slice(0, 80),
          errorMessage: error.message.slice(0, 500),
          finishedAt: new Date(),
          processedRows: 0,
          validRows: 0,
          invalidRows: 0,
        },
      });

      if (updated.count !== 1) {
        return this.reconcileAlreadyFailedExecution(
          tx,
          organizationId,
          executionId,
          importSessionId,
        );
      }

      await tx.importRecord.deleteMany({
        where: { organizationId, executionId },
      });

      const sessionUpdated = await tx.importSession.updateMany({
        where: {
          id: importSessionId,
          organizationId,
          status: { in: ['queued', 'processing'] },
        },
        data: { status: 'processing_failed' },
      });
      if (sessionUpdated.count !== 1) {
        throw new Error(
          'Import session failed CAS missed after execution was marked failed',
        );
      }

      return true;
    });
  }

  private async reconcileAlreadyFailedExecution(
    tx: Prisma.TransactionClient,
    organizationId: string,
    executionId: string,
    importSessionId: string,
  ): Promise<boolean> {
    const execution = await tx.importExecution.findFirst({
      where: { id: executionId, organizationId, importSessionId },
    });
    if (!execution || execution.status !== 'failed') {
      return false;
    }

    const session = await tx.importSession.findFirst({
      where: { id: importSessionId, organizationId },
    });
    if (!session) {
      return false;
    }
    if (session.status === 'ready') {
      // Divergent pair — do not delete ready snapshot records.
      return false;
    }

    await tx.importRecord.deleteMany({
      where: { organizationId, executionId },
    });

    if (session.status === 'processing_failed') {
      return true;
    }

    if (session.status === 'queued' || session.status === 'processing') {
      const sessionUpdated = await tx.importSession.updateMany({
        where: {
          id: importSessionId,
          organizationId,
          status: { in: ['queued', 'processing'] },
        },
        data: { status: 'processing_failed' },
      });
      if (sessionUpdated.count !== 1) {
        throw new Error(
          'Import session failed CAS missed while reconciling failed execution',
        );
      }
      return true;
    }

    return false;
  }

  /** @deprecated Prefer failExecutionAndDiscardRecords for terminal failures. */
  async markExecutionFailed(
    organizationId: string,
    executionId: string,
    importSessionId: string,
    error: { code: string; message: string },
  ): Promise<boolean> {
    return this.failExecutionAndDiscardRecords(
      organizationId,
      executionId,
      importSessionId,
      error,
    );
  }

  async deleteExecutionRecords(
    organizationId: string,
    executionId: string,
  ): Promise<void> {
    await this.prisma.importRecord.deleteMany({
      where: { organizationId, executionId },
    });
  }

  listRecoverableExecutions(params: {
    limit: number;
    after?: { createdAt: Date; id: string } | null;
  }): Promise<ImportExecutionRecord[]> {
    const after = params.after ?? null;
    return this.prisma.importExecution.findMany({
      where: {
        status: { in: ['queued', 'processing'] },
        ...(after
          ? {
              OR: [
                { createdAt: { gt: after.createdAt } },
                {
                  createdAt: after.createdAt,
                  id: { gt: after.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: params.limit,
    });
  }

  async listRejectedRows(params: {
    organizationId: string;
    importSessionId: string;
    executionId: string;
    afterRecordNumber: number;
    limit: number;
  }): Promise<ImportRejectedRecord[]> {
    const rows = await this.prisma.importRecord.findMany({
      where: {
        organizationId: params.organizationId,
        importSessionId: params.importSessionId,
        executionId: params.executionId,
        classification: 'invalid',
        recordNumber: { gt: params.afterRecordNumber },
      },
      orderBy: { recordNumber: 'asc' },
      take: params.limit,
      select: {
        recordNumber: true,
        errors: true,
      },
    });

    return rows.map((row) => ({
      recordNumber: row.recordNumber,
      errors: (row.errors ?? []) as FieldError[],
    }));
  }
}
