import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { Env } from '../../../core/config/env.js';
import {
  WebhookDeliveryEnqueueError,
  WebhookDeliveryJobPublisher,
} from './webhook-delivery.publisher.js';

describe('WebhookDeliveryJobPublisher', () => {
  let queue: {
    getJob: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
  };
  let publisher: WebhookDeliveryJobPublisher;

  const base = {
    organizationId: 'org',
    deliveryId: 'del-1',
    jobId: 'webhook-delivery.del-1',
    deliveryStatus: 'pending' as const,
  };

  function processableJob(state: string) {
    return {
      id: base.jobId,
      getState: vi.fn().mockResolvedValue(state),
      remove: vi.fn(),
    };
  }

  function terminalJob(state: string, remove: ReturnType<typeof vi.fn>) {
    return {
      id: base.jobId,
      getState: vi.fn().mockResolvedValue(state),
      remove,
    };
  }

  beforeEach(() => {
    queue = {
      getJob: vi.fn().mockResolvedValue(null),
      add: vi.fn().mockResolvedValue({
        id: base.jobId,
        getState: vi.fn().mockResolvedValue('waiting'),
      }),
    };
    publisher = new WebhookDeliveryJobPublisher(
      queue as unknown as Queue,
      {
        WEBHOOK_WORKER_MAX_ATTEMPTS: 5,
        WEBHOOK_WORKER_BACKOFF_MS: 100,
      } as Env,
    );
  });

  it('publishes when the job is missing and final state is processable', async () => {
    queue.getJob
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(processableJob('waiting'));

    const result = await publisher.ensureProcessable(base);
    expect(result.outcome).toBe('missing_published');
    expect(queue.add).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledWith(
      'deliver',
      expect.anything(),
      expect.objectContaining({
        backoff: {
          type: 'exponential',
          delay: 100,
          jitter: 0.5,
        },
      }),
    );
  });

  it('keeps waiting/delayed/active jobs without republishing', async () => {
    for (const state of ['waiting', 'delayed', 'active', 'prioritized'] as const) {
      queue.getJob.mockResolvedValue(processableJob(state));
      queue.add.mockClear();

      const result = await publisher.ensureProcessable(base);
      expect(result.outcome).toBe('already_processable');
      expect(queue.add).not.toHaveBeenCalled();
    }
  });

  it('removes a failed job and republishes to waiting → terminal_republished', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const failed = terminalJob('failed', remove);

    queue.getJob
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(processableJob('waiting'));

    const result = await publisher.ensureProcessable(base);

    expect(remove).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledOnce();
    expect(result.outcome).toBe('terminal_republished');
  });

  it('rejects when remove() fails and the job remains failed', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('locked'));
    const failed = terminalJob('failed', remove);
    failed.getState = vi.fn().mockResolvedValue('failed');

    queue.getJob.mockResolvedValueOnce(failed).mockResolvedValue(failed);

    await expect(publisher.ensureProcessable(base)).rejects.toBeInstanceOf(
      WebhookDeliveryEnqueueError,
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('preserves and returns already_processable when remove fails because job became active', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('cannot remove active'));
    const job = {
      id: base.jobId,
      getState: vi
        .fn()
        .mockResolvedValueOnce('failed')
        .mockResolvedValueOnce('failed')
        .mockResolvedValueOnce('active'),
      remove,
    };

    queue.getJob.mockResolvedValue(job);

    const result = await publisher.ensureProcessable(base);
    expect(result).toEqual({ outcome: 'already_processable', state: 'active' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects when queue.add leaves or finds the old terminal job', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const failed = terminalJob('failed', remove);

    queue.getJob
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(failed);

    queue.add.mockResolvedValue(failed);

    await expect(publisher.ensureProcessable(base)).rejects.toBeInstanceOf(
      WebhookDeliveryEnqueueError,
    );
  });

  it('treats a race that leaves waiting as idempotent success', async () => {
    queue.getJob
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(processableJob('waiting'));
    queue.add.mockRejectedValue(new Error('Job already exists'));

    const result = await publisher.ensureProcessable(base);
    expect(result.outcome).toBe('missing_published');
  });

  it('rejects when add races and the remaining job is still terminal', async () => {
    const failed = terminalJob('failed', vi.fn());
    queue.getJob
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(failed);
    queue.add.mockRejectedValue(new Error('Job already exists'));

    await expect(publisher.ensureProcessable(base)).rejects.toBeInstanceOf(
      WebhookDeliveryEnqueueError,
    );
  });

  it('never removes an active job', async () => {
    const remove = vi.fn();
    queue.getJob.mockResolvedValue({
      id: base.jobId,
      getState: vi.fn().mockResolvedValue('active'),
      remove,
    });

    await publisher.ensureProcessable(base);
    expect(remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('skips terminal deliveries without touching the queue', async () => {
    const result = await publisher.ensureProcessable({
      ...base,
      deliveryStatus: 'delivered',
    });
    expect(result.outcome).toBe('skipped_terminal_delivery');
    expect(queue.getJob).not.toHaveBeenCalled();
  });

  it('unknown then absent on reconsult publishes and requires waiting', async () => {
    const remove = vi.fn();
    const unknownJob = {
      id: base.jobId,
      getState: vi.fn().mockResolvedValue('unknown'),
      remove,
    };

    queue.getJob
      .mockResolvedValueOnce(unknownJob)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(processableJob('waiting'));

    const result = await publisher.ensureProcessable(base);
    expect(result.outcome).toBe('missing_published');
    expect(remove).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledOnce();
  });

  it('unknown then active on reconsult returns already_processable', async () => {
    const remove = vi.fn();
    queue.getJob
      .mockResolvedValueOnce({
        id: base.jobId,
        getState: vi.fn().mockResolvedValue('unknown'),
        remove,
      })
      .mockResolvedValueOnce(processableJob('active'));

    const result = await publisher.ensureProcessable(base);
    expect(result).toEqual({ outcome: 'already_processable', state: 'active' });
    expect(remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('unknown then failed on reconsult recovers via terminal republish', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const failed = terminalJob('failed', remove);

    queue.getJob
      .mockResolvedValueOnce({
        id: base.jobId,
        getState: vi.fn().mockResolvedValue('unknown'),
        remove: vi.fn(),
      })
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(processableJob('waiting'));

    const result = await publisher.ensureProcessable(base);
    expect(result.outcome).toBe('terminal_republished');
    expect(remove).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledOnce();
  });

  it('persistent unknown rejects without removing the job', async () => {
    const remove = vi.fn();
    const unknownJob = {
      id: base.jobId,
      getState: vi.fn().mockResolvedValue('unknown'),
      remove,
    };
    queue.getJob.mockResolvedValue(unknownJob);

    await expect(publisher.ensureProcessable(base)).rejects.toBeInstanceOf(
      WebhookDeliveryEnqueueError,
    );
    expect(remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not report success when queue.add returns a terminal duplicate', async () => {
    const failed = terminalJob('failed', vi.fn());
    queue.getJob
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(failed);
    queue.add.mockResolvedValue(failed);

    await expect(publisher.ensureProcessable(base)).rejects.toBeInstanceOf(
      WebhookDeliveryEnqueueError,
    );
  });

  it('swallows enqueue failure in enqueueBestEffort without throwing', async () => {
    queue.getJob.mockResolvedValue({
      id: base.jobId,
      getState: vi.fn().mockResolvedValue('unknown'),
      remove: vi.fn(),
    });

    await expect(
      publisher.enqueueBestEffort({
        deliveryId: base.deliveryId,
        organizationId: base.organizationId,
      }),
    ).resolves.toBeUndefined();
  });
});
