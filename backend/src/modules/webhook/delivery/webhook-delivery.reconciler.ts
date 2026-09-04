import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ENV } from '../../../core/config/env.token.js';
import type { Env } from '../../../core/config/env.js';
import { WebhookDeliveryRepository } from '../webhook-delivery.repository.js';
import { WebhookDeliveryJobPublisher } from './webhook-delivery.publisher.js';

const MAX_PAGES_PER_CYCLE = 5;

@Injectable()
export class WebhookDeliveryReconciler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WebhookDeliveryReconciler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private cursor: { createdAt: Date; id: string } | null = null;

  constructor(
    private readonly deliveries: WebhookDeliveryRepository,
    private readonly jobs: WebhookDeliveryJobPublisher,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (this.env.NODE_ENV === 'test') {
      return;
    }
    this.timer = setInterval(() => {
      void this.safeReconcile();
    }, this.env.WEBHOOK_JOB_RECONCILE_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  resetCursor(): void {
    this.cursor = null;
  }

  private async safeReconcile(): Promise<void> {
    try {
      await this.reconcileOnce();
    } catch (error) {
      this.logger.error({
        msg: 'webhook.delivery.reconcile_failed',
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
      const batchSize = this.env.WEBHOOK_JOB_RECONCILE_BATCH_SIZE;

      for (let page = 0; page < MAX_PAGES_PER_CYCLE; page += 1) {
        const deliveries = await this.deliveries.listPendingDeliveries({
          limit: batchSize,
          after: this.cursor,
        });

        if (deliveries.length === 0) {
          this.cursor = null;
          break;
        }

        for (const delivery of deliveries) {
          if (delivery.status !== 'pending') {
            continue;
          }

          try {
            const result = await this.jobs.ensureProcessable({
              deliveryId: delivery.id,
              organizationId: delivery.organizationId,
              jobId: delivery.jobId,
              deliveryStatus: delivery.status,
              traceId: undefined,
            });

            if (
              result.outcome === 'missing_published' ||
              result.outcome === 'terminal_republished'
            ) {
              this.logger.log({
                msg: 'webhook.delivery.reconcile_enqueued',
                deliveryId: delivery.id,
                organizationId: delivery.organizationId,
                outcome: result.outcome,
              });
            }
          } catch {
            this.logger.error({
              msg: 'webhook.delivery.reconcile_enqueue_failed',
              deliveryId: delivery.id,
              organizationId: delivery.organizationId,
            });
          }
        }

        const last = deliveries[deliveries.length - 1]!;
        this.cursor = { createdAt: last.createdAt, id: last.id };

        if (deliveries.length < batchSize) {
          this.cursor = null;
          break;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
