import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../core/database/prisma.service.js';
import { IMPORT_READY_EVENT_TYPE } from './webhook.constants.js';
import { WebhookDeliveryRepository } from './webhook-delivery.repository.js';

const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const execId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const endpointId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('WebhookDeliveryRepository.insertImportReadyInTransaction', () => {
  let repo: WebhookDeliveryRepository;

  beforeEach(() => {
    repo = new WebhookDeliveryRepository({} as PrismaService);
  });

  it('returns null without inserting when the organization has no active endpoint', async () => {
    const tx = {
      webhookEndpoint: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      webhookDelivery: {
        create: vi.fn(),
      },
    };

    const id = await repo.insertImportReadyInTransaction(tx as never, {
      organizationId: orgId,
      importSessionId: sessionId,
      executionId: execId,
      counts: {
        processedRows: 2,
        validRows: 1,
        invalidRows: 1,
        totalRows: 2,
      },
    });

    expect(id).toBeNull();
    expect(tx.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it('inserts a pending import.ready delivery with a stable payload id', async () => {
    const tx = {
      webhookEndpoint: {
        findFirst: vi.fn().mockResolvedValue({
          id: endpointId,
          url: 'https://hooks.example.com/ready',
          secretCiphertext: 'v2.endpoint-a-ciphertext',
        }),
      },
      webhookDelivery: {
        create: vi.fn().mockImplementation(async ({ data }) => ({ id: data.id })),
      },
    };

    const id = await repo.insertImportReadyInTransaction(tx as never, {
      organizationId: orgId,
      importSessionId: sessionId,
      executionId: execId,
      counts: {
        processedRows: 2,
        validRows: 1,
        invalidRows: 1,
        totalRows: 2,
      },
    });

    expect(id).toEqual(expect.any(String));
    expect(tx.webhookEndpoint.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: orgId,
          eventType: IMPORT_READY_EVENT_TYPE,
          isActive: true,
        }),
        select: { id: true, url: true, secretCiphertext: true },
      }),
    );
    expect(tx.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id,
          organizationId: orgId,
          endpointId,
          executionId: execId,
          importSessionId: sessionId,
          eventType: IMPORT_READY_EVENT_TYPE,
          status: 'pending',
          destinationUrl: 'https://hooks.example.com/ready',
          secretCiphertext: 'v2.endpoint-a-ciphertext',
          jobId: `webhook-delivery.${id}`,
          payload: expect.objectContaining({
            id,
            type: IMPORT_READY_EVENT_TYPE,
            data: expect.objectContaining({
              organizationId: orgId,
              importId: sessionId,
              executionId: execId,
              status: 'ready',
              counts: {
                totalRows: 2,
                validRows: 1,
                invalidRows: 1,
                processedRows: 2,
              },
            }),
          }),
        }),
      }),
    );
  });

  it('returns the existing delivery id when the unique outbox constraint fires', async () => {
    const tx = {
      webhookEndpoint: {
        findFirst: vi.fn().mockResolvedValue({
          id: endpointId,
          url: 'https://hooks.example.com/ready',
          secretCiphertext: 'v2.endpoint-a-ciphertext',
        }),
      },
      webhookDelivery: {
        create: vi.fn().mockRejectedValue({ code: 'P2002' }),
        findFirst: vi.fn().mockResolvedValue({ id: 'existing-delivery' }),
      },
    };

    const id = await repo.insertImportReadyInTransaction(tx as never, {
      organizationId: orgId,
      importSessionId: sessionId,
      executionId: execId,
      counts: {
        processedRows: 1,
        validRows: 1,
        invalidRows: 0,
        totalRows: 1,
      },
    });

    expect(id).toBe('existing-delivery');
    expect(tx.webhookDelivery.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: orgId,
          executionId: execId,
          eventType: IMPORT_READY_EVENT_TYPE,
        }),
      }),
    );
  });
});
