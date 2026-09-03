import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Readable } from 'node:stream';
import { TemplateRepository } from '../template/template.repository.js';
import type { ImportTemplateRecord } from '../template/template.types.js';
import { ENV } from '../../core/config/env.token.js';
import type { Env } from '../../core/config/env.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../integrations/object-storage/object-storage.port.js';
import {
  UploadCleanupError,
  persistUploadWithCleanup,
} from '../../integrations/object-storage/upload-cleanup.js';
import { CsvParseError, parseCsvStream } from './csv/csv-parser.js';
import type { AuthenticatedOrganization } from '../../core/auth/authenticated-organization.js';
import { ImportAccessTokenService } from '../../core/auth/import-access-token.service.js';
import {
  CreateImportAccessTokenDto,
  DEFAULT_IMPORT_ACCESS_TOKEN_TTL_SECONDS,
} from './dto/create-import-access-token.dto.js';
import type { CreateImportSessionDto } from './dto/create-import-session.dto.js';
import type { ImportAccessTokenResponseDto } from './dto/import-access-token-response.dto.js';
import type { ImportContextResponseDto } from './dto/import-context-response.dto.js';
import type { ImportMappingResponseDto } from './dto/import-mapping-response.dto.js';
import type { ImportSessionResponseDto } from './dto/import-session-response.dto.js';
import type { PutImportMappingDto } from './dto/put-import-mapping.dto.js';
import {
  FileTooLargeError,
  HashAndLimitTransform,
} from './hash-and-limit.transform.js';
import {
  IdempotencyKeyError,
  assertIdempotencyKey,
  fingerprintCreateImportRequest,
  hashIdempotencyKey,
} from './idempotency/idempotency.js';
import { ImportRepository } from './import.repository.js';
import type { ImportSessionRecord } from './import.types.js';
import {
  MappingValidationError,
  areMappingsSemanticallyEqual,
  buildMappingView,
  canonicalizeMapping,
  parseStoredMapping,
} from './mapping/column-mapping.js';
import {
  MultipartFileError,
  readMultipartFile,
} from './multipart-file.js';
import {
  assertCanManageMapping,
  assertCanUpload,
  ImportSessionTransitionError,
  nextStatusAfterUploadFailure,
} from './state/import-session-state.js';
import {
  buildStorageObjectKey,
  normalizeOriginalFilename,
} from './storage-key.js';

function discardReadable(stream: Readable): void {
  stream.on('error', () => undefined);
  if (!stream.destroyed && !stream.readableEnded) {
    stream.resume();
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly imports: ImportRepository,
    private readonly templates: TemplateRepository,
    private readonly importAccessTokens: ImportAccessTokenService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async createSession(
    organizationId: string,
    dto: CreateImportSessionDto,
    idempotencyKeyHeader: string | string[] | undefined,
  ): Promise<ImportSessionResponseDto> {
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

    const template = await this.templates.findByIdForOrganization(
      organizationId,
      dto.templateId,
    );
    if (!template) {
      throw new NotFoundException({
        code: 'TEMPLATE.NOT_FOUND',
        message: 'Template not found.',
      });
    }

    const idempotencyKeyHash = hashIdempotencyKey(idempotencyKey);
    const requestFingerprint = fingerprintCreateImportRequest({
      templateId: dto.templateId,
    });

    try {
      const created = await this.imports.create(organizationId, {
        templateId: dto.templateId,
        idempotencyKeyHash,
        requestFingerprint,
      });
      return this.toResponse(created);
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const existing = await this.imports.findByIdempotencyKeyHash(
        organizationId,
        idempotencyKeyHash,
      );
      if (!existing) {
        throw error;
      }
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new ConflictException({
          code: 'IDEMPOTENCY.KEY_REUSED',
          message:
            'Idempotency-Key was already used with a different request payload.',
        });
      }
      return this.toResponse(existing);
    }
  }

  async findById(
    organizationId: string,
    importId: string,
  ): Promise<ImportSessionResponseDto> {
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
    return this.toResponse(session);
  }

  async createAccessToken(
    organization: AuthenticatedOrganization,
    importId: string,
    dto: CreateImportAccessTokenDto,
  ): Promise<ImportAccessTokenResponseDto> {
    const issued = await this.importAccessTokens.issue({
      organizationId: organization.organizationId,
      importSessionId: importId,
      issuerApiKeyId: organization.apiKeyId,
      expiresInSeconds:
        dto.expiresInSeconds ?? DEFAULT_IMPORT_ACCESS_TOKEN_TTL_SECONDS,
    });
    if (!issued) {
      throw new NotFoundException({
        code: 'IMPORT.NOT_FOUND',
        message: 'Import session not found.',
      });
    }
    return {
      accessToken: issued.accessToken,
      tokenType: 'Bearer',
      importId: issued.importId,
      expiresAt: issued.expiresAt.toISOString(),
    };
  }

  async getContext(
    organizationId: string,
    importId: string,
  ): Promise<ImportContextResponseDto> {
    const session = await this.requireSession(organizationId, importId);
    const template = await this.requireTemplate(
      organizationId,
      session.templateId,
    );
    return {
      import: this.toResponse(session),
      template: {
        id: template.id,
        name: template.name,
        fields: template.fields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          position: field.position,
        })),
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      },
      mapping: this.toMappingResponse(session, template),
    };
  }

  async getMapping(
    organizationId: string,
    importId: string,
  ): Promise<ImportMappingResponseDto> {
    const session = await this.requireSession(organizationId, importId);
    this.assertMappingAllowed(session.status);
    const template = await this.requireTemplate(
      organizationId,
      session.templateId,
    );
    return this.toMappingResponse(session, template);
  }

  async putMapping(
    organizationId: string,
    importId: string,
    dto: PutImportMappingDto,
  ): Promise<ImportMappingResponseDto> {
    const session = await this.requireSession(organizationId, importId);
    this.assertMappingAllowed(session.status);

    if (session.mappingRevision !== dto.expectedRevision) {
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

    let canonical;
    try {
      canonical = canonicalizeMapping(
        dto.mappings,
        template.fields,
        session.columns,
      );
    } catch (error) {
      if (error instanceof MappingValidationError) {
        throw new UnprocessableEntityException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }

    const currentMappings = parseStoredMapping(session.mapping);
    if (areMappingsSemanticallyEqual(canonical.mappings, currentMappings)) {
      return this.toMappingResponse(session, template, canonical);
    }

    const updated = await this.imports.replaceMapping(
      organizationId,
      importId,
      dto.expectedRevision,
      canonical.mappings,
    );
    if (updated === null) {
      return await this.throwMappingWriteConflict(organizationId, importId);
    }

    return this.toMappingResponse(updated, template, canonical);
  }

  async uploadFile(
    organizationId: string,
    importId: string,
    req: Request,
  ): Promise<ImportSessionResponseDto> {
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

    try {
      assertCanUpload(session.status);
    } catch (error) {
      if (error instanceof ImportSessionTransitionError) {
        throw new ConflictException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }

    let file: Awaited<ReturnType<typeof readMultipartFile>>;
    try {
      file = await readMultipartFile(req, 'file');
    } catch (error) {
      discardReadable(req);
      if (error instanceof MultipartFileError) {
        throw new BadRequestException({
          code: 'VALIDATION.FAILED',
          message: error.message,
        });
      }
      throw error;
    }

    const abortUpload = (): void => {
      try {
        file.abort();
      } catch {
        // abort is idempotent and must not hide the original error
      }
      discardReadable(file.stream);
      discardReadable(req);
    };

    try {
      this.assertCsvSignals(file.filename, file.mimeType);

      const objectKey = buildStorageObjectKey(organizationId, importId);
      const limiter = new HashAndLimitTransform(this.env.IMPORT_MAX_FILE_BYTES);
      limiter.on('error', () => undefined);
      const originalFilename = normalizeOriginalFilename(file.filename);
      file.stream.on('error', (error: Error) => {
        if (!limiter.destroyed) {
          limiter.destroy(error);
        }
      });
      void file.completed.catch((error: unknown) => {
        if (!limiter.writableFinished && !limiter.destroyed) {
          limiter.destroy(
            error instanceof Error
              ? error
              : new Error('Multipart upload failed.'),
          );
        }
      });

      const uploaded = await persistUploadWithCleanup({
        storage: this.storage,
        key: objectKey,
        body: file.stream.pipe(limiter),
        contentType: 'text/csv',
        logger: this.logger,
        afterStored: async (opened) => {
          await file.completed;
          const parsed = await parseCsvStream(opened, {
            maxDataRows: this.env.IMPORT_MAX_DATA_ROWS,
            maxColumns: this.env.IMPORT_MAX_COLUMNS,
            maxFieldBytes: this.env.IMPORT_MAX_FIELD_BYTES,
          });

          try {
            return await this.imports.markUploaded(organizationId, importId, {
              originalFilename,
              byteSize: limiter.byteSize,
              contentSha256: limiter.digest(),
              encoding: parsed.encoding,
              delimiter: parsed.delimiter,
              dataRowCount: parsed.dataRowCount,
              storageObjectKey: objectKey,
              columns: parsed.columns.map((name, position) => ({
                name,
                position,
              })),
            });
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === 'IMPORT_STATUS_CONFLICT'
            ) {
              throw new ConflictException({
                code: 'IMPORT.FILE_ALREADY_UPLOADED',
                message: 'This import session already has an uploaded file.',
              });
            }
            throw error;
          }
        },
      });

      return this.toResponse(uploaded);
    } catch (error) {
      abortUpload();
      await this.handleUploadFailure(organizationId, importId, error);
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

  private assertMappingAllowed(
    status: ImportSessionRecord['status'],
  ): void {
    try {
      assertCanManageMapping(status);
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

  private async throwMappingWriteConflict(
    organizationId: string,
    importId: string,
  ): Promise<never> {
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
    this.assertMappingAllowed(current.status);
    throw new ConflictException({
      code: 'IMPORT.MAPPING_REVISION_CONFLICT',
      message:
        'Mapping revision is out of date. GET the mapping and retry with the current revision.',
    });
  }

  private toMappingResponse(
    session: ImportSessionRecord,
    template: ImportTemplateRecord,
    view = buildMappingView(
      parseStoredMapping(session.mapping),
      template.fields,
      session.columns,
    ),
  ): ImportMappingResponseDto {
    return {
      importId: session.id,
      revision: session.mappingRevision,
      mappings: view.mappings,
      isComplete: view.isComplete,
      missingRequiredFields: view.missingRequiredFields,
    };
  }

  private assertCsvSignals(filename: string, mimeType: string): void {
    const lowerName = filename.toLowerCase();
    const lowerMime = mimeType.toLowerCase();
    const extensionOk = lowerName.endsWith('.csv');
    const mimeOk =
      lowerMime.includes('csv') ||
      lowerMime === 'application/octet-stream' ||
      lowerMime === 'text/plain';

    if (!extensionOk && !mimeOk) {
      throw new UnprocessableEntityException({
        code: 'IMPORT.INVALID_CSV',
        message: 'Only CSV uploads are accepted.',
      });
    }
  }

  private async handleUploadFailure(
    organizationId: string,
    importId: string,
    error: unknown,
  ): Promise<void> {
    const root =
      error instanceof UploadCleanupError ? error.cause : error;
    if (root instanceof CsvParseError) {
      nextStatusAfterUploadFailure('created');
      await this.imports.markUploadFailed(organizationId, importId);
    }
  }

  private toHttpError(error: unknown): HttpException {
    if (error instanceof HttpException) {
      return error;
    }
    if (error instanceof UploadCleanupError) {
      return this.toHttpError(error.cause);
    }
    if (error instanceof FileTooLargeError) {
      return new HttpException(
        {
          code: 'IMPORT.FILE_TOO_LARGE',
          message: error.message,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    if (error instanceof MultipartFileError) {
      return new BadRequestException({
        code: 'VALIDATION.FAILED',
        message: error.message,
      });
    }
    if (error instanceof CsvParseError) {
      return new UnprocessableEntityException({
        code: 'IMPORT.INVALID_CSV',
        message: error.message,
      });
    }
    return new HttpException(
      {
        code: 'INTERNAL.UNEXPECTED',
        message: 'Something went wrong.',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private toResponse(session: ImportSessionRecord): ImportSessionResponseDto {
    return {
      id: session.id,
      templateId: session.templateId,
      status: session.status,
      originalFilename: session.originalFilename,
      byteSize: session.byteSize,
      contentSha256: session.contentSha256,
      encoding: session.encoding,
      delimiter: session.delimiter,
      dataRowCount: session.dataRowCount,
      columns: session.columns.map((column) => ({
        name: column.name,
        position: column.position,
      })),
      uploadedAt: session.uploadedAt?.toISOString() ?? null,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
  }
}
