import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { IMPORT_READY_EVENT_TYPE } from './webhook.constants.js';
import type { WebhookEndpointRecord } from './webhook.types.js';

export type WebhookEndpointWriteInput = {
  id: string;
  organizationId: string;
  url: string;
  secretCiphertext: string;
  secretPrefix: string;
  eventType?: string;
};

@Injectable()
export class WebhookEndpointRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByOrganizationAndEvent(
    organizationId: string,
    eventType: string = IMPORT_READY_EVENT_TYPE,
  ): Promise<WebhookEndpointRecord | null> {
    return this.prisma.webhookEndpoint.findFirst({
      where: { organizationId, eventType },
    });
  }

  createForOrganization(
    input: WebhookEndpointWriteInput,
  ): Promise<WebhookEndpointRecord> {
    const eventType = input.eventType ?? IMPORT_READY_EVENT_TYPE;
    return this.prisma.webhookEndpoint.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        url: input.url,
        secretCiphertext: input.secretCiphertext,
        secretPrefix: input.secretPrefix,
        eventType,
        isActive: true,
      },
    });
  }

  rotateForOrganization(
    input: WebhookEndpointWriteInput,
  ): Promise<WebhookEndpointRecord> {
    const eventType = input.eventType ?? IMPORT_READY_EVENT_TYPE;
    return this.prisma.webhookEndpoint.update({
      where: {
        id: input.id,
        organizationId: input.organizationId,
        eventType,
      },
      data: {
        url: input.url,
        secretCiphertext: input.secretCiphertext,
        secretPrefix: input.secretPrefix,
        isActive: true,
      },
    });
  }

  async deactivateForOrganization(
    organizationId: string,
    eventType: string = IMPORT_READY_EVENT_TYPE,
  ): Promise<WebhookEndpointRecord | null> {
    const existing = await this.findByOrganizationAndEvent(
      organizationId,
      eventType,
    );
    if (!existing) {
      return null;
    }
    if (!existing.isActive) {
      return existing;
    }
    return this.prisma.webhookEndpoint.update({
      where: { id: existing.id },
      data: { isActive: false },
    });
  }
}
