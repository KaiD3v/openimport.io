import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Put,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ForbiddenErrorDto,
  UnauthorizedErrorDto,
  ValidationFailedErrorDto,
} from '../../common/dto/api-error-response.dto.js';
import { ApiKeyOnlyAuth } from '../../core/auth/openapi-auth.decorators.js';
import { CurrentOrganization } from '../../core/auth/current-organization.decorator.js';
import type { AuthenticatedOrganization } from '../../core/auth/authenticated-organization.js';
import { UpsertWebhookEndpointDto } from './dto/upsert-webhook-endpoint.dto.js';
import { WebhookEndpointResponseDto } from './dto/webhook-endpoint-response.dto.js';
import {
  WebhookEndpointNotFoundErrorDto,
  WebhookUrlUnsafeErrorDto,
} from './dto/webhook-error-response.dto.js';
import { WebhookEndpointService } from './webhook-endpoint.service.js';

@ApiTags('webhooks')
@ApiKeyOnlyAuth()
@Controller('webhook-endpoints')
export class WebhookEndpointController {
  constructor(private readonly endpoints: WebhookEndpointService) {}

  @Put()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Create or rotate the organization import.ready webhook endpoint (secret shown once)',
  })
  @ApiResponse({ status: 200, type: WebhookEndpointResponseDto })
  @ApiResponse({ status: 400, type: ValidationFailedErrorDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 422, type: WebhookUrlUnsafeErrorDto })
  upsert(
    @CurrentOrganization() organization: AuthenticatedOrganization,
    @Body() dto: UpsertWebhookEndpointDto,
  ): Promise<WebhookEndpointResponseDto> {
    return this.endpoints.upsert(organization.organizationId, dto);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Get the organization import.ready webhook endpoint (no secret)',
  })
  @ApiResponse({ status: 200, type: WebhookEndpointResponseDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: WebhookEndpointNotFoundErrorDto })
  get(
    @CurrentOrganization() organization: AuthenticatedOrganization,
  ): Promise<WebhookEndpointResponseDto> {
    return this.endpoints.get(organization.organizationId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Deactivate the organization import.ready webhook endpoint',
  })
  @ApiResponse({ status: 200, type: WebhookEndpointResponseDto })
  @ApiResponse({ status: 401, type: UnauthorizedErrorDto })
  @ApiResponse({ status: 403, type: ForbiddenErrorDto })
  @ApiResponse({ status: 404, type: WebhookEndpointNotFoundErrorDto })
  deactivate(
    @CurrentOrganization() organization: AuthenticatedOrganization,
  ): Promise<WebhookEndpointResponseDto> {
    return this.endpoints.deactivate(organization.organizationId);
  }
}
