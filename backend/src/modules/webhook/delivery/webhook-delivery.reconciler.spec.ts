import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../core/config/env.js';
import type { WebhookDeliveryRecord } from '../webhook.types.js';
import type { WebhookDeliveryRepository } from '../webhook-delivery.repository.js';
import type { WebhookDeliveryJobPublisher } from './webhook-delivery.publisher.js';
import { WebhookDeliveryEnqueueError } from './webhook-delivery.publisher.js';
import { WebhookDeliveryReconciler } from './webhook-delivery.reconciler.js';

describe('WebhookDeliveryReconciler', () => {
  let deliveries: { listPendingDeliveries: ReturnType<typeof vi.fn> };
  let jobs: { ensureProcessable: ReturnType<typeof vi.fn> };
  let reconciler: WebhookDeliveryReconciler;

  beforeEach(() => {
    deliveries = {
      listPendingDeliveries: vi.fn().mockResolvedValue([]),
    };
    jobs = {
      ensureProcessable: vi.fn().mockResolvedValue({
        outcome: 'already_processable',
        state: 'waiting',
      }),
    };
    reconciler = new WebhookDeliveryReconciler(
      deliveries as unknown as WebhookDeliveryRepository,
      jobs as unknown as WebhookDeliveryJobPublisher,
      {
        WEBHOOK_JOB_RECONCILE_BATCH_SIZE: 2,
        WEBHOOK_JOB_RECONCILE_INTERVAL_MS: 60_000,
        NODE_ENV: 'test',
      } as Env,
    );
    reconciler.resetCursor();
  });

  it('republishes pending deliveries without a processable job', async () => {
    deliveries.listPendingDeliveries.mockResolvedValue([
      {
        id: 'del-1',
        status: 'pending',
        jobId: 'webhook-delivery.del-1',
        organizationId: 'org',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ] as WebhookDeliveryRecord[]);
    jobs.ensureProcessable.mockResolvedValue({ outcome: 'missing_published' });

    await reconciler.reconcileOnce();

    expect(jobs.ensureProcessable).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'del-1',
        organizationId: 'org',
        jobId: 'webhook-delivery.del-1',
        deliveryStatus: 'pending',
      }),
    );
  });

  it('skips non-pending rows even if listed incorrectly', async () => {
    deliveries.listPendingDeliveries.mockResolvedValue([
      {
        id: 'del-ready',
        status: 'delivered',
        jobId: 'webhook-delivery.del-ready',
        organizationId: 'org',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ] as WebhookDeliveryRecord[]);

    await reconciler.reconcileOnce();

    expect(jobs.ensureProcessable).not.toHaveBeenCalled();
  });

  it('pages beyond the first batch so later orphans are not starved', async () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const t1 = new Date('2026-01-01T00:00:01.000Z');
    const t2 = new Date('2026-01-01T00:00:02.000Z');

    deliveries.listPendingDeliveries
      .mockResolvedValueOnce([
        {
          id: 'a',
          status: 'pending',
          jobId: 'webhook-delivery.a',
          organizationId: 'org',
          createdAt: t0,
        },
        {
          id: 'b',
          status: 'pending',
          jobId: 'webhook-delivery.b',
          organizationId: 'org',
          createdAt: t1,
        },
      ] as WebhookDeliveryRecord[])
      .mockResolvedValueOnce([
        {
          id: 'c',
          status: 'pending',
          jobId: 'webhook-delivery.c',
          organizationId: 'org',
          createdAt: t2,
        },
      ] as WebhookDeliveryRecord[]);

    await reconciler.reconcileOnce();

    expect(deliveries.listPendingDeliveries).toHaveBeenCalledTimes(2);
    expect(deliveries.listPendingDeliveries.mock.calls[1]?.[0]).toEqual({
      limit: 2,
      after: { createdAt: t1, id: 'b' },
    });
    expect(jobs.ensureProcessable).toHaveBeenCalledTimes(3);
  });

  it('retries a pending delivery after a previous enqueue failure', async () => {
    deliveries.listPendingDeliveries.mockResolvedValue([
      {
        id: 'del-1',
        status: 'pending',
        jobId: 'webhook-delivery.del-1',
        organizationId: 'org',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ] as WebhookDeliveryRecord[]);
    jobs.ensureProcessable
      .mockRejectedValueOnce(new WebhookDeliveryEnqueueError())
      .mockResolvedValueOnce({ outcome: 'missing_published' });

    await reconciler.reconcileOnce();
    await reconciler.reconcileOnce();

    expect(jobs.ensureProcessable).toHaveBeenCalledTimes(2);
  });
});
