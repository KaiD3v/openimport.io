import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import type { Env } from '../../../core/config/env.js';
import { IMPORT_READY_EVENT_TYPE } from '../webhook.constants.js';
import type { WebhookDeliveryRecord } from '../webhook.types.js';
import { WebhookDeliveryWorker } from './webhook-delivery.worker.js';
import type { WebhookHttpPoster } from './webhook-http.poster.js';
import type { WebhookDeliveryRepository } from '../webhook-delivery.repository.js';
import {
  encryptWebhookSecret,
  webhookSecretAad,
} from '../crypto/webhook-secret.crypto.js';
import { verifyWebhookSignature } from '../crypto/webhook-signature.js';
import { serializeWebhookPayload } from './import-ready-payload.js';
import { UnsafeWebhookUrlError } from '../ssrf/assert-safe-webhook-url.js';

const ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SECRET_A =
  'oi_whsec_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SECRET_B =
  'oi_whsec_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const organizationId = '11111111-1111-4111-8111-111111111111';
const deliveryId = '22222222-2222-4222-8222-222222222222';
const endpointId = '33333333-3333-4333-8333-333333333333';

function snapshotCiphertext(secret: string): string {
  return encryptWebhookSecret(
    secret,
    ENCRYPTION_KEY,
    webhookSecretAad(organizationId, endpointId),
  );
}

function delivery(
  overrides: Partial<WebhookDeliveryRecord> = {},
): WebhookDeliveryRecord {
  const now = new Date('2026-09-04T12:00:00.000Z');
  return {
    id: deliveryId,
    organizationId,
    endpointId,
    executionId: '44444444-4444-4444-8444-444444444444',
    importSessionId: '55555555-5555-4555-8555-555555555555',
    eventType: IMPORT_READY_EVENT_TYPE,
    status: 'pending',
    destinationUrl: 'https://hooks-a.example.com/ready',
    secretCiphertext: snapshotCiphertext(SECRET_A),
    payload: {
      id: deliveryId,
      type: IMPORT_READY_EVENT_TYPE,
      createdAt: now.toISOString(),
      data: {
        organizationId,
        importId: '55555555-5555-4555-8555-555555555555',
        executionId: '44444444-4444-4444-8444-444444444444',
        status: 'ready',
        counts: {
          totalRows: 2,
          validRows: 1,
          invalidRows: 1,
          processedRows: 2,
        },
      },
    },
    jobId: `webhook-delivery.${deliveryId}`,
    attemptCount: 0,
    lastError: null,
    deliveredAt: null,
    failedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('WebhookDeliveryWorker', () => {
  let deliveries: {
    findByIdForOrganization: ReturnType<typeof vi.fn>;
    incrementAttempt: ReturnType<typeof vi.fn>;
    markDelivered: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
  };
  let http: { post: ReturnType<typeof vi.fn> };
  let worker: WebhookDeliveryWorker;
  const endpoints = { findByOrganizationAndEvent: vi.fn() };

  beforeEach(() => {
    deliveries = {
      findByIdForOrganization: vi.fn().mockResolvedValue(delivery()),
      incrementAttempt: vi.fn(),
      markDelivered: vi.fn(),
      markFailed: vi.fn(),
    };
    endpoints.findByOrganizationAndEvent.mockReset();
    http = { post: vi.fn() };
    worker = new WebhookDeliveryWorker(
      deliveries as unknown as WebhookDeliveryRepository,
      http as unknown as WebhookHttpPoster,
      {
        WEBHOOK_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
        WEBHOOK_WORKER_MAX_ATTEMPTS: 3,
        WEBHOOK_DELIVERY_TIMEOUT_MS: 1000,
      } as Env,
    );
  });

  function job(attemptsMade = 0) {
    return {
      data: { deliveryId, organizationId, traceId: 't1' },
      id: `webhook-delivery.${deliveryId}`,
      opts: { attempts: 3 },
      attemptsMade,
    } as never;
  }

  it('POSTs the stored payload signed with the delivery snapshot secret', async () => {
    http.post.mockImplementation(async (input) => {
      expect(input.url).toBe('https://hooks-a.example.com/ready');
      expect(input.body).toBe(serializeWebhookPayload(delivery().payload));
      expect(input.headers['Content-Type']).toBe('application/json');
      expect(input.headers['OpenImport-Idempotency-Key']).toBe(deliveryId);
      const verifiedA = verifyWebhookSignature({
        secret: SECRET_A,
        timestampHeader: input.headers['OpenImport-Timestamp'],
        signatureHeader: input.headers['OpenImport-Signature'],
        rawBody: input.body,
      });
      const verifiedB = verifyWebhookSignature({
        secret: SECRET_B,
        timestampHeader: input.headers['OpenImport-Timestamp'],
        signatureHeader: input.headers['OpenImport-Signature'],
        rawBody: input.body,
      });
      expect(verifiedA).toEqual({ ok: true });
      expect(verifiedB.ok).toBe(false);
      return { status: 204 };
    });

    await worker.process(job());

    expect(deliveries.markDelivered).toHaveBeenCalledWith(
      organizationId,
      deliveryId,
    );
    expect(endpoints.findByOrganizationAndEvent).not.toHaveBeenCalled();
    expect(deliveries.markFailed).not.toHaveBeenCalled();
  });

  it('keeps signing with snapshot secret A after the live endpoint would have rotated to B', async () => {
    deliveries.findByIdForOrganization.mockResolvedValue(
      delivery({
        destinationUrl: 'https://hooks-a.example.com/ready',
        secretCiphertext: snapshotCiphertext(SECRET_A),
      }),
    );

    http.post.mockImplementation(async (input) => {
      expect(
        verifyWebhookSignature({
          secret: SECRET_A,
          timestampHeader: input.headers['OpenImport-Timestamp'],
          signatureHeader: input.headers['OpenImport-Signature'],
          rawBody: input.body,
        }),
      ).toEqual({ ok: true });
      expect(
        verifyWebhookSignature({
          secret: SECRET_B,
          timestampHeader: input.headers['OpenImport-Timestamp'],
          signatureHeader: input.headers['OpenImport-Signature'],
          rawBody: input.body,
        }).ok,
      ).toBe(false);
      return { status: 200 };
    });

    await worker.process(job());
    expect(endpoints.findByOrganizationAndEvent).not.toHaveBeenCalled();
  });

  it('fails the delivery when the historical snapshot secret cannot be decrypted', async () => {
    deliveries.findByIdForOrganization.mockResolvedValue(
      delivery({ secretCiphertext: 'not-a-valid-ciphertext' }),
    );

    await expect(worker.process(job())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(http.post).not.toHaveBeenCalled();
    expect(deliveries.markFailed).toHaveBeenCalledWith(
      organizationId,
      deliveryId,
      'secret_undecryptable',
    );
  });

  it('retries on 503 without failing the delivery until the last attempt', async () => {
    http.post.mockResolvedValue({ status: 503 });

    await expect(worker.process(job(0))).rejects.toThrow(/http_503/);
    expect(deliveries.markFailed).not.toHaveBeenCalled();
    expect(deliveries.markDelivered).not.toHaveBeenCalled();

    await expect(worker.process(job(2))).rejects.toThrow(/http_503/);
    expect(deliveries.markFailed).toHaveBeenCalledWith(
      organizationId,
      deliveryId,
      'http_503',
    );
  });

  it('marks failed and does not retry on 400', async () => {
    http.post.mockResolvedValue({ status: 400 });

    await expect(worker.process(job(0))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(deliveries.markFailed).toHaveBeenCalledWith(
      organizationId,
      deliveryId,
      'http_400',
    );
  });

  it('marks failed and does not retry on 301', async () => {
    http.post.mockResolvedValue({ status: 301 });

    await expect(worker.process(job(0))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(deliveries.markFailed).toHaveBeenCalledWith(
      organizationId,
      deliveryId,
      'http_301',
    );
  });

  it('marks failed with unsafe_url when DNS/private rebinding is detected', async () => {
    http.post.mockRejectedValue(new UnsafeWebhookUrlError());

    await expect(worker.process(job(0))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(deliveries.markFailed).toHaveBeenCalledWith(
      organizationId,
      deliveryId,
      'unsafe_url',
    );
  });

  it('does not POST when the delivery is already terminal', async () => {
    deliveries.findByIdForOrganization.mockResolvedValue(
      delivery({ status: 'delivered' }),
    );

    await worker.process(job());

    expect(http.post).not.toHaveBeenCalled();
    expect(deliveries.incrementAttempt).not.toHaveBeenCalled();
  });
});
