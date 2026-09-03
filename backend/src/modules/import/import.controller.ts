import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  InvalidUuidParamErrorDto,
  UnauthorizedErrorDto,
  ValidationFailedErrorDto,
} from '../../common/dto/api-error-response.dto.js';
import { CurrentOrganization } from '../../core/auth/current-organization.decorator.js';
import type { AuthenticatedOrganization } from '../../core/auth/authenticated-organization.js';
import { CreateImportSessionDto } from './dto/create-import-session.dto.js';
import { ImportSessionResponseDto } from './dto/import-session-response.dto.js';
import {
  IdempotencyKeyReusedErrorDto,
  ImportFileAlreadyUploadedErrorDto,
  ImportFileTooLargeErrorDto,
  ImportInvalidCsvErrorDto,
  ImportNotFoundErrorDto,
  ImportUploadNotAllowedErrorDto,
  TemplateNotFoundErrorDto,
} from './dto/import-error-response.dto.js';
import { ImportService } from './import.service.js';

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
@ApiBearerAuth('api-key')
@ApiExtraModels(
  ImportFileAlreadyUploadedErrorDto,
  ImportUploadNotAllowedErrorDto,
)
@Controller('imports')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @Post()
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
  @ApiOperation({ summary: 'Get an import session belonging to the organization' })
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ImportSessionResponseDto })
  @ApiResponse({ status: 400, type: InvalidUuidParamErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 404, type: ImportNotFoundErrorDto })
  findById(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('importId', importIdPipe) importId: string,
  ): Promise<ImportSessionResponseDto> {
    return this.imports.findById(organization.organizationId, importId);
  }

  @Post(':importId/file')
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
