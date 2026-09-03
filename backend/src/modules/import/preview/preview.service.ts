import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { TemplateRepository } from '../../template/template.repository.js';
import type { ImportTemplateRecord } from '../../template/template.types.js';
import { ENV } from '../../../core/config/env.token.js';
import type { Env } from '../../../core/config/env.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../../integrations/object-storage/object-storage.port.js';
import {
  CsvParseError,
  parseCsvStream,
  type CsvParseResult,
} from '../csv/csv-parser.js';
import type { CreateImportPreviewDto } from '../dto/create-import-preview.dto.js';
import type {
  ImportPreviewResponseDto,
  ImportPreviewRowDto,
} from '../dto/import-preview-response.dto.js';
import {
  FileTooLargeError,
  HashAndLimitTransform,
} from '../hash-and-limit.transform.js';
import { ImportRepository } from '../import.repository.js';
import type { ImportSessionRecord } from '../import.types.js';
import {
  buildMappingView,
  parseStoredMapping,
  type MappingPair,
} from '../mapping/column-mapping.js';
import {
  NORMALIZATION_PROFILE,
  normalizeRecord,
  type TemplateFieldForNormalize,
} from '../normalize/normalize.js';
import {
  PREVIEW_DEFAULT_LIMIT,
  PREVIEW_MAX_RESPONSE_BYTES,
  canAppendPreviewRow,
  trimPreviewToBudget,
} from './sample-budget.js';
import {
  ImportSessionTransitionError,
  assertCanPreview,
} from '../state/import-session-state.js';

function abortStream(stream: Readable | undefined): void {
  if (!stream || stream.destroyed) {
    return;
  }
  try {
    stream.destroy();
  } catch {
    // Destroy must remain idempotent even if a source throws.
  }
}

function observePromise(promise: Promise<unknown>): void {
  void promise.then(
    () => undefined,
    () => undefined,
  );
}

function flattenErrors(error: unknown): unknown[] {
  if (error instanceof AggregateError) {
    return [error, ...error.errors.flatMap((item) => flattenErrors(item))];
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'errors' in error &&
    Array.isArray((error as { errors: unknown }).errors)
  ) {
    return [
      error,
      ...(error as { errors: unknown[] }).errors.flatMap((item) =>
        flattenErrors(item),
      ),
    ];
  }
  if (error instanceof Error && error.cause !== undefined) {
    return [error, ...flattenErrors(error.cause)];
  }
  return [error];
}

function asReadable(source: Readable | AsyncIterable<unknown>): Readable {
  return source instanceof Readable ? source : Readable.from(source);
}

@Injectable()
export class PreviewService {
  constructor(
    private readonly imports: ImportRepository,
    private readonly templates: TemplateRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async preview(
    organizationId: string,
    importId: string,
    dto: CreateImportPreviewDto,
  ): Promise<ImportPreviewResponseDto> {
    const session = await this.requireSession(organizationId, importId);
    this.assertPreviewAllowed(session.status);

    if (session.mappingRevision !== dto.expectedMappingRevision) {
      throw new ConflictException({
        code: 'IMPORT.MAPPING_REVISION_CONFLICT',
        message:
          'Mapping revision is out of date. GET the mapping and retry with the current revision.',
      });
    }

    const template = await this.requireTemplate(
      organizationId,
      session.templateId,
    );
    const mappingView = buildMappingView(
      parseStoredMapping(session.mapping),
      template.fields,
      session.columns,
    );
    if (!mappingView.isComplete) {
      throw new ConflictException({
        code: 'IMPORT.MAPPING_INCOMPLETE',
        message:
          'Preview requires every required template field to be mapped.',
      });
    }

    if (
      !session.storageObjectKey ||
      !session.contentSha256 ||
      session.dataRowCount === null
    ) {
      throw new ServiceUnavailableException({
        code: 'IMPORT.PREVIEW_UNAVAILABLE',
        message: 'The import file could not be read for preview.',
      });
    }

    const snapshot = {
      mappingRevision: session.mappingRevision,
      mappings: mappingView.mappings,
      fields: template.fields.map(
        (field): TemplateFieldForNormalize => ({
          key: field.key,
          type: field.type,
          required: field.required,
        }),
      ),
      contentSha256: session.contentSha256,
      columns: session.columns.map((column) => column.name),
      dataRowCount: session.dataRowCount,
      storageObjectKey: session.storageObjectKey,
    };

    const limit = dto.limit ?? PREVIEW_DEFAULT_LIMIT;
    let opened: Readable | undefined;

    try {
      opened = await this.storage.openObject(snapshot.storageObjectKey);
    } catch {
      throw new ServiceUnavailableException({
        code: 'IMPORT.PREVIEW_UNAVAILABLE',
        message: 'The import file could not be read for preview.',
      });
    }

    const hasher = new HashAndLimitTransform(this.env.IMPORT_MAX_FILE_BYTES);

    const sampleRows: ImportPreviewRowDto[] = [];
    let validRows = 0;
    let invalidRows = 0;
    let stopSampling = false;
    const maxCount = snapshot.dataRowCount;

    const envelope = {
      importId,
      mappingRevision: snapshot.mappingRevision,
      contentSha256: snapshot.contentSha256,
      normalizationProfile: NORMALIZATION_PROFILE,
      summary: { totalRows: 0, validRows: 0, invalidRows: 0 },
      limit,
      sampleTruncated: true,
      rows: sampleRows,
    };

    const limits = {
      maxDataRows: this.env.IMPORT_MAX_DATA_ROWS,
      maxColumns: this.env.IMPORT_MAX_COLUMNS,
      maxFieldBytes: this.env.IMPORT_MAX_FIELD_BYTES,
    };

    const run = pipeline(opened, hasher, async (source) =>
      parseCsvStream(asReadable(source), limits, {
        onRecord: (row, recordNumber) => {
          const normalized = normalizeRecord(
            row,
            snapshot.mappings as MappingPair[],
            snapshot.fields,
          );
          if (normalized.valid) {
            validRows += 1;
          } else {
            invalidRows += 1;
          }

          const previewRow: ImportPreviewRowDto = {
            recordNumber,
            valid: normalized.valid,
            data: normalized.data,
            errors: normalized.errors,
          };

          if (!stopSampling && sampleRows.length < limit) {
            if (
              canAppendPreviewRow(envelope, previewRow, {
                maxCount,
                maxBytes: PREVIEW_MAX_RESPONSE_BYTES,
              })
            ) {
              sampleRows.push(previewRow);
            } else {
              stopSampling = true;
            }
          }
        },
      }),
    ) as Promise<CsvParseResult>;
    observePromise(run);

    try {
      const parsed = await run;

      if (
        hasher.digest() !== snapshot.contentSha256 ||
        parsed.dataRowCount !== snapshot.dataRowCount ||
        parsed.columns.length !== snapshot.columns.length ||
        parsed.columns.some(
          (name, index) => name !== snapshot.columns[index],
        )
      ) {
        throw new ConflictException({
          code: 'IMPORT.FILE_CHANGED',
          message: 'Stored file no longer matches the upload metadata.',
        });
      }

      const current = await this.imports.findByIdForOrganization(
        organizationId,
        importId,
      );
      if (!current) {
        throw new NotFoundException({
          code: 'IMPORT.NOT_FOUND',
          message: 'Import session not found.',
        });
      }
      if (current.mappingRevision !== snapshot.mappingRevision) {
        throw new ConflictException({
          code: 'IMPORT.MAPPING_REVISION_CONFLICT',
          message:
            'Mapping revision is out of date. GET the mapping and retry with the current revision.',
        });
      }

      const response = {
        importId,
        mappingRevision: snapshot.mappingRevision,
        contentSha256: snapshot.contentSha256,
        normalizationProfile: NORMALIZATION_PROFILE,
        summary: {
          totalRows: parsed.dataRowCount,
          validRows,
          invalidRows,
        },
        limit,
        sampleTruncated: sampleRows.length < parsed.dataRowCount,
        rows: sampleRows,
      };
      return trimPreviewToBudget(response);
    } catch (error) {
      abortStream(opened);
      abortStream(hasher);
      throw this.toHttpError(error);
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

  private async requireTemplate(
    organizationId: string,
    templateId: string,
  ): Promise<ImportTemplateRecord> {
    const template = await this.templates.findByIdForOrganization(
      organizationId,
      templateId,
    );
    if (!template) {
      throw new NotFoundException({
        code: 'TEMPLATE.NOT_FOUND',
        message: 'Template not found.',
      });
    }
    return template;
  }

  private assertPreviewAllowed(
    status: ImportSessionRecord['status'],
  ): void {
    try {
      assertCanPreview(status);
    } catch (error) {
      if (error instanceof ImportSessionTransitionError) {
        throw new ConflictException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private toHttpError(error: unknown): HttpException {
    for (const candidate of flattenErrors(error)) {
      if (candidate instanceof HttpException) {
        return candidate;
      }
      if (candidate instanceof FileTooLargeError) {
        return new HttpException(
          {
            code: 'IMPORT.FILE_TOO_LARGE',
            message: candidate.message,
          },
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
      if (candidate instanceof CsvParseError) {
        return new UnprocessableEntityException({
          code: 'IMPORT.INVALID_CSV',
          message: candidate.message,
        });
      }
    }
    return new ServiceUnavailableException({
      code: 'IMPORT.PREVIEW_UNAVAILABLE',
      message: 'The import file could not be read for preview.',
    });
  }
}
