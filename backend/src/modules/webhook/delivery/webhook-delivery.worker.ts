import { Inject, Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { ENV } from '../../../core/config/env.token.js';
import type { Env } from '../../../core/config/env.js';
import { env as bootEnv } from '../../../core/config/env.singleton.js';
import {
  decryptWebhookSecret,
  webhookSecretAad,
} from '../crypto/webhook-secret.crypto.js';
import { signWebhookPayload } from '../crypto/webhook-signature.js';
import {
  WEBHOOK_IDEMPOTENCY_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '../webhook.constants.js';
import { serializeWebhookPayload } from './import-ready-payload.js';
import { redactWebhookUrl } from './redact-webhook-url.js';
import {
  isRetryableWebhookStatus,
  isSuccessfulWebhookStatus,
  resolveWebhookWorkerConcurrency,
} from './webhook-delivery.policy.js';
import {
  WEBHOOK_DELIVERY_QUEUE,
  type WebhookDeliveryJobData,
} from './webhook-delivery.queue.js';
import {
  WEBHOOK_HTTP_POSTER,
  type WebhookHttpPoster,
} from './webhook-http.poster.js';
import { WebhookDeliveryRepository } from '../webhook-delivery.repository.js';
import { UnsafeWebhookUrlError } from '../ssrf/assert-safe-webhook-url.js';

@Injectable()
@Processor(WEBHOOK_DELIVERY_QUEUE, {
  concurrency: resolveWebhookWorkerConcurrency(bootEnv),
})
export class WebhookDeliveryWorker extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryWorker.name);

  constructor(
    private readonly deliveries: WebhookDeliveryRepository,
    @Inject(WEBHOOK_HTTP_POSTER) private readonly http: WebhookHttpPoster,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const { deliveryId, organizationId, traceId } = job.data;
    const delivery = await this.deliveries.findByIdForOrganization(
      organizationId,
      deliveryId,
    );
    if (!delivery || delivery.status !== 'pending') {
      return;
    }

    await this.deliveries.incrementAttempt(organizationId, deliveryId);

    let secret: string;
    try {
      secret = decryptWebhookSecret(
        delivery.secretCiphertext,
        this.env.WEBHOOK_SECRET_ENCRYPTION_KEY,
        webhookSecretAad(delivery.organizationId, delivery.endpointId),
      );
    } catch {
      await this.failPermanently(
        organizationId,
        deliveryId,
        'secret_undecryptable',
      );
      throw new UnrecoverableError('Webhook secret undecryptable');
    }

    const rawBody = serializeWebhookPayload(delivery.payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signWebhookPayload(secret, timestamp, rawBody);
    const maxAttempts =
      job.opts.attempts ?? this.env.WEBHOOK_WORKER_MAX_ATTEMPTS;
    const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;

    try {
      const result = await this.http.post({
        url: delivery.destinationUrl,
        body: rawBody,
        timeoutMs: this.env.WEBHOOK_DELIVERY_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
          [WEBHOOK_SIGNATURE_HEADER]: signature,
          [WEBHOOK_IDEMPOTENCY_HEADER]: delivery.id,
        },
      });

      if (isSuccessfulWebhookStatus(result.status)) {
        await this.deliveries.markDelivered(organizationId, deliveryId);
        this.logger.log({
          msg: 'webhook.delivery.delivered',
          deliveryId,
          organizationId,
          executionId: delivery.executionId,
          eventType: delivery.eventType,
          destination: redactWebhookUrl(delivery.destinationUrl),
          status: result.status,
          traceId,
          jobId: job.id,
        });
        return;
      }

      const errorCode = `http_${result.status}`;
      if (isRetryableWebhookStatus(result.status)) {
        if (isLastAttempt) {
          await this.failPermanently(organizationId, deliveryId, errorCode);
        }
        throw new Error(errorCode);
      }

      await this.failPermanently(organizationId, deliveryId, errorCode);
      throw new UnrecoverableError(errorCode);
    } catch (error) {
      if (error instanceof UnrecoverableError) {
        throw error;
      }
      if (error instanceof UnsafeWebhookUrlError) {
        await this.failPermanently(organizationId, deliveryId, 'unsafe_url');
        throw new UnrecoverableError('unsafe_url');
      }
      if (error instanceof Error && /^http_\d+$/.test(error.message)) {
        throw error;
      }

      const errorCode = webhookErrorCode(error);
      if (isLastAttempt) {
        await this.failPermanently(organizationId, deliveryId, errorCode);
      }
      throw error instanceof Error ? error : new Error(errorCode);
    }
  }

  private async failPermanently(
    organizationId: string,
    deliveryId: string,
    lastError: string,
  ): Promise<void> {
    await this.deliveries.markFailed(organizationId, deliveryId, lastError);
    this.logger.warn({
      msg: 'webhook.delivery.failed',
      deliveryId,
      organizationId,
      lastError,
    });
  }
}

function webhookErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'network_timeout';
  }
  if (error instanceof Error && /timeout/i.test(error.message)) {
    return 'network_timeout';
  }
  return 'network_error';
}
