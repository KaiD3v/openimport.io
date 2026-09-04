export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';

export type WebhookDeliveryJobData = {
  deliveryId: string;
  organizationId: string;
  traceId?: string;
};

export function webhookDeliveryJobId(deliveryId: string): string {
  return `webhook-delivery.${deliveryId}`;
}
