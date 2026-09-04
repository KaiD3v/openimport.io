import { createServer, type IncomingMessage, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  configureHttpApp,
  registerNotFoundFallback,
} from '../src/configure-http.js';
import { env } from '../src/core/config/env.singleton.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { IMPORT_READY_EVENT_TYPE } from '../src/modules/webhook/webhook.constants.js';
import { verifyWebhookSignature } from '../src/modules/webhook/crypto/webhook-signature.js';
import { WEBHOOK_DELIVERY_QUEUE } from '../src/modules/webhook/delivery/webhook-delivery.queue.js';
import {
  createTenant,
  productTemplatePayload,
  type TestTenant,
} from './helpers/tenant.factory.js';

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type ReceivedWebhook = {
  headers: IncomingMessage['headers'];
  rawBody: string;
};

function startReceiver(handler?: (req: IncomingMessage) => number): Promise<{
  url: string;
  received: ReceivedWebhook[];
  close: () => Promise<void>;
}> {
  const received: ReceivedWebhook[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      received.push({ headers: req.headers, rawBody });
      const status = handler ? handler(req) : 200;
      res.statusCode = status;
      res.end('{}');
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}/import-ready`,
        received,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
    server.on('error', reject);
  });
}

describe('Signed import.ready webhook (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let webhookQueue: Queue;
  const organizationIds: string[] = [];
  const s3 = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureHttpApp(app, env);
    await app.init();
    registerNotFoundFallback(app);
    prisma = app.get(PrismaService);
    webhookQueue = app.get<Queue>(getQueueToken(WEBHOOK_DELIVERY_QUEUE));
  });

  afterEach(async () => {
    if (organizationIds.length > 0) {
      for (const organizationId of organizationIds) {
        await deleteObjectsWithPrefix(`org/${organizationId}/`);
      }
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      organizationIds.length = 0;
    }
  });

  afterAll(async () => {
    await app.close();
    s3.destroy();
  });

  async function trackTenant(): Promise<TestTenant> {
    const tenant = await createTenant(prisma);
    organizationIds.push(tenant.organizationId);
    return tenant;
  }

  async function deleteObjectsWithPrefix(prefix: string): Promise<void> {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: prefix,
      }),
    );
    const keys = (listed.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => typeof key === 'string');
    if (keys.length === 0) {
      return;
    }
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: env.S3_BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }),
    );
  }

  async function prepareConfirmableImport(apiKey: string, idempotencyKey: string) {
    const template = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        ...productTemplatePayload,
        name: `products-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ templateId: template.body.id })
      .expect(201);

    const csv = 'sku,name,price\nA1,Widget,"R$ 10,00"\nA2,Broken,not-a-price\n';
    const uploaded = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${apiKey}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'products.csv')
      .expect(201);

    const mapped = await request(app.getHttpServer())
      .put(`/api/v1/imports/${created.body.id}/mapping`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        expectedRevision: 0,
        mappings: [
          { columnPosition: 0, fieldKey: 'sku' },
          { columnPosition: 2, fieldKey: 'priceInCents' },
        ],
      })
      .expect(200);

    return {
      importId: created.body.id as string,
      revision: mapped.body.revision as number,
      contentSha256: uploaded.body.contentSha256 as string,
    };
  }

  async function waitForReady(apiKey: string, importId: string): Promise<Record<string, unknown>> {
    const started = Date.now();
    while (Date.now() - started < 15_000) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/imports/${importId}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200);
      if (
        response.body.status === 'ready' ||
        response.body.status === 'processing_failed'
      ) {
        return response.body as Record<string, unknown>;
      }
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ready on ${importId}`);
  }

  async function waitForDeliveryStatus(
    organizationId: string,
    executionId: string,
    status: 'pending' | 'delivered' | 'failed',
  ) {
    const started = Date.now();
    while (Date.now() - started < 15_000) {
      const row = await prisma.webhookDelivery.findFirst({
        where: { organizationId, executionId },
      });
      if (row?.status === status) {
        return row;
      }
      await sleep(100);
    }
    throw new Error(`Timed out waiting for webhook delivery ${status}`);
  }

  it('delivers a signed import.ready payload to the registered HTTPS-equivalent local endpoint', async () => {
    const receiver = await startReceiver();
    const tenant = await trackTenant();
    try {
      const created = await request(app.getHttpServer())
        .put('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({ url: receiver.url })
        .expect(200);

      expect(created.body.secret).toMatch(/^oi_whsec_[0-9a-f]{64}$/);
      expect(created.body.eventType).toBe(IMPORT_READY_EVENT_TYPE);
      expect(JSON.stringify(created.body)).not.toContain('secretCiphertext');

      const listed = await request(app.getHttpServer())
        .get('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .expect(200);
      expect(listed.body.secret).toBeUndefined();
      expect(listed.body.secretPrefix).toBe(created.body.secretPrefix);
      expect(JSON.stringify(listed.body)).not.toContain(created.body.secret);

      const prepared = await prepareConfirmableImport(
        tenant.apiKey,
        'webhook-ready-happy-001',
      );
      const confirmed = await request(app.getHttpServer())
        .post(`/api/v1/imports/${prepared.importId}/confirm`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          expectedMappingRevision: prepared.revision,
          expectedContentSha256: prepared.contentSha256,
        })
        .expect(202);

      const ready = await waitForReady(tenant.apiKey, prepared.importId);
      expect(ready.status).toBe('ready');

      const started = Date.now();
      while (receiver.received.length === 0 && Date.now() - started < 15_000) {
        await sleep(50);
      }
      expect(receiver.received).toHaveLength(1);

      const event = receiver.received[0]!;
      const payload = JSON.parse(event.rawBody) as {
        id: string;
        type: string;
        data: {
          organizationId: string;
          importId: string;
          executionId: string;
          status: string;
          counts: Record<string, number>;
        };
      };
      expect(payload).toMatchObject({
        type: IMPORT_READY_EVENT_TYPE,
        data: {
          organizationId: tenant.organizationId,
          importId: prepared.importId,
          executionId: confirmed.body.executionId,
          status: 'ready',
          counts: {
            totalRows: 2,
            validRows: 1,
            invalidRows: 1,
            processedRows: 2,
          },
        },
      });
      expect(event.headers['openimport-idempotency-key']).toBe(payload.id);
      expect(
        verifyWebhookSignature({
          secret: created.body.secret,
          timestampHeader: String(event.headers['openimport-timestamp']),
          signatureHeader: String(event.headers['openimport-signature']),
          rawBody: event.rawBody,
        }),
      ).toEqual({ ok: true });

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { organizationId: tenant.organizationId },
      });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]?.status).toBe('delivered');
      expect(deliveries[0]?.id).toBe(payload.id);

      const poll = await request(app.getHttpServer())
        .get(`/api/v1/imports/${prepared.importId}`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .expect(200);
      expect(poll.body.status).toBe('ready');
    } finally {
      await receiver.close();
    }
  });

  it('keeps ready and writes zero deliveries when no endpoint is registered', async () => {
    const tenant = await trackTenant();
    const prepared = await prepareConfirmableImport(
      tenant.apiKey,
      'webhook-ready-none-001',
    );
    await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/confirm`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedMappingRevision: prepared.revision,
        expectedContentSha256: prepared.contentSha256,
      })
      .expect(202);

    const ready = await waitForReady(tenant.apiKey, prepared.importId);
    expect(ready.status).toBe('ready');
    expect(
      await prisma.webhookDelivery.count({
        where: { organizationId: tenant.organizationId },
      }),
    ).toBe(0);
  });

  it('marks the delivery failed after retries when the destination is down without leaving ready', async () => {
    const tenant = await trackTenant();
    await request(app.getHttpServer())
      .put('/api/v1/webhook-endpoints')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ url: 'http://127.0.0.1:1/import-ready' })
      .expect(200);

    const prepared = await prepareConfirmableImport(
      tenant.apiKey,
      'webhook-ready-down-001',
    );
    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/confirm`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedMappingRevision: prepared.revision,
        expectedContentSha256: prepared.contentSha256,
      })
      .expect(202);

    const ready = await waitForReady(tenant.apiKey, prepared.importId);
    expect(ready.status).toBe('ready');

    const failed = await waitForDeliveryStatus(
      tenant.organizationId,
      confirmed.body.executionId as string,
      'failed',
    );
    expect(failed.status).toBe('failed');

    const session = await request(app.getHttpServer())
      .get(`/api/v1/imports/${prepared.importId}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(session.body.status).toBe('ready');
  });

  it('rejects import access tokens on webhook endpoint registration', async () => {
    const tenant = await trackTenant();
    const prepared = await prepareConfirmableImport(
      tenant.apiKey,
      'webhook-ready-token-001',
    );
    const token = await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/access-tokens`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({})
      .expect(201);

    const forbidden = await request(app.getHttpServer())
      .put('/api/v1/webhook-endpoints')
      .set('Authorization', `Bearer ${token.body.accessToken}`)
      .send({ url: 'http://127.0.0.1:9/hook' })
      .expect(403);
    expect(forbidden.body.code).toBe('AUTH.INSUFFICIENT_SCOPE');
    expect(JSON.stringify(forbidden.body)).not.toContain(token.body.accessToken);
  });

  it('keeps a pending delivery on URL A with secret A after PUT rotates to B', async () => {
    const receiverA = await startReceiver();
    const receiverB = await startReceiver();
    const tenant = await trackTenant();
    await webhookQueue.pause();

    try {
      const createdA = await request(app.getHttpServer())
        .put('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({ url: receiverA.url })
        .expect(200);

      const prepared = await prepareConfirmableImport(
        tenant.apiKey,
        'webhook-ready-rotate-001',
      );
      const confirmed = await request(app.getHttpServer())
        .post(`/api/v1/imports/${prepared.importId}/confirm`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          expectedMappingRevision: prepared.revision,
          expectedContentSha256: prepared.contentSha256,
        })
        .expect(202);

      const ready = await waitForReady(tenant.apiKey, prepared.importId);
      expect(ready.status).toBe('ready');

      const pending = await waitForDeliveryStatus(
        tenant.organizationId,
        confirmed.body.executionId as string,
        'pending',
      );
      expect(pending.status).toBe('pending');
      expect(pending.destinationUrl).toBe(receiverA.url);

      const createdB = await request(app.getHttpServer())
        .put('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({ url: receiverB.url })
        .expect(200);
      expect(createdB.body.secret).not.toBe(createdA.body.secret);

      await webhookQueue.resume();

      const delivered = await waitForDeliveryStatus(
        tenant.organizationId,
        confirmed.body.executionId as string,
        'delivered',
      );
      expect(delivered.destinationUrl).toBe(receiverA.url);

      const started = Date.now();
      while (receiverA.received.length === 0 && Date.now() - started < 15_000) {
        await sleep(50);
      }
      expect(receiverA.received).toHaveLength(1);
      expect(receiverB.received).toHaveLength(0);

      const event = receiverA.received[0]!;
      expect(
        verifyWebhookSignature({
          secret: createdA.body.secret,
          timestampHeader: String(event.headers['openimport-timestamp']),
          signatureHeader: String(event.headers['openimport-signature']),
          rawBody: event.rawBody,
        }),
      ).toEqual({ ok: true });
      expect(
        verifyWebhookSignature({
          secret: createdB.body.secret,
          timestampHeader: String(event.headers['openimport-timestamp']),
          signatureHeader: String(event.headers['openimport-signature']),
          rawBody: event.rawBody,
        }).ok,
      ).toBe(false);

      const poll = await request(app.getHttpServer())
        .get(`/api/v1/imports/${prepared.importId}`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .expect(200);
      expect(poll.body.status).toBe('ready');
    } finally {
      await webhookQueue.resume();
      await receiverA.close();
      await receiverB.close();
    }
  });

  it('delivers a snapshot created before DELETE and creates zero later deliveries', async () => {
    const receiver = await startReceiver();
    const tenant = await trackTenant();
    await webhookQueue.pause();

    try {
      const created = await request(app.getHttpServer())
        .put('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({ url: receiver.url })
        .expect(200);

      const first = await prepareConfirmableImport(
        tenant.apiKey,
        'webhook-ready-delete-001',
      );
      const confirmed = await request(app.getHttpServer())
        .post(`/api/v1/imports/${first.importId}/confirm`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          expectedMappingRevision: first.revision,
          expectedContentSha256: first.contentSha256,
        })
        .expect(202);

      const ready = await waitForReady(tenant.apiKey, first.importId);
      expect(ready.status).toBe('ready');

      const pending = await prisma.webhookDelivery.findFirstOrThrow({
        where: {
          organizationId: tenant.organizationId,
          executionId: confirmed.body.executionId as string,
        },
      });
      expect(pending.status).toBe('pending');

      await request(app.getHttpServer())
        .delete('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .expect(200);

      await webhookQueue.resume();

      const delivered = await waitForDeliveryStatus(
        tenant.organizationId,
        confirmed.body.executionId as string,
        'delivered',
      );
      expect(delivered.status).toBe('delivered');
      expect(receiver.received).toHaveLength(1);
      expect(
        verifyWebhookSignature({
          secret: created.body.secret,
          timestampHeader: String(receiver.received[0]!.headers['openimport-timestamp']),
          signatureHeader: String(receiver.received[0]!.headers['openimport-signature']),
          rawBody: receiver.received[0]!.rawBody,
        }),
      ).toEqual({ ok: true });

      const second = await prepareConfirmableImport(
        tenant.apiKey,
        'webhook-ready-delete-002',
      );
      await request(app.getHttpServer())
        .post(`/api/v1/imports/${second.importId}/confirm`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          expectedMappingRevision: second.revision,
          expectedContentSha256: second.contentSha256,
        })
        .expect(202);

      const secondReady = await waitForReady(tenant.apiKey, second.importId);
      expect(secondReady.status).toBe('ready');
      expect(
        await prisma.webhookDelivery.count({
          where: { organizationId: tenant.organizationId },
        }),
      ).toBe(1);
    } finally {
      await webhookQueue.resume();
      await receiver.close();
    }
  });

  it('isolates signed deliveries between organizations', async () => {
    const receiverA = await startReceiver();
    const receiverB = await startReceiver();
    const tenantA = await trackTenant();
    const tenantB = await trackTenant();

    try {
      const createdA = await request(app.getHttpServer())
        .put('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${tenantA.apiKey}`)
        .send({ url: receiverA.url })
        .expect(200);
      const createdB = await request(app.getHttpServer())
        .put('/api/v1/webhook-endpoints')
        .set('Authorization', `Bearer ${tenantB.apiKey}`)
        .send({ url: receiverB.url })
        .expect(200);

      const preparedA = await prepareConfirmableImport(
        tenantA.apiKey,
        'webhook-ready-iso-a-001',
      );
      const preparedB = await prepareConfirmableImport(
        tenantB.apiKey,
        'webhook-ready-iso-b-001',
      );
      const confirmedA = await request(app.getHttpServer())
        .post(`/api/v1/imports/${preparedA.importId}/confirm`)
        .set('Authorization', `Bearer ${tenantA.apiKey}`)
        .send({
          expectedMappingRevision: preparedA.revision,
          expectedContentSha256: preparedA.contentSha256,
        })
        .expect(202);
      const confirmedB = await request(app.getHttpServer())
        .post(`/api/v1/imports/${preparedB.importId}/confirm`)
        .set('Authorization', `Bearer ${tenantB.apiKey}`)
        .send({
          expectedMappingRevision: preparedB.revision,
          expectedContentSha256: preparedB.contentSha256,
        })
        .expect(202);

      expect((await waitForReady(tenantA.apiKey, preparedA.importId)).status).toBe(
        'ready',
      );
      expect((await waitForReady(tenantB.apiKey, preparedB.importId)).status).toBe(
        'ready',
      );

      await waitForDeliveryStatus(
        tenantA.organizationId,
        confirmedA.body.executionId as string,
        'delivered',
      );
      await waitForDeliveryStatus(
        tenantB.organizationId,
        confirmedB.body.executionId as string,
        'delivered',
      );

      expect(receiverA.received).toHaveLength(1);
      expect(receiverB.received).toHaveLength(1);

      const payloadA = JSON.parse(receiverA.received[0]!.rawBody) as {
        data: { organizationId: string; importId: string };
      };
      const payloadB = JSON.parse(receiverB.received[0]!.rawBody) as {
        data: { organizationId: string; importId: string };
      };
      expect(payloadA.data.organizationId).toBe(tenantA.organizationId);
      expect(payloadA.data.importId).toBe(preparedA.importId);
      expect(payloadB.data.organizationId).toBe(tenantB.organizationId);
      expect(payloadB.data.importId).toBe(preparedB.importId);
      expect(receiverA.received[0]!.rawBody).not.toContain(tenantB.organizationId);
      expect(receiverB.received[0]!.rawBody).not.toContain(tenantA.organizationId);

      expect(
        verifyWebhookSignature({
          secret: createdA.body.secret,
          timestampHeader: String(
            receiverA.received[0]!.headers['openimport-timestamp'],
          ),
          signatureHeader: String(
            receiverA.received[0]!.headers['openimport-signature'],
          ),
          rawBody: receiverA.received[0]!.rawBody,
        }),
      ).toEqual({ ok: true });
      expect(
        verifyWebhookSignature({
          secret: createdB.body.secret,
          timestampHeader: String(
            receiverB.received[0]!.headers['openimport-timestamp'],
          ),
          signatureHeader: String(
            receiverB.received[0]!.headers['openimport-signature'],
          ),
          rawBody: receiverB.received[0]!.rawBody,
        }),
      ).toEqual({ ok: true });
      expect(
        verifyWebhookSignature({
          secret: createdA.body.secret,
          timestampHeader: String(
            receiverB.received[0]!.headers['openimport-timestamp'],
          ),
          signatureHeader: String(
            receiverB.received[0]!.headers['openimport-signature'],
          ),
          rawBody: receiverB.received[0]!.rawBody,
        }).ok,
      ).toBe(false);
    } finally {
      await receiverA.close();
      await receiverB.close();
    }
  });
});
