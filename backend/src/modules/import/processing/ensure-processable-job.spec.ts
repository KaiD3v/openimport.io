import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { Env } from '../../../core/config/env.js';
import {
  ImportProcessingEnqueueError,
  ImportProcessingJobPublisher,
} from './ensure-processable-job.js';

describe('ImportProcessingJobPublisher', () => {
  let queue: {
    getJob: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
  };
  let publisher: ImportProcessingJobPublisher;

  const base = {
    organizationId: 'org',
    importSessionId: 'imp',
    executionId: 'exec',
    jobId: 'import-process.imp.fp',
    executionStatus: 'processing' as const,
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
    publisher = new ImportProcessingJobPublisher(
      queue as unknown as Queue,
      {
        IMPORT_WORKER_MAX_ATTEMPTS: 3,
        IMPORT_WORKER_BACKOFF_MS: 100,
      } as Env,
    );
  });

  it('publishes when the job is missing and final state is processable', async () => {
    queue.getJob
      .mockResolvedValueOnce(null) // initial
      .mockResolvedValueOnce(null); // pre-add race check
    queue.add.mockResolvedValue({
      id: base.jobId,
      getState: vi.fn().mockResolvedValue('waiting'),
    });

    const result = await publisher.ensureProcessable(base);
    expect(result.outcome).toBe('missing_published');
    expect(queue.add).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledWith(
      'process',
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
      .mockResolvedValueOnce(failed) // initial
      .mockResolvedValueOnce(null) // confirmed removed
      .mockResolvedValueOnce(null); // pre-add race check

    queue.add.mockResolvedValue({
      id: base.jobId,
      getState: vi.fn().mockResolvedValue('waiting'),
    });

    const result = await publisher.ensureProcessable(base);

    expect(remove).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledOnce();
    expect(result.outcome).toBe('terminal_republished');
  });

  it('rejects when remove() fails and the job remains failed', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('locked'));
    const failed = terminalJob('failed', remove);
    // getState stays failed before and after remove attempt
    failed.getState = vi.fn().mockResolvedValue('failed');

    queue.getJob
      .mockResolvedValueOnce(failed)
      .mockResolvedValue(failed);

    await expect(publisher.ensureProcessable(base)).rejects.toBeInstanceOf(
      ImportProcessingEnqueueError,
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('preserves and returns already_processable when remove fails because job became active', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('cannot remove active'));
    const job = {
      id: base.jobId,
      getState: vi
        .fn()
        .mockResolvedValueOnce('failed') // initial classification
        .mockResolvedValueOnce('failed') // pre-remove recheck
        .mockResolvedValueOnce('active'), // after failed remove
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
      .mockResolvedValue(failed); // postcondition still failed

    queue.add.mockResolvedValue(failed);

    await expect(publisher.ensureProcessable(base)).rejects.toBeInstanceOf(
      ImportProcessingEnqueueError,
    );
  });

  it('treats a race that leaves waiting as idempotent success', async () => {
    queue.getJob
      .mockResolvedValueOnce(null) // initial missing
      .mockResolvedValueOnce(null) // pre-add
      .mockResolvedValueOnce(processableJob('waiting')); // catch inspection
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
      ImportProcessingEnqueueError,
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

  it('skips terminal DB executions without touching the queue', async () => {
    const result = await publisher.ensureProcessable({
      ...base,
      executionStatus: 'ready',
    });
    expect(result.outcome).toBe('skipped_terminal_execution');
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
      .mockResolvedValueOnce(unknownJob) // initial
      .mockResolvedValueOnce(null) // reconsult → gone
      .mockResolvedValueOnce(null); // pre-add race
    queue.add.mockResolvedValue({
      id: base.jobId,
      getState: vi.fn().mockResolvedValue('waiting'),
    });

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
      .mockResolvedValueOnce(failed) // reconsult → terminal
      .mockResolvedValueOnce(null) // after remove
      .mockResolvedValueOnce(null); // pre-add
    queue.add.mockResolvedValue({
      id: base.jobId,
      getState: vi.fn().mockResolvedValue('waiting'),
    });

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
      ImportProcessingEnqueueError,
    );
    expect(remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('recovers a completed job while the execution is still processing', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const completed = terminalJob('completed', remove);

    queue.getJob
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    queue.add.mockResolvedValue({
      id: base.jobId,
      getState: vi.fn().mockResolvedValue('waiting'),
    });

    const result = await publisher.ensureProcessable(base);
    expect(result.outcome).toBe('terminal_republished');
    expect(remove).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledOnce();
  });
});
