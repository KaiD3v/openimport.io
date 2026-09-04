import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  InvalidUuidParamErrorDto,
  UnauthorizedErrorDto,
  ForbiddenErrorDto,
  ValidationFailedErrorDto,
} from '../../common/dto/api-error-response.dto.js';
import { AllowImportAccessToken } from '../../core/auth/allow-import-access-token.decorator.js';
import { ApiKeyOnlyAuth } from '../../core/auth/openapi-auth.decorators.js';
import { CurrentOrganization } from '../../core/auth/current-organization.decorator.js';
import type { AuthenticatedOrganization } from '../../core/auth/authenticated-organization.js';
import { resolveRequestId } from '../../common/http/request-id.js';
import { ConfirmImportDto } from './dto/confirm-import.dto.js';
import {
  ConfirmImportResponseDto,
  RejectedRowsResponseDto,
} from './dto/confirm-import-response.dto.js';
import { CreateImportSessionDto } from './dto/create-import-session.dto.js';
import { CreateImportPreviewDto } from './dto/create-import-preview.dto.js';
import { CreateImportAccessTokenDto } from './dto/create-import-access-token.dto.js';
import { ImportAccessTokenResponseDto } from './dto/import-access-token-response.dto.js';
import { ImportContextResponseDto } from './dto/import-context-response.dto.js';
import { ImportMappingResponseDto } from './dto/import-mapping-response.dto.js';
import { ImportPreviewResponseDto } from './dto/import-preview-response.dto.js';
import { ImportSessionResponseDto } from './dto/import-session-response.dto.js';
import { ListRejectedRowsQueryDto } from './dto/list-rejected-rows-query.dto.js';
import { ListValidRowsQueryDto } from './dto/list-valid-rows-query.dto.js';
import { ValidRowsResponseDto } from './dto/valid-rows-response.dto.js';
import { ReportImportResultsDto } from './dto/report-import-results.dto.js';
import {
  ImportResultsSummaryDto,
  ReportImportResultsResponseDto,
} from './dto/report-import-results-response.dto.js';
import {
  IdempotencyKeyReusedErrorDto,
  ImportConfirmationNotAllowedErrorDto,
  ImportFileAlreadyUploadedErrorDto,
  ImportFileChangedErrorDto,
  ImportFileTooLargeErrorDto,
  ImportInvalidCsvErrorDto,
  ImportMappingIncompleteErrorDto,
  ImportMappingInvalidErrorDto,
  ImportMappingNotAllowedErrorDto,
  ImportMappingRevisionConflictErrorDto,
  ImportNotFoundErrorDto,
  ImportPreviewNotAllowedErrorDto,
  ImportPreviewUnavailableErrorDto,
  ImportProcessingUnavailableErrorDto,
  ImportResultsConflictErrorDto,
  ImportResultsInvalidErrorDto,
  ImportResultsNotAllowedErrorDto,
  ImportSnapshotNotReadyErrorDto,
  ImportUploadNotAllowedErrorDto,
  TemplateNotFoundErrorDto,
} from './dto/import-error-response.dto.js';
import { PutImportMappingDto } from './dto/put-import-mapping.dto.js';
import { ConfirmService } from './confirm/confirm.service.js';
import { ImportService } from './import.service.js';
import { PreviewService } from './preview/preview.service.js';
import { RejectedRowsService } from './processing/rejected-rows.service.js';
import { ValidRowsService } from './processing/valid-rows.service.js';
import { ReportResultsService } from './results/report-results.service.js';

const importIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException({
      code: 'VALIDATION.FAILED',
      message: 'Request validation failed.',
      details: [
        {
          field: 'importId',
          constraints: { isUuid: 'importId must be a UUID' },
        },
      ],
    }),
});

@ApiTags('imports')
@ApiExtraModels(
  ImportFileAlreadyUploadedErrorDto,
  ImportUploadNotAllowedErrorDto,
  ImportMappingNotAllowedErrorDto,
  ImportMappingRevisionConflictErrorDto,
  ImportPreviewNotAllowedErrorDto,
  ImportMappingIncompleteErrorDto,
  ImportFileChangedErrorDto,
  ImportPreviewUnavailableErrorDto,
  ImportConfirmationNotAllowedErrorDto,
  ImportProcessingUnavailableErrorDto,
  ImportResultsConflictErrorDto,
  ImportResultsInvalidErrorDto,
  ImportResultsNotAllowedErrorDto,
  IdempotencyKeyReusedErrorDto,
  ImportSnapshotNotReadyErrorDto,
)
@Controller('imports')
export class ImportController {
  constructor(
    private readonly imports: ImportService,
    private readonly previews: PreviewService,
    private readonly confirms: ConfirmService,
    private readonly rejectedRows: RejectedRowsService,
    private readonly validRows: ValidRowsService,
    private readonly reportResults: ReportResultsService,
  ) {}

  @Post()
  @ApiKeyOnlyAuth()
  @ApiOperation({ summary: 'Create an import session for a template' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Client-generated key (8-128 chars: letters, digits, . _ -). Scoped per organization.',
  })
  @ApiResponse({ status: 201, type: ImportSessionResponseDto })
  @ApiResponse({ status: 400, type: ValidationFailedErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: TemplateNotFoundErrorDto })
  @ApiResponse({ status: 409, type: IdempotencyKeyReusedErrorDto })
  create(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Body() dto: CreateImportSessionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<ImportSessionResponseDto> {
    return this.imports.createSession(
      organization.organizationId,
      dto,
      idempotencyKey,
    );
  }

  @Get(':importId')
  @AllowImportAccessToken()
  @ApiOperation({ summary: 'Get an import session belonging to the organization' })
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ImportSessionResponseDto })
  @ApiResponse({ status: 400, type: InvalidUuidParamErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: ImportNotFoundErrorDto })
  findById(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('importId', importIdPipe) importId: string,
  ): Promise<ImportSessionResponseDto> {
    return this.imports.findById(organization.organizationId, importId);
  }

  @Post(':importId/access-tokens')
  @ApiKeyOnlyAuth()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Issue a short-lived import access token bound to this session. API key only; the secret is returned once.',
  })
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiResponse({ status: 201, type: ImportAccessTokenResponseDto })
  @ApiResponse({ status: 400, type: ValidationFailedErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: ImportNotFoundErrorDto })
  createAccessToken(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('importId', importIdPipe) importId: string,
    @Body() dto: CreateImportAccessTokenDto,
  ): Promise<ImportAccessTokenResponseDto> {
    return this.imports.createAccessToken(organization, importId, dto);
  }

  @Get(':importId/context')
  @AllowImportAccessToken()
  @ApiOperation({
    summary:
      'Load session, template, and mapping together so a frontend can render the import flow.',
  })
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ImportContextResponseDto })
  @ApiResponse({ status: 400, type: InvalidUuidParamErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: ImportNotFoundErrorDto })
  getContext(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('importId', importIdPipe) importId: string,
  ): Promise<ImportContextResponseDto> {
    return this.imports.getContext(organization.organizationId, importId);
  }

  @Get(':importId/mapping')
  @AllowImportAccessToken()
  @ApiOperation({
    summary: 'Get the column-to-field mapping draft for an uploaded import',
  })
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ImportMappingResponseDto })
  @ApiResponse({ status: 400, type: InvalidUuidParamErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: ImportNotFoundErrorDto })
  @ApiResponse({ status: 409, type: ImportMappingNotAllowedErrorDto })
  getMapping(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('importId', importIdPipe) importId: string,
  ): Promise<ImportMappingResponseDto> {
    return this.imports.getMapping(organization.organizationId, importId);
  }

  @Put(':importId/mapping')
  @AllowImportAccessToken()
  @ApiOperation({
    summary:
      'Replace the column-to-field mapping draft (optimistic concurrency via expectedRevision)',
  })
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ImportMappingResponseDto })
  @ApiResponse({ status: 400, type: ValidationFailedErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: ImportNotFoundErrorDto })
  @ApiResponse({
    status: 409,
    description:
      'IMPORT.MAPPING_NOT_ALLOWED when the session is not uploaded, or IMPORT.MAPPING_REVISION_CONFLICT when expectedRevision is stale.',
    content: {
      'application/json': {
        schema: {
          oneOf: [
            { $ref: getSchemaPath(ImportMappingNotAllowedErrorDto) },
            { $ref: getSchemaPath(ImportMappingRevisionConflictErrorDto) },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 422, type: ImportMappingInvalidErrorDto })
  putMapping(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('importId', importIdPipe) importId: string,
    @Body() dto: PutImportMappingDto,
  ): Promise<ImportMappingResponseDto> {
    return this.imports.putMapping(
      organization.organizationId,
      importId,
      dto,
    );
  }

  @Post(':importId/preview')
  @AllowImportAccessToken()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Dry-run normalize and validate mapped CSV rows. Does not confirm the import or persist records.',
  })
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ImportPreviewResponseDto })
  @ApiResponse({ status: 400, type: ValidationFailedErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: ImportNotFoundErrorDto })
  @ApiResponse({
    status: 409,
    description:
      'IMPORT.PREVIEW_NOT_ALLOWED, IMPORT.MAPPING_INCOMPLETE, IMPORT.MAPPING_REVISION_CONFLICT, or IMPORT.FILE_CHANGED.',
    content: {
      'application/json': {
        schema: {
          oneOf: [
            { $ref: getSchemaPath(ImportPreviewNotAllowedErrorDto) },
            { $ref: getSchemaPath(ImportMappingIncompleteErrorDto) },
            { $ref: getSchemaPath(ImportMappingRevisionConflictErrorDto) },
            { $ref: getSchemaPath(ImportFileChangedErrorDto) },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 413, type: ImportFileTooLargeErrorDto })
  @ApiResponse({ status: 422, type: ImportInvalidCsvErrorDto })
  @ApiResponse({ status: 503, type: ImportPreviewUnavailableErrorDto })
  preview(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('importId', importIdPipe) importId: string,
    @Body() dto: CreateImportPreviewDto,
  ): Promise<ImportPreviewResponseDto> {
    return this.previews.preview(organization.organizationId, importId, dto);
  }

  @Post(':importId/confirm')
  @AllowImportAccessToken()
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Confirm an uploaded import (idempotent). Freezes mapping and file, enqueues async processing, returns quickly.',
  })
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiResponse({ status: 202, type: ConfirmImportResponseDto })
  @ApiResponse({ status: 400, type: ValidationFailedErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: ImportNotFoundErrorDto })
  @ApiResponse({
    status: 409,
    description:
      'IMPORT.CONFIRMATION_NOT_ALLOWED, IMPORT.MAPPING_INCOMPLETE, IMPORT.MAPPING_REVISION_CONFLICT, or IMPORT.FILE_CHANGED.',
    content: {
      'application/json': {
        schema: {
          oneOf: [
            { $ref: getSchemaPath(ImportConfirmationNotAllowedErrorDto) },
            { $ref: getSchemaPath(ImportMappingIncompleteErrorDto) },
            { $ref: getSchemaPath(ImportMappingRevisionConflictErrorDto) },
            { $ref: getSchemaPath(ImportFileChangedErrorDto) },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 503, type: ImportProcessingUnavailableErrorDto })
  confirm(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('importId', importIdPipe) importId: string,
    @Body() dto: ConfirmImportDto,
    @Req() req: Request,
  ): Promise<ConfirmImportResponseDto> {
    return this.confirms.confirm(
      organization.organizationId,
      importId,
      dto,
      String(resolveRequestId(req)),
    );
  }

  @Get(':importId/rejected-rows')
  @AllowImportAccessToken()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'List invalid records from the ready snapshot (cursor pagination). Does not return raw CSV cells or normalized payloads.',
  })
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiResponse({ status: 200, type: RejectedRowsResponseDto })
  @ApiResponse({ status: 400, type: ValidationFailedErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: ImportNotFoundErrorDto })
  @ApiResponse({ status: 409, type: ImportSnapshotNotReadyErrorDto })
  listRejectedRows(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('importId', importIdPipe) importId: string,
    @Query() query: ListRejectedRowsQueryDto,
  ): Promise<RejectedRowsResponseDto> {
    return this.rejectedRows.list(organization.organizationId, importId, query);
  }

  @Get(':importId/valid-rows')
  @ApiKeyOnlyAuth()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'List normalized valid records from the ready snapshot (cursor pagination). API key only — not available to import access tokens.',
  })
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiResponse({
    status: 200,
    type: ValidRowsResponseDto,
    description: 'Page of valid rows. `nextCursor` is set when another page exists.',
  })
  @ApiResponse({ status: 400, type: ValidationFailedErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: ImportNotFoundErrorDto })
  @ApiResponse({ status: 409, type: ImportSnapshotNotReadyErrorDto })
  listValidRows(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('importId', importIdPipe) importId: string,
    @Query() query: ListValidRowsQueryDto,
  ): Promise<ValidRowsResponseDto> {
    return this.validRows.list(organization.organizationId, importId, query);
  }

  @Get(':importId/results/summary')
  @ApiKeyOnlyAuth()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Summarize client-reported accepted/rejected results for the ready snapshot. API key only. isComplete means every valid row has a client result; session status stays ready.',
  })
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ImportResultsSummaryDto })
  @ApiResponse({ status: 400, type: ValidationFailedErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: ImportNotFoundErrorDto })
  @ApiResponse({ status: 409, type: ImportResultsNotAllowedErrorDto })
  summarizeResults(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('importId', importIdPipe) importId: string,
  ): Promise<ImportResultsSummaryDto> {
    return this.reportResults.summarize(
      organization.organizationId,
      importId,
    );
  }

  @Post(':importId/results')
  @ApiKeyOnlyAuth()
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Report an atomic, idempotent batch of client accept/reject outcomes for valid rows. API key only.',
  })
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: '8–128 characters [A-Za-z0-9._-]. Stored as SHA-256 only.',
  })
  @ApiBody({ type: ReportImportResultsDto })
  @ApiResponse({ status: 200, type: ReportImportResultsResponseDto })
  @ApiResponse({ status: 400, type: ValidationFailedErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: ImportNotFoundErrorDto })
  @ApiResponse({
    status: 409,
    description: 'Not allowed, idempotency reuse, or result conflict',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ImportResultsNotAllowedErrorDto) },
        { $ref: getSchemaPath(IdempotencyKeyReusedErrorDto) },
        { $ref: getSchemaPath(ImportResultsConflictErrorDto) },
      ],
    },
  })
  @ApiResponse({ status: 422, type: ImportResultsInvalidErrorDto })
  reportResultsBatch(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('importId', importIdPipe) importId: string,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Body() body: ReportImportResultsDto,
  ): Promise<ReportImportResultsResponseDto> {
    return this.reportResults.report(
      organization.organizationId,
      importId,
      body,
      idempotencyKey,
    );
  }

  @Post(':importId/file')
  @AllowImportAccessToken()
  @ApiOperation({ summary: 'Upload a CSV file for an import session' })
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV file',
        },
      },
    },
  })
  @ApiResponse({ status: 201, type: ImportSessionResponseDto })
  @ApiResponse({ status: 400, type: ValidationFailedErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: ImportNotFoundErrorDto })
  @ApiResponse({
    status: 409,
    description:
      'IMPORT.FILE_ALREADY_UPLOADED when a file was already accepted, or IMPORT.UPLOAD_NOT_ALLOWED when a previous upload failed.',
    content: {
      'application/json': {
        schema: {
          oneOf: [
            { $ref: getSchemaPath(ImportFileAlreadyUploadedErrorDto) },
            { $ref: getSchemaPath(ImportUploadNotAllowedErrorDto) },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 413, type: ImportFileTooLargeErrorDto })
  @ApiResponse({ status: 422, type: ImportInvalidCsvErrorDto })
  uploadFile(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('importId', importIdPipe) importId: string,
    @Req() req: Request,
  ): Promise<ImportSessionResponseDto> {
    return this.imports.uploadFile(
      organization.organizationId,
      importId,
      req,
    );
  }
}
