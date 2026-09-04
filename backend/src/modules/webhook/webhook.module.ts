import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WEBHOOK_DELIVERY_QUEUE } from './delivery/webhook-delivery.queue.js';
import { WebhookDeliveryJobPublisher } from './delivery/webhook-delivery.publisher.js';
import { WebhookDeliveryReconciler } from './delivery/webhook-delivery.reconciler.js';
import { WebhookDeliveryWorker } from './delivery/webhook-delivery.worker.js';
import {
  FetchWebhookHttpPoster,
  WEBHOOK_HTTP_POSTER,
} from './delivery/webhook-http.poster.js';
import { WebhookDeliveryRepository } from './webhook-delivery.repository.js';
import { WebhookEndpointController } from './webhook-endpoint.controller.js';
import { WebhookEndpointRepository } from './webhook-endpoint.repository.js';
import { WebhookEndpointService } from './webhook-endpoint.service.js';
import { WEBHOOK_READY_OUTBOX } from './webhook.types.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: WEBHOOK_DELIVERY_QUEUE,
    }),
  ],
  controllers: [WebhookEndpointController],
  providers: [
    WebhookEndpointService,
    WebhookEndpointRepository,
    WebhookDeliveryRepository,
    WebhookDeliveryJobPublisher,
    WebhookDeliveryWorker,
    WebhookDeliveryReconciler,
    FetchWebhookHttpPoster,
    { provide: WEBHOOK_HTTP_POSTER, useExisting: FetchWebhookHttpPoster },
    { provide: WEBHOOK_READY_OUTBOX, useExisting: WebhookDeliveryRepository },
  ],
  exports: [
    WEBHOOK_READY_OUTBOX,
    WebhookDeliveryJobPublisher,
    WebhookDeliveryReconciler,
    WebhookDeliveryRepository,
  ],
})
export class WebhookModule {}
