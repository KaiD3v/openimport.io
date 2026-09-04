import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ENV } from '../../core/config/env.token.js';
import type { Env } from '../../core/config/env.js';
import {
  encryptWebhookSecret,
  generateWebhookSecret,
  webhookSecretAad,
  webhookSecretPrefix,
} from './crypto/webhook-secret.crypto.js';
import type { UpsertWebhookEndpointDto } from './dto/upsert-webhook-endpoint.dto.js';
import type { WebhookEndpointResponseDto } from './dto/webhook-endpoint-response.dto.js';
import { assertSafeWebhookUrl } from './ssrf/assert-safe-webhook-url.js';
import { IMPORT_READY_EVENT_TYPE } from './webhook.constants.js';
import { WebhookEndpointRepository } from './webhook-endpoint.repository.js';
import type { WebhookEndpointRecord } from './webhook.types.js';

function isOrganizationEventTypeUniqueConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  if (error.code !== 'P2002') {
    return false;
  }
  const target =
    'meta' in error &&
    typeof error.meta === 'object' &&
    error.meta !== null &&
    'target' in error.meta
      ? error.meta.target
      : undefined;

  const fields = Array.isArray(target)
    ? target.map((item) => String(item))
    : typeof target === 'string'
      ? [target]
      : [];

  if (fields.length === 0) {
    return false;
  }

  const joined = fields.join(',');
  if (
    fields.includes('uq_webhook_endpoints_organization_id_event_type') ||
    fields.includes('organizationId_eventType') ||
    joined.includes('uq_webhook_endpoints_organization_id_event_type')
  ) {
    return true;
  }

  const hasOrganization = fields.some(
    (field) => field === 'organizationId' || field === 'organization_id',
  );
  const hasEventType = fields.some(
    (field) => field === 'eventType' || field === 'event_type',
  );
  return hasOrganization && hasEventType;
}

@Injectable()
export class WebhookEndpointService {
  constructor(
    private readonly endpoints: WebhookEndpointRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async upsert(
    organizationId: string,
    dto: UpsertWebhookEndpointDto,
  ): Promise<WebhookEndpointResponseDto> {
    try {
      await assertSafeWebhookUrl(dto.url, {
        allowPrivateTargets: this.env.WEBHOOK_SSRF_ALLOW_PRIVATE_TARGETS,
      });
    } catch {
      throw new UnprocessableEntityException({
        code: 'WEBHOOK.URL_UNSAFE',
        message: 'Webhook URL is not allowed.',
      });
    }

    const existing = await this.endpoints.findByOrganizationAndEvent(
      organizationId,
      IMPORT_READY_EVENT_TYPE,
    );
    const intendedId = existing?.id ?? randomUUID();
    const secret = generateWebhookSecret();
    const record = await this.persistRotatedSecret({
      existing,
      intendedId,
      organizationId,
      url: dto.url,
      secret,
    });

    return this.toResponse(record, secret);
  }

  async get(organizationId: string): Promise<WebhookEndpointResponseDto> {
    const record = await this.endpoints.findByOrganizationAndEvent(
      organizationId,
      IMPORT_READY_EVENT_TYPE,
    );
    if (!record) {
      throw new NotFoundException({
        code: 'WEBHOOK.ENDPOINT_NOT_FOUND',
        message: 'Webhook endpoint not found.',
      });
    }
    return this.toResponse(record);
  }

  async deactivate(organizationId: string): Promise<WebhookEndpointResponseDto> {
    const record = await this.endpoints.deactivateForOrganization(
      organizationId,
      IMPORT_READY_EVENT_TYPE,
    );
    if (!record) {
      throw new NotFoundException({
        code: 'WEBHOOK.ENDPOINT_NOT_FOUND',
        message: 'Webhook endpoint not found.',
      });
    }
    return this.toResponse(record);
  }

  /**
   * Create with a matching AAD, or rotate the already-committed winner by its
   * real id. Never writes ciphertext encrypted under a different endpoint id.
   */
  private async persistRotatedSecret(input: {
    existing: WebhookEndpointRecord | null;
    intendedId: string;
    organizationId: string;
    url: string;
    secret: string;
  }): Promise<WebhookEndpointRecord> {
    const eventType = IMPORT_READY_EVENT_TYPE;
    const secretPrefix = webhookSecretPrefix(input.secret);
    const encryptFor = (endpointId: string) =>
      encryptWebhookSecret(
        input.secret,
        this.env.WEBHOOK_SECRET_ENCRYPTION_KEY,
        webhookSecretAad(input.organizationId, endpointId),
      );

    let record = input.existing;

    if (!record) {
      try {
        return await this.endpoints.createForOrganization({
          id: input.intendedId,
          organizationId: input.organizationId,
          url: input.url,
          secretCiphertext: encryptFor(input.intendedId),
          secretPrefix,
          eventType,
        });
      } catch (error) {
        if (!isOrganizationEventTypeUniqueConflict(error)) {
          throw error;
        }
        record = await this.endpoints.findByOrganizationAndEvent(
          input.organizationId,
          eventType,
        );
        if (!record) {
          throw error;
        }
      }
    }

    return this.endpoints.rotateForOrganization({
      id: record.id,
      organizationId: input.organizationId,
      url: input.url,
      secretCiphertext: encryptFor(record.id),
      secretPrefix,
      eventType,
    });
  }

  private toResponse(
    record: WebhookEndpointRecord,
    secret?: string,
  ): WebhookEndpointResponseDto {
    return {
      id: record.id,
      url: record.url,
      eventType: IMPORT_READY_EVENT_TYPE,
      isActive: record.isActive,
      secretPrefix: record.secretPrefix,
      ...(secret ? { secret } : {}),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
