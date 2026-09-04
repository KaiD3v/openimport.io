import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ENV } from '../../../core/config/env.token.js';
import type { Env } from '../../../core/config/env.js';
import { ImportRepository } from '../import.repository.js';
import { ImportProcessingJobPublisher } from './ensure-processable-job.js';

/** Soft cap so one cycle can walk past a full batch of healthy jobs. */
const MAX_PAGES_PER_CYCLE = 5;

/**
 * MVP reconciler: same Nest process as API/worker.
 * Ensures non-terminal executions have a processable BullMQ job (missing or
 * terminal-divergent jobs are republished with the deterministic jobId).
 * Cursor pagination avoids starving later orphans behind healthy early rows.
 */
@Injectable()
export class ImportProcessingReconciler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ImportProcessingReconciler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private cursor: { createdAt: Date; id: string } | null = null;

  constructor(
    private readonly imports: ImportRepository,
    private readonly jobs: ImportProcessingJobPublisher,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (this.env.NODE_ENV === 'test') {
      // E2E may call reconcileOnce() explicitly; avoid background churn.
      return;
    }
    this.timer = setInterval(() => {
      void this.safeReconcile();
    }, this.env.IMPORT_JOB_RECONCILE_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Test helper: reset scan cursor between scenarios. */
  resetCursor(): void {
    this.cursor = null;
  }

  private async safeReconcile(): Promise<void> {
    try {
      await this.reconcileOnce();
    } catch (error) {
      this.logger.error({
        msg: 'import.processing.reconcile_failed',
        // Never log Redis URLs or credentials.
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  async reconcileOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const batchSize = this.env.IMPORT_JOB_RECONCILE_BATCH_SIZE;

      for (let page = 0; page < MAX_PAGES_PER_CYCLE; page += 1) {
        const executions = await this.imports.listRecoverableExecutions({
          limit: batchSize,
          after: this.cursor,
        });

        if (executions.length === 0) {
          this.cursor = null;
          break;
        }

        for (const execution of executions) {
          if (
            execution.status !== 'queued' &&
            execution.status !== 'processing'
          ) {
            continue;
          }

          try {
            const result = await this.jobs.ensureProcessable({
              organizationId: execution.organizationId,
              importSessionId: execution.importSessionId,
              executionId: execution.id,
              jobId: execution.jobId,
              executionStatus: execution.status,
            });

            if (
              result.outcome === 'missing_published' ||
              result.outcome === 'terminal_republished'
            ) {
              this.logger.log({
                msg: 'import.processing.reconcile_enqueued',
                executionId: execution.id,
                importSessionId: execution.importSessionId,
                organizationId: execution.organizationId,
                outcome: result.outcome,
              });
            }
          } catch {
            this.logger.error({
              msg: 'import.processing.reconcile_enqueue_failed',
              executionId: execution.id,
              importSessionId: execution.importSessionId,
              organizationId: execution.organizationId,
            });
          }
        }

        const last = executions[executions.length - 1]!;
        this.cursor = { createdAt: last.createdAt, id: last.id };

        if (executions.length < batchSize) {
          this.cursor = null;
          break;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
