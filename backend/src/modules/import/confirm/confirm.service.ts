import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TemplateRepository } from '../../template/template.repository.js';
import {
  confirmationFingerprint,
  confirmationJobId,
  snapshotsMatch,
} from './confirmation-fingerprint.js';
import type { ConfirmImportDto } from '../dto/confirm-import.dto.js';
import type { ConfirmImportResponseDto } from '../dto/confirm-import-response.dto.js';
import { ImportRepository } from '../import.repository.js';
import type {
  ImportExecutionRecord,
  ImportSessionRecord,
} from '../import.types.js';
import {
  buildMappingView,
  parseStoredMapping,
} from '../mapping/column-mapping.js';
import { ImportProcessingJobPublisher } from '../processing/ensure-processable-job.js';
import { toPublicProcessingFailure } from '../processing/public-processing-failure.js';
import {
  ImportSessionTransitionError,
  assertCanConfirm,
} from '../state/import-session-state.js';

@Injectable()
export class ConfirmService {
  private readonly logger = new Logger(ConfirmService.name);

  constructor(
    private readonly imports: ImportRepository,
    private readonly templates: TemplateRepository,
    private readonly jobs: ImportProcessingJobPublisher,
  ) {}

  async confirm(
    organizationId: string,
    importId: string,
    dto: ConfirmImportDto,
    traceId?: string,
  ): Promise<ConfirmImportResponseDto> {
    const session = await this.requireSession(organizationId, importId);

    if (
      session.status === 'queued' ||
      session.status === 'processing' ||
      session.status === 'ready' ||
      session.status === 'processing_failed'
    ) {
      return this.replayOrConflict(session, dto);
    }

    try {
      assertCanConfirm(session.status);
    } catch (error) {
      if (error instanceof ImportSessionTransitionError) {
        throw new ConflictException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }

    if (session.mappingRevision !== dto.expectedMappingRevision) {
      throw new ConflictException({
        code: 'IMPORT.MAPPING_REVISION_CONFLICT',
        message:
          'Mapping revision is out of date. GET the mapping and retry with the current revision.',
      });
    }

    if (
      !session.contentSha256 ||
      session.contentSha256 !== dto.expectedContentSha256
    ) {
      throw new ConflictException({
        code: 'IMPORT.FILE_CHANGED',
        message:
          'The uploaded file hash does not match expectedContentSha256.',
      });
    }

    const template = await this.templates.findByIdForOrganization(
      organizationId,
      session.templateId,
    );
    if (!template) {
      throw new NotFoundException({
        code: 'IMPORT.NOT_FOUND',
        message: 'Import session not found.',
      });
    }

    const mappingView = buildMappingView(
      parseStoredMapping(session.mapping),
      template.fields,
      session.columns,
    );
    if (!mappingView.isComplete) {
      throw new ConflictException({
        code: 'IMPORT.MAPPING_INCOMPLETE',
        message:
          'Confirmation requires every required template field to be mapped.',
      });
    }

    const fingerprint = confirmationFingerprint({
      expectedMappingRevision: dto.expectedMappingRevision,
      expectedContentSha256: dto.expectedContentSha256,
    });
    const provisionalJobId = confirmationJobId(importId, fingerprint);

    const confirmed = await this.imports.confirmSession(organizationId, importId, {
      confirmationFingerprint: fingerprint,
      expectedMappingRevision: dto.expectedMappingRevision,
      expectedContentSha256: dto.expectedContentSha256,
      jobId: provisionalJobId,
      totalRows: session.dataRowCount,
    });

    if (!confirmed) {
      const latest = await this.requireSession(organizationId, importId);
      return this.replayOrConflict(latest, dto);
    }

    await this.enqueueProcessing({
      ...confirmed.execution,
      traceId,
    });

    this.logger.log({
      msg: 'import.confirmed',
      importId,
      executionId: confirmed.execution.id,
      organizationId,
      traceId,
    });

    return this.toResponse(confirmed.session, confirmed.execution, false);
  }

  private async replayOrConflict(
    session: ImportSessionRecord,
    dto: ConfirmImportDto,
  ): Promise<ConfirmImportResponseDto> {
    const execution = await this.imports.findLatestExecution(
      session.organizationId,
      session.id,
    );
    if (!execution) {
      throw new ConflictException({
        code: 'IMPORT.CONFIRMATION_NOT_ALLOWED',
        message:
          'Confirmation is only available for uploaded sessions with a complete mapping.',
      });
    }

    const requested = {
      expectedMappingRevision: dto.expectedMappingRevision,
      expectedContentSha256: dto.expectedContentSha256,
    };
    const existing = {
      expectedMappingRevision: execution.expectedMappingRevision,
      expectedContentSha256: execution.expectedContentSha256,
    };

    if (!snapshotsMatch(requested, existing)) {
      if (
        requested.expectedMappingRevision !== existing.expectedMappingRevision
      ) {
        throw new ConflictException({
          code: 'IMPORT.MAPPING_REVISION_CONFLICT',
          message:
            'This import was already confirmed with a different mapping revision.',
        });
      }
      throw new ConflictException({
        code: 'IMPORT.FILE_CHANGED',
        message:
          'This import was already confirmed with a different file hash.',
      });
    }

    if (
      session.status === 'queued' ||
      session.status === 'processing'
    ) {
      await this.enqueueProcessing(execution);
    }

    return this.toResponse(session, execution, true);
  }

  private async enqueueProcessing(
    execution: Pick<
      ImportExecutionRecord,
      | 'id'
      | 'organizationId'
      | 'importSessionId'
      | 'jobId'
      | 'status'
    > & { traceId?: string },
  ): Promise<void> {
    try {
      await this.jobs.ensureProcessable({
        organizationId: execution.organizationId,
        importSessionId: execution.importSessionId,
        executionId: execution.id,
        jobId: execution.jobId,
        executionStatus: execution.status,
        traceId: execution.traceId,
      });
    } catch {
      this.logger.error({
        msg: 'import.processing_enqueue_failed',
        importId: execution.importSessionId,
        executionId: execution.id,
        organizationId: execution.organizationId,
        traceId: execution.traceId,
      });
      throw new ServiceUnavailableException({
        code: 'IMPORT.PROCESSING_UNAVAILABLE',
        message: 'Import processing queue is temporarily unavailable.',
      });
    }
  }

  private async requireSession(
    organizationId: string,
    importId: string,
  ): Promise<ImportSessionRecord> {
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
    return session;
  }

  private toResponse(
    session: ImportSessionRecord,
    execution: ImportExecutionRecord,
    replayed: boolean,
  ): ConfirmImportResponseDto {
    const status =
      session.status === 'processing_failed'
        ? 'processing_failed'
        : session.status === 'ready'
          ? 'ready'
          : session.status === 'processing'
            ? 'processing'
            : 'queued';

    return {
      importId: session.id,
      executionId: execution.id,
      status,
      expectedMappingRevision: execution.expectedMappingRevision,
      expectedContentSha256: execution.expectedContentSha256,
      progress: {
        processedRows: execution.processedRows,
        totalRows: execution.totalRows,
        validRows: execution.validRows,
        invalidRows: execution.invalidRows,
      },
      failure:
        status === 'processing_failed'
          ? toPublicProcessingFailure(
              execution.errorCode,
              execution.errorMessage,
            )
          : null,
      replayed,
    };
  }
}
