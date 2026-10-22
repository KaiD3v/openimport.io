import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, JobState, Queue } from 'bullmq';
import { Inject } from '@nestjs/common';
import { ENV } from '../../../core/config/env.token.js';
import type { Env } from '../../../core/config/env.js';
import {
  IMPORT_PROCESSING_QUEUE,
  type ImportProcessingJobData,
} from './import-processing.queue.js';

const PROCESSABLE_JOB_STATES = new Set<JobState | 'unknown'>([
  'active',
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
]);

const TERMINAL_JOB_STATES = new Set<JobState | 'unknown'>([
  'completed',
  'failed',
]);

export type EnsureProcessableJobInput = {
  organizationId: string;
  importSessionId: string;
  executionId: string;
  jobId: string;
  executionStatus: string;
  traceId?: string;
};

export type EnsureProcessableJobResult =
  | { outcome: 'missing_published' }
  | { outcome: 'already_processable'; state: JobState | 'unknown' }
  | { outcome: 'terminal_republished'; previousState: JobState | 'unknown' }
  | { outcome: 'skipped_terminal_execution' };

export type RemoveTerminalResult =
  | { outcome: 'removed' }
  | { outcome: 'became_processable'; state: JobState | 'unknown' }
  | { outcome: 'terminal_remains'; state: JobState | 'unknown' }
  | { outcome: 'absent' }
  | { outcome: 'unknown'; state: JobState | 'unknown' };

/** Thrown when a processable BullMQ job could not be ensured. */
export class ImportProcessingEnqueueError extends Error {
  constructor(message = 'IMPORT_PROCESSING_ENQUEUE_FAILED') {
    super(message);
    this.name = 'ImportProcessingEnqueueError';
  }
}

/**
 * Shared publisher for confirm replay and the MVP reconciler.
 * For non-terminal executions, every successful return implies a processable
 * BullMQ job (or throws ImportProcessingEnqueueError). Persistent unknown is
 * never success; unknown jobs are never removed.
 */
@Injectable()
export class ImportProcessingJobPublisher {
  private readonly logger = new Logger(ImportProcessingJobPublisher.name);

  constructor(
    @InjectQueue(IMPORT_PROCESSING_QUEUE)
    private readonly queue: Queue<ImportProcessingJobData>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async ensureProcessable(
    input: EnsureProcessableJobInput,
  ): Promise<EnsureProcessableJobResult> {
    if (
      input.executionStatus !== 'queued' &&
      input.executionStatus !== 'processing'
    ) {
      return { outcome: 'skipped_terminal_execution' };
    }

    const existing = await this.queue.getJob(input.jobId);
    if (!existing) {
      await this.publishAndRequireProcessable(input);
      return { outcome: 'missing_published' };
    }

    const state = await existing.getState();
    if (PROCESSABLE_JOB_STATES.has(state)) {
      return { outcome: 'already_processable', state };
    }
    if (TERMINAL_JOB_STATES.has(state)) {
      return this.recoverTerminalJob(existing, state, input);
    }

    return this.resolveUnknownState(input);
  }

  private async resolveUnknownState(
    input: EnsureProcessableJobInput,
  ): Promise<EnsureProcessableJobResult> {
    this.logger.warn({
      msg: 'import.processing.job_state_unknown',
      executionId: input.executionId,
      importSessionId: input.importSessionId,
      organizationId: input.organizationId,
    });

    let again: Job<ImportProcessingJobData> | undefined | null;
    try {
      again = await this.queue.getJob(input.jobId);
    } catch {
      this.failEnqueue(input, { reason: 'job_state_unknown_reconsult_failed' });
    }

    if (!again) {
      await this.publishAndRequireProcessable(input);
      return { outcome: 'missing_published' };
    }

    let resolved: JobState | 'unknown';
    try {
      resolved = await again.getState();
    } catch {
      this.failEnqueue(input, {
        reason: 'job_state_unknown_reconsult_failed',
      });
    }

    if (PROCESSABLE_JOB_STATES.has(resolved)) {
      return { outcome: 'already_processable', state: resolved };
    }
    if (TERMINAL_JOB_STATES.has(resolved)) {
      return this.recoverTerminalJob(again, resolved, input);
    }

    // Still unknown — do not remove; fail so callers retry later.
    this.failEnqueue(input, {
      reason: 'job_state_unknown_persistent',
      jobState: resolved,
    });
  }

  private async recoverTerminalJob(
    job: Job<ImportProcessingJobData>,
    state: JobState | 'unknown',
    input: EnsureProcessableJobInput,
  ): Promise<EnsureProcessableJobResult> {
    const removal = await this.removeTerminalIfSafe(job, state, input);
    if (removal.outcome === 'became_processable') {
      return {
        outcome: 'already_processable',
        state: removal.state,
      };
    }
    if (
      removal.outcome === 'terminal_remains' ||
      removal.outcome === 'unknown'
    ) {
      this.failEnqueue(input, {
        reason: 'terminal_job_not_cleared',
        jobState: removal.state,
      });
    }
    await this.publishAndRequireProcessable(input);
    return { outcome: 'terminal_republished', previousState: state };
  }

  private async removeTerminalIfSafe(
    job: Job<ImportProcessingJobData>,
    state: JobState | 'unknown',
    input: EnsureProcessableJobInput,
  ): Promise<RemoveTerminalResult> {
    const latest = await job.getState();
    if (PROCESSABLE_JOB_STATES.has(latest)) {
      return { outcome: 'became_processable', state: latest };
    }
    if (!TERMINAL_JOB_STATES.has(latest)) {
      return { outcome: 'unknown', state: latest };
    }

    try {
      await job.remove();
    } catch {
      const after = await this.queue.getJob(input.jobId);
      if (!after) {
        return { outcome: 'absent' };
      }
      const afterState = await after.getState();
      if (PROCESSABLE_JOB_STATES.has(afterState)) {
        return { outcome: 'became_processable', state: afterState };
      }
      if (TERMINAL_JOB_STATES.has(afterState)) {
        this.logger.warn({
          msg: 'import.processing.terminal_job_remove_failed',
          executionId: input.executionId,
          importSessionId: input.importSessionId,
          organizationId: input.organizationId,
          previousState: state,
          jobState: afterState,
        });
        return { outcome: 'terminal_remains', state: afterState };
      }
      return { outcome: 'unknown', state: afterState };
    }

    const remaining = await this.queue.getJob(input.jobId);
    if (!remaining) {
      return { outcome: 'removed' };
    }
    const remainingState = await remaining.getState();
    if (PROCESSABLE_JOB_STATES.has(remainingState)) {
      return { outcome: 'became_processable', state: remainingState };
    }
    if (TERMINAL_JOB_STATES.has(remainingState)) {
      return { outcome: 'terminal_remains', state: remainingState };
    }
    return { outcome: 'unknown', state: remainingState };
  }

  private async publishAndRequireProcessable(
    input: EnsureProcessableJobInput,
  ): Promise<void> {
    const data: ImportProcessingJobData = {
      organizationId: input.organizationId,
      importSessionId: input.importSessionId,
      executionId: input.executionId,
      traceId: input.traceId,
    };

    try {
      const raced = await this.queue.getJob(input.jobId);
      if (raced) {
        const state = await raced.getState();
        if (PROCESSABLE_JOB_STATES.has(state)) {
          return;
        }
        if (TERMINAL_JOB_STATES.has(state)) {
          const removal = await this.removeTerminalIfSafe(raced, state, input);
          if (removal.outcome === 'became_processable') {
            return;
          }
          if (
            removal.outcome === 'terminal_remains' ||
            removal.outcome === 'unknown'
          ) {
            this.failEnqueue(input, {
              reason: 'terminal_job_blocks_publish',
              jobState: removal.state,
            });
          }
        } else {
          this.failEnqueue(input, {
            reason: 'job_state_unknown_before_publish',
            jobState: state,
          });
        }
      }

      const added = await this.queue.add('process', data, {
        jobId: input.jobId,
        attempts: this.env.IMPORT_WORKER_MAX_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: this.env.IMPORT_WORKER_BACKOFF_MS,
          jitter: 0.5,
        },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 86_400 * 7 },
      });

      await this.assertProcessable(input, added);
    } catch (error) {
      if (error instanceof ImportProcessingEnqueueError) {
        throw error;
      }

      const after = await this.queue.getJob(input.jobId).catch(() => null);
      if (after) {
        const state = await after.getState().catch(() => 'unknown' as const);
        if (PROCESSABLE_JOB_STATES.has(state)) {
          return;
        }
        this.failEnqueue(input, {
          reason: PROCESSABLE_JOB_STATES.has(state)
            ? 'unreachable'
            : TERMINAL_JOB_STATES.has(state)
              ? 'race_left_terminal_job'
              : 'race_left_unusable_job',
          jobState: state,
        });
      }

      this.failEnqueue(input, { reason: 'enqueue_failed_job_absent' });
    }
  }

  private async assertProcessable(
    input: EnsureProcessableJobInput,
    candidate: Job<ImportProcessingJobData> | null | undefined,
  ): Promise<void> {
    const job =
      candidate ?? (await this.queue.getJob(input.jobId).catch(() => null));
    if (!job) {
      this.failEnqueue(input, { reason: 'postcondition_job_absent' });
    }
    const state = await job.getState().catch(() => 'unknown' as const);
    if (PROCESSABLE_JOB_STATES.has(state)) {
      return;
    }
    this.failEnqueue(input, {
      reason: 'postcondition_not_processable',
      jobState: state,
    });
  }

  private failEnqueue(
    input: EnsureProcessableJobInput,
    detail: { reason: string; jobState?: JobState | 'unknown' },
  ): never {
    this.logger.error({
      msg: 'import.processing_enqueue_failed',
      importId: input.importSessionId,
      executionId: input.executionId,
      organizationId: input.organizationId,
      traceId: input.traceId,
      reason: detail.reason,
      jobState: detail.jobState,
    });
    throw new ImportProcessingEnqueueError();
  }
}
