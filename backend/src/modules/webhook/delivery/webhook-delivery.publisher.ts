import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, JobState, Queue } from 'bullmq';
import { Inject } from '@nestjs/common';
import { ENV } from '../../../core/config/env.token.js';
import type { Env } from '../../../core/config/env.js';
import {
  WEBHOOK_DELIVERY_QUEUE,
  type WebhookDeliveryJobData,
  webhookDeliveryJobId,
} from './webhook-delivery.queue.js';

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

export type EnsureWebhookDeliveryJobInput = {
  deliveryId: string;
  organizationId: string;
  jobId: string;
  deliveryStatus: string;
  traceId?: string;
};

export type EnsureWebhookDeliveryJobResult =
  | { outcome: 'missing_published' }
  | { outcome: 'already_processable'; state: JobState | 'unknown' }
  | { outcome: 'terminal_republished'; previousState: JobState | 'unknown' }
  | { outcome: 'skipped_terminal_delivery' };

export type RemoveWebhookTerminalResult =
  | { outcome: 'removed' }
  | { outcome: 'became_processable'; state: JobState | 'unknown' }
  | { outcome: 'terminal_remains'; state: JobState | 'unknown' }
  | { outcome: 'absent' }
  | { outcome: 'unknown'; state: JobState | 'unknown' };

/** Thrown when a processable BullMQ job could not be ensured. */
export class WebhookDeliveryEnqueueError extends Error {
  constructor(message = 'WEBHOOK_DELIVERY_ENQUEUE_FAILED') {
    super(message);
    this.name = 'WebhookDeliveryEnqueueError';
  }
}

/**
 * Publisher for post-commit enqueue and the webhook reconciler.
 * For pending deliveries, every successful return implies a processable
 * BullMQ job (or throws WebhookDeliveryEnqueueError). Persistent unknown is
 * never success; unknown jobs are never removed. queue.add() alone is not
 * treated as proof of a processable job.
 */
@Injectable()
export class WebhookDeliveryJobPublisher {
  private readonly logger = new Logger(WebhookDeliveryJobPublisher.name);

  constructor(
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly queue: Queue<WebhookDeliveryJobData>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async enqueueBestEffort(input: {
    deliveryId: string;
    organizationId: string;
    traceId?: string;
  }): Promise<void> {
    try {
      await this.ensureProcessable({
        deliveryId: input.deliveryId,
        organizationId: input.organizationId,
        jobId: webhookDeliveryJobId(input.deliveryId),
        deliveryStatus: 'pending',
        traceId: input.traceId,
      });
    } catch {
      this.logger.error({
        msg: 'webhook.delivery_enqueue_failed',
        deliveryId: input.deliveryId,
        organizationId: input.organizationId,
        traceId: input.traceId,
      });
    }
  }

  async ensureProcessable(
    input: EnsureWebhookDeliveryJobInput,
  ): Promise<EnsureWebhookDeliveryJobResult> {
    if (input.deliveryStatus !== 'pending') {
      return { outcome: 'skipped_terminal_delivery' };
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
    input: EnsureWebhookDeliveryJobInput,
  ): Promise<EnsureWebhookDeliveryJobResult> {
    this.logger.warn({
      msg: 'webhook.delivery.job_state_unknown',
      deliveryId: input.deliveryId,
      organizationId: input.organizationId,
    });

    let again: Job<WebhookDeliveryJobData> | undefined | null;
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

    this.failEnqueue(input, {
      reason: 'job_state_unknown_persistent',
      jobState: resolved,
    });
  }

  private async recoverTerminalJob(
    job: Job<WebhookDeliveryJobData>,
    state: JobState | 'unknown',
    input: EnsureWebhookDeliveryJobInput,
  ): Promise<EnsureWebhookDeliveryJobResult> {
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
    job: Job<WebhookDeliveryJobData>,
    state: JobState | 'unknown',
    input: EnsureWebhookDeliveryJobInput,
  ): Promise<RemoveWebhookTerminalResult> {
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
          msg: 'webhook.delivery.terminal_job_remove_failed',
          deliveryId: input.deliveryId,
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
    input: EnsureWebhookDeliveryJobInput,
  ): Promise<void> {
    const data: WebhookDeliveryJobData = {
      deliveryId: input.deliveryId,
      organizationId: input.organizationId,
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

      await this.queue.add('deliver', data, {
        jobId: input.jobId,
        attempts: this.env.WEBHOOK_WORKER_MAX_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: this.env.WEBHOOK_WORKER_BACKOFF_MS,
        },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 86_400 * 7 },
      });

      await this.assertProcessable(input);
    } catch (error) {
      if (error instanceof WebhookDeliveryEnqueueError) {
        throw error;
      }

      const after = await this.queue.getJob(input.jobId).catch(() => null);
      if (after) {
        const state = await after.getState().catch(() => 'unknown' as const);
        if (PROCESSABLE_JOB_STATES.has(state)) {
          return;
        }
        this.failEnqueue(input, {
          reason: TERMINAL_JOB_STATES.has(state)
            ? 'race_left_terminal_job'
            : 'race_left_unusable_job',
          jobState: state,
        });
      }

      this.failEnqueue(input, { reason: 'enqueue_failed_job_absent' });
    }
  }

  private async assertProcessable(
    input: EnsureWebhookDeliveryJobInput,
  ): Promise<void> {
    const job = await this.queue.getJob(input.jobId).catch(() => null);
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
    input: EnsureWebhookDeliveryJobInput,
    detail: { reason: string; jobState?: JobState | 'unknown' },
  ): never {
    this.logger.error({
      msg: 'webhook.delivery_enqueue_failed',
      deliveryId: input.deliveryId,
      organizationId: input.organizationId,
      traceId: input.traceId,
      reason: detail.reason,
      jobState: detail.jobState,
    });
    throw new WebhookDeliveryEnqueueError();
  }
}
