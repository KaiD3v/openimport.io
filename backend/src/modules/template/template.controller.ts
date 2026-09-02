import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  InvalidUuidParamErrorDto,
  TemplateNameConflictErrorDto,
  TemplateNotFoundErrorDto,
  UnauthorizedErrorDto,
  ValidationFailedErrorDto,
} from '../../common/dto/api-error-response.dto.js';
import { CurrentOrganization } from '../../core/auth/current-organization.decorator.js';
import type { AuthenticatedOrganization } from '../../core/auth/authenticated-organization.js';
import { CreateTemplateDto } from './dto/create-template.dto.js';
import { TemplateResponseDto } from './dto/template-response.dto.js';
import { TemplateService } from './template.service.js';

const templateIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException({
      code: 'VALIDATION.FAILED',
      message: 'Request validation failed.',
      details: [
        {
          field: 'templateId',
          constraints: { isUuid: 'templateId must be a UUID' },
        },
      ],
    }),
});

@ApiTags('templates')
@ApiBearerAuth('api-key')
@Controller('templates')
export class TemplateController {
  constructor(private readonly templates: TemplateService) {}

  @Post()
  @ApiOperation({ summary: 'Create an import template for the authenticated organization' })
  @ApiResponse({ status: 201, type: TemplateResponseDto })
  @ApiResponse({ status: 400, type: ValidationFailedErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 409, type: TemplateNameConflictErrorDto })
  create(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Body() dto: CreateTemplateDto,
  ): Promise<TemplateResponseDto> {
    return this.templates.create(organization.organizationId, dto);
  }

  @Get(':templateId')
  @ApiOperation({ summary: 'Get an import template belonging to the authenticated organization' })
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiResponse({ status: 200, type: TemplateResponseDto })
  @ApiResponse({
    status: 400,
    type: InvalidUuidParamErrorDto,
    description: 'templateId is not a UUID.',
  })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 404, type: TemplateNotFoundErrorDto })
  findById(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Param('templateId', templateIdPipe) templateId: string,
  ): Promise<TemplateResponseDto> {
    return this.templates.findById(organization.organizationId, templateId);
  }
}
