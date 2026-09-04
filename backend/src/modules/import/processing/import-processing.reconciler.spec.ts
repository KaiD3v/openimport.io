import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../core/config/env.js';
import type { ImportRepository } from '../import.repository.js';
import type { ImportExecutionRecord } from '../import.types.js';
import type { ImportProcessingJobPublisher } from './ensure-processable-job.js';
import { ImportProcessingEnqueueError } from './ensure-processable-job.js';
import { ImportProcessingReconciler } from './import-processing.reconciler.js';

describe('ImportProcessingReconciler', () => {
  let imports: {
    listRecoverableExecutions: ReturnType<typeof vi.fn>;
  };
  let jobs: {
    ensureProcessable: ReturnType<typeof vi.fn>;
  };
  let reconciler: ImportProcessingReconciler;

  beforeEach(() => {
    imports = {
      listRecoverableExecutions: vi.fn().mockResolvedValue([]),
    };
    jobs = {
      ensureProcessable: vi.fn().mockResolvedValue({ outcome: 'already_processable', state: 'waiting' }),
    };
    reconciler = new ImportProcessingReconciler(
      imports as unknown as ImportRepository,
      jobs as unknown as ImportProcessingJobPublisher,
      {
        IMPORT_JOB_RECONCILE_BATCH_SIZE: 2,
        IMPORT_JOB_RECONCILE_INTERVAL_MS: 60_000,
        NODE_ENV: 'test',
      } as Env,
    );
    reconciler.resetCursor();
  });

  it('ignores terminal executions even if listed incorrectly', async () => {
    imports.listRecoverableExecutions.mockResolvedValue([
      {
        id: 'exec-ready',
        status: 'ready',
        jobId: 'job-ready',
        organizationId: 'org',
        importSessionId: 'imp',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'exec-failed',
        status: 'failed',
        jobId: 'job-failed',
        organizationId: 'org',
        importSessionId: 'imp',
        createdAt: new Date('2026-01-01T00:00:01.000Z'),
      },
    ] as ImportExecutionRecord[]);

    await reconciler.reconcileOnce();

    expect(jobs.ensureProcessable).not.toHaveBeenCalled();
  });

  it('republishes missing jobs for non-terminal executions without creating executions', async () => {
    imports.listRecoverableExecutions.mockResolvedValue([
      {
        id: 'exec-1',
        status: 'queued',
        jobId: 'job-1',
        organizationId: 'org',
        importSessionId: 'imp',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ] as ImportExecutionRecord[]);
    jobs.ensureProcessable.mockResolvedValue({ outcome: 'missing_published' });

    await reconciler.reconcileOnce();

    expect(jobs.ensureProcessable).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org',
        importSessionId: 'imp',
        executionId: 'exec-1',
        jobId: 'job-1',
        executionStatus: 'queued',
      }),
    );
  });

  it('keeps healthy jobs via ensureProcessable without creating executions', async () => {
    imports.listRecoverableExecutions.mockResolvedValue([
      {
        id: 'exec-1',
        status: 'queued',
        jobId: 'job-1',
        organizationId: 'org',
        importSessionId: 'imp',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ] as ImportExecutionRecord[]);

    await reconciler.reconcileOnce();

    expect(jobs.ensureProcessable).toHaveBeenCalledOnce();
  });

  it('recovers failed BullMQ jobs for processing executions', async () => {
    imports.listRecoverableExecutions.mockResolvedValue([
      {
        id: 'exec-1',
        status: 'processing',
        jobId: 'job-1',
        organizationId: 'org',
        importSessionId: 'imp',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ] as ImportExecutionRecord[]);
    jobs.ensureProcessable.mockResolvedValue({
      outcome: 'terminal_republished',
      previousState: 'failed',
    });

    await reconciler.reconcileOnce();

    expect(jobs.ensureProcessable).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'exec-1',
        executionStatus: 'processing',
      }),
    );
  });

  it('does not log a publish outcome when ensureProcessable rejects persistent unknown', async () => {
    imports.listRecoverableExecutions.mockResolvedValue([
      {
        id: 'exec-1',
        status: 'queued',
        jobId: 'job-1',
        organizationId: 'org',
        importSessionId: 'imp',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ] as ImportExecutionRecord[]);
    jobs.ensureProcessable.mockRejectedValue(new ImportProcessingEnqueueError());

    await reconciler.reconcileOnce();

    expect(jobs.ensureProcessable).toHaveBeenCalledOnce();
  });

  it('pages beyond the first batch so later orphans are not starved', async () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const t1 = new Date('2026-01-01T00:00:01.000Z');
    const t2 = new Date('2026-01-01T00:00:02.000Z');

    imports.listRecoverableExecutions
      .mockResolvedValueOnce([
        {
          id: 'exec-a',
          status: 'queued',
          jobId: 'job-a',
          organizationId: 'org',
          importSessionId: 'imp-a',
          createdAt: t0,
        },
        {
          id: 'exec-b',
          status: 'queued',
          jobId: 'job-b',
          organizationId: 'org',
          importSessionId: 'imp-b',
          createdAt: t1,
        },
      ] as ImportExecutionRecord[])
      .mockResolvedValueOnce([
        {
          id: 'exec-c',
          status: 'queued',
          jobId: 'job-c',
          organizationId: 'org',
          importSessionId: 'imp-c',
          createdAt: t2,
        },
      ] as ImportExecutionRecord[]);

    jobs.ensureProcessable
      .mockResolvedValueOnce({ outcome: 'already_processable', state: 'waiting' })
      .mockResolvedValueOnce({ outcome: 'already_processable', state: 'waiting' })
      .mockResolvedValueOnce({ outcome: 'missing_published' });

    await reconciler.reconcileOnce();

    expect(imports.listRecoverableExecutions).toHaveBeenCalledTimes(2);
    expect(imports.listRecoverableExecutions.mock.calls[1]?.[0]).toEqual({
      limit: 2,
      after: { createdAt: t1, id: 'exec-b' },
    });
    expect(jobs.ensureProcessable).toHaveBeenCalledTimes(3);
    expect(jobs.ensureProcessable.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({ executionId: 'exec-c' }),
    );
  });
});
