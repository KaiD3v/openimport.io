import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import { buildImportReadyPayload } from './delivery/import-ready-payload.js';
import { webhookDeliveryJobId } from './delivery/webhook-delivery.queue.js';
import { IMPORT_READY_EVENT_TYPE } from './webhook.constants.js';
import type {
  InsertImportReadyInput,
  WebhookDeliveryRecord,
  WebhookReadyOutbox,
} from './webhook.types.js';
import type { ImportReadyPayload } from './delivery/import-ready-payload.js';

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function asPayload(value: Prisma.JsonValue): ImportReadyPayload {
  return value as unknown as ImportReadyPayload;
}

@Injectable()
export class WebhookDeliveryRepository implements WebhookReadyOutbox {
  constructor(private readonly prisma: PrismaService) {}

  async insertImportReadyInTransaction(
    tx: Prisma.TransactionClient,
    input: InsertImportReadyInput,
  ): Promise<string | null> {
    const endpoint = await tx.webhookEndpoint.findFirst({
      where: {
        organizationId: input.organizationId,
        eventType: IMPORT_READY_EVENT_TYPE,
        isActive: true,
      },
      select: { id: true, url: true, secretCiphertext: true },
    });
    if (!endpoint) {
      return null;
    }

    const id = randomUUID();
    const createdAt = new Date();
    const payload = buildImportReadyPayload({
      id,
      createdAt,
      organizationId: input.organizationId,
      importId: input.importSessionId,
      executionId: input.executionId,
      counts: {
        totalRows: input.counts.totalRows ?? input.counts.processedRows,
        validRows: input.counts.validRows,
        invalidRows: input.counts.invalidRows,
        processedRows: input.counts.processedRows,
      },
    });

    try {
      const created = await tx.webhookDelivery.create({
        data: {
          id,
          organizationId: input.organizationId,
          endpointId: endpoint.id,
          executionId: input.executionId,
          importSessionId: input.importSessionId,
          eventType: IMPORT_READY_EVENT_TYPE,
          status: 'pending',
          destinationUrl: endpoint.url,
          secretCiphertext: endpoint.secretCiphertext,
          payload,
          jobId: webhookDeliveryJobId(id),
          createdAt,
        },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      const existing = await tx.webhookDelivery.findFirst({
        where: {
          organizationId: input.organizationId,
          executionId: input.executionId,
          eventType: IMPORT_READY_EVENT_TYPE,
        },
        select: { id: true },
      });
      return existing?.id ?? null;
    }
  }

  findByIdForOrganization(
    organizationId: string,
    deliveryId: string,
  ): Promise<WebhookDeliveryRecord | null> {
    return this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, organizationId },
    }).then((row) =>
      row ? { ...row, payload: asPayload(row.payload) } : null,
    );
  }

  listPendingDeliveries(params: {
    limit: number;
    after?: { createdAt: Date; id: string } | null;
  }): Promise<WebhookDeliveryRecord[]> {
    const after = params.after ?? null;
    return this.prisma.webhookDelivery
      .findMany({
        where: {
          status: 'pending',
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
      })
      .then((rows) =>
        rows.map((row) => ({ ...row, payload: asPayload(row.payload) })),
      );
  }

  async markDelivered(
    organizationId: string,
    deliveryId: string,
  ): Promise<boolean> {
    const updated = await this.prisma.webhookDelivery.updateMany({
      where: { id: deliveryId, organizationId, status: 'pending' },
      data: {
        status: 'delivered',
        deliveredAt: new Date(),
        lastError: null,
      },
    });
    return updated.count === 1;
  }

  async markFailed(
    organizationId: string,
    deliveryId: string,
    lastError: string,
  ): Promise<boolean> {
    const updated = await this.prisma.webhookDelivery.updateMany({
      where: { id: deliveryId, organizationId, status: 'pending' },
      data: {
        status: 'failed',
        failedAt: new Date(),
        lastError: lastError.slice(0, 80),
      },
    });
    return updated.count === 1;
  }

  async incrementAttempt(
    organizationId: string,
    deliveryId: string,
  ): Promise<void> {
    await this.prisma.webhookDelivery.updateMany({
      where: { id: deliveryId, organizationId, status: 'pending' },
      data: { attemptCount: { increment: 1 } },
    });
  }
}
