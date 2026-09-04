import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue, UnrecoverableError, Worker, Job } from 'bullmq';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import {
  configureHttpApp,
  registerNotFoundFallback,
} from '../src/configure-http.js';
import { env } from '../src/core/config/env.singleton.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { ImportRepository } from '../src/modules/import/import.repository.js';
import { IMPORT_PROCESSING_QUEUE } from '../src/modules/import/processing/import-processing.queue.js';
import { ImportProcessingReconciler } from '../src/modules/import/processing/import-processing.reconciler.js';
import { ImportProcessingWorker } from '../src/modules/import/processing/import-processing.worker.js';
import {
  createTenant,
  productTemplatePayload,
  type TestTenant,
} from './helpers/tenant.factory.js';

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Import confirmation and processing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
  });

  beforeEach(async () => {
    const queue = app.get<Queue>(getQueueToken(IMPORT_PROCESSING_QUEUE));
    try {
      await queue.resume();
    } catch {
      // already resumed
    }
    try {
      await app.get(ImportProcessingWorker).worker.resume();
    } catch {
      // already resumed
    }
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

    const queue = app.get<Queue>(getQueueToken(IMPORT_PROCESSING_QUEUE));
    try {
      await queue.resume();
    } catch {
      // already resumed
    }
    try {
      await app.get(ImportProcessingWorker).worker.resume();
    } catch {
      // already resumed
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

  async function createTemplate(
    apiKey: string,
    name = `products-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...productTemplatePayload, name })
      .expect(201);
    return response.body.id as string;
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
        Delete: {
          Objects: keys.map((Key) => ({ Key })),
        },
      }),
    );
  }

  async function prepareConfirmableImport(
    apiKey: string,
    idempotencyKey: string,
    csv = 'sku,name,price\nA1,Widget,"R$ 10,00"\nA2,Broken,not-a-price\n',
  ): Promise<{
    importId: string;
    revision: number;
    contentSha256: string;
    csv: string;
  }> {
    const templateId = await createTemplate(apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ templateId })
      .expect(201);

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
      csv,
    };
  }

  async function waitForReady(
    apiKey: string,
    importId: string,
    timeoutMs = 15_000,
  ): Promise<Record<string, unknown>> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
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

  it('confirms quickly to queued, processes to ready, persists rows, and paginates rejects', async () => {
    const tenant = await trackTenant();
    const prepared = await prepareConfirmableImport(
      tenant.apiKey,
      'confirm-happy-001',
    );

    const started = Date.now();
    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/confirm`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedMappingRevision: prepared.revision,
        expectedContentSha256: prepared.contentSha256,
      })
      .expect(202);
    expect(Date.now() - started).toBeLessThan(2_000);

    expect(confirmed.body).toMatchObject({
      importId: prepared.importId,
      status: 'queued',
      replayed: false,
      expectedMappingRevision: prepared.revision,
      expectedContentSha256: prepared.contentSha256,
      failure: null,
    });
    expect(confirmed.body.executionId).toEqual(expect.any(String));

    const ready = await waitForReady(tenant.apiKey, prepared.importId);
    expect(ready.status).toBe('ready');
    expect(ready.progress).toMatchObject({
      processedRows: 2,
      totalRows: 2,
      validRows: 1,
      invalidRows: 1,
    });

    const valid = await prisma.importRecord.findMany({
      where: {
        organizationId: tenant.organizationId,
        importSessionId: prepared.importId,
        classification: 'valid',
      },
    });
    expect(valid).toHaveLength(1);
    expect(valid[0]?.payload).toMatchObject({
      sku: 'A1',
      priceInCents: 1000,
    });

    const rejected = await request(app.getHttpServer())
      .get(`/api/v1/imports/${prepared.importId}/rejected-rows?limit=1`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);

    expect(rejected.body.data).toHaveLength(1);
    expect(rejected.body.data[0]).toMatchObject({
      recordNumber: 2,
    });
    expect(rejected.body.data[0]).not.toHaveProperty('payload');
    expect(rejected.body.nextCursor).toBeNull();

    const replay = await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/confirm`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedMappingRevision: prepared.revision,
        expectedContentSha256: prepared.contentSha256,
      })
      .expect(202);

    expect(replay.body.executionId).toBe(confirmed.body.executionId);
    expect(replay.body.replayed).toBe(true);

    const count = await prisma.importRecord.count({
      where: {
        organizationId: tenant.organizationId,
        importSessionId: prepared.importId,
      },
    });
    expect(count).toBe(2);
  });

  it('creates a single execution under concurrent confirmation', async () => {
    const tenant = await trackTenant();
    const prepared = await prepareConfirmableImport(
      tenant.apiKey,
      'confirm-concurrent-001',
    );

    const payload = {
      expectedMappingRevision: prepared.revision,
      expectedContentSha256: prepared.contentSha256,
    };

    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/imports/${prepared.importId}/confirm`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send(payload),
      request(app.getHttpServer())
        .post(`/api/v1/imports/${prepared.importId}/confirm`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send(payload),
    ]);

    expect([a.status, b.status].every((status) => status === 202)).toBe(true);
    expect(a.body.executionId).toBe(b.body.executionId);

    const executions = await prisma.importExecution.count({
      where: {
        organizationId: tenant.organizationId,
        importSessionId: prepared.importId,
      },
    });
    expect(executions).toBe(1);

    await waitForReady(tenant.apiKey, prepared.importId);
  });

  it('locks mapping after confirmation', async () => {
    const tenant = await trackTenant();
    const prepared = await prepareConfirmableImport(
      tenant.apiKey,
      'confirm-lock-mapping-001',
    );

    await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/confirm`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedMappingRevision: prepared.revision,
        expectedContentSha256: prepared.contentSha256,
      })
      .expect(202);

    const locked = await request(app.getHttpServer())
      .put(`/api/v1/imports/${prepared.importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedRevision: prepared.revision,
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      })
      .expect(409);

    expect(locked.body.code).toBe('IMPORT.MAPPING_NOT_ALLOWED');
    await waitForReady(tenant.apiKey, prepared.importId);
  });

  it('hides foreign tenant and foreign import token', async () => {
    const tenantA = await trackTenant();
    const tenantB = await trackTenant();
    const prepared = await prepareConfirmableImport(
      tenantA.apiKey,
      'confirm-tenant-001',
    );

    const tokenA = await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/access-tokens`)
      .set('Authorization', `Bearer ${tenantA.apiKey}`)
      .send({})
      .expect(201);

    const otherSession = await prepareConfirmableImport(
      tenantA.apiKey,
      'confirm-tenant-other-001',
    );
    const tokenOther = await request(app.getHttpServer())
      .post(`/api/v1/imports/${otherSession.importId}/access-tokens`)
      .set('Authorization', `Bearer ${tenantA.apiKey}`)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/confirm`)
      .set('Authorization', `Bearer ${tenantB.apiKey}`)
      .send({
        expectedMappingRevision: prepared.revision,
        expectedContentSha256: prepared.contentSha256,
      })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/confirm`)
      .set('Authorization', `Bearer ${tokenOther.body.accessToken}`)
      .send({
        expectedMappingRevision: prepared.revision,
        expectedContentSha256: prepared.contentSha256,
      })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/confirm`)
      .set('Authorization', `Bearer ${tokenA.body.accessToken}`)
      .send({
        expectedMappingRevision: prepared.revision,
        expectedContentSha256: prepared.contentSha256,
      })
      .expect(202);

    await waitForReady(tenantA.apiKey, prepared.importId);
  });

  it('rejects confirm with a divergent hash without creating a ready snapshot', async () => {
    const tenant = await trackTenant();
    const prepared = await prepareConfirmableImport(
      tenant.apiKey,
      'confirm-hash-001',
    );

    const response = await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/confirm`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedMappingRevision: prepared.revision,
        expectedContentSha256: 'a'.repeat(64),
      })
      .expect(409);

    expect(response.body.code).toBe('IMPORT.FILE_CHANGED');

    const session = await prisma.importSession.findFirstOrThrow({
      where: { id: prepared.importId },
    });
    expect(session.status).toBe('uploaded');

    const records = await prisma.importRecord.count({
      where: { importSessionId: prepared.importId },
    });
    expect(records).toBe(0);
  });

  it('marks processing_failed when the stored object is missing', async () => {
    const tenant = await trackTenant();
    const prepared = await prepareConfirmableImport(
      tenant.apiKey,
      'confirm-missing-object-001',
    );

    await deleteObjectsWithPrefix(`org/${tenant.organizationId}/`);

    await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/confirm`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedMappingRevision: prepared.revision,
        expectedContentSha256: prepared.contentSha256,
      })
      .expect(202);

    const final = await waitForReady(tenant.apiKey, prepared.importId, 20_000);
    expect(final.status).toBe('processing_failed');
    expect(final.failure).toEqual({
      code: 'IMPORT.PROCESSING_FAILED',
      message: expect.any(String),
    });
    expect(JSON.stringify(final.failure)).not.toMatch(/redis|minio|s3|secret/i);

    const context = await request(app.getHttpServer())
      .get(`/api/v1/imports/${prepared.importId}/context`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(context.body.import.failure).toEqual(final.failure);

    const replay = await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/confirm`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedMappingRevision: prepared.revision,
        expectedContentSha256: prepared.contentSha256,
      })
      .expect(202);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.failure).toEqual(final.failure);

    expect(
      await prisma.importRecord.count({
        where: { importSessionId: prepared.importId },
      }),
    ).toBe(0);

    await request(app.getHttpServer())
      .get(`/api/v1/imports/${prepared.importId}/rejected-rows`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(409)
      .expect((res) => {
        expect(res.body.code).toBe('IMPORT.SNAPSHOT_NOT_READY');
      });
  });

  it('discards partial records when a late batch failure exhausts retries', async () => {
    const tenant = await trackTenant();
    const prepared = await prepareConfirmableImport(
      tenant.apiKey,
      'confirm-late-batch-001',
      'sku,name,price\nA1,Widget,"R$ 10,00"\nA2,Gadget,"R$ 20,00"\nA3,Thing,"R$ 30,00"\n',
    );

    const repo = app.get(ImportRepository);
    const original = repo.upsertRecordBatch.bind(repo);
    let calls = 0;
    const spy = vi
      .spyOn(repo, 'upsertRecordBatch')
      .mockImplementation(async (...args) => {
        calls += 1;
        await original(...args);
        throw new Error('injected late persistence failure');
      });

    try {
      await request(app.getHttpServer())
        .post(`/api/v1/imports/${prepared.importId}/confirm`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          expectedMappingRevision: prepared.revision,
          expectedContentSha256: prepared.contentSha256,
        })
        .expect(202);

      const final = await waitForReady(tenant.apiKey, prepared.importId, 20_000);
      expect(final.status).toBe('processing_failed');
      expect(calls).toBeGreaterThanOrEqual(1);
      expect(
        await prisma.importRecord.count({
          where: { importSessionId: prepared.importId },
        }),
      ).toBe(0);
      expect(final.failure).toMatchObject({
        code: 'IMPORT.PROCESSING_FAILED',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('reconciles a queued execution that lost its BullMQ job', async () => {
    const tenant = await trackTenant();
    const prepared = await prepareConfirmableImport(
      tenant.apiKey,
      'confirm-reconcile-001',
    );

    const queue = app.get<Queue>(getQueueToken(IMPORT_PROCESSING_QUEUE));
    await queue.pause();

    try {
      const confirmed = await request(app.getHttpServer())
        .post(`/api/v1/imports/${prepared.importId}/confirm`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          expectedMappingRevision: prepared.revision,
          expectedContentSha256: prepared.contentSha256,
        })
        .expect(202);

      const execution = await prisma.importExecution.findFirstOrThrow({
        where: { id: confirmed.body.executionId as string },
      });
      const job = await queue.getJob(execution.jobId);
      expect(job).toBeTruthy();
      await job!.remove();
      expect(await queue.getJob(execution.jobId)).toBeFalsy();

      const reconciler = app.get(ImportProcessingReconciler);
      reconciler.resetCursor();
      await reconciler.reconcileOnce();
      expect(await queue.getJob(execution.jobId)).toBeTruthy();

      await queue.resume();
      const ready = await waitForReady(tenant.apiKey, prepared.importId);
      expect(ready.status).toBe('ready');

      expect(
        await prisma.importExecution.count({
          where: { importSessionId: prepared.importId },
        }),
      ).toBe(1);
    } finally {
      await queue.resume().catch(() => undefined);
    }
  });

  it('ready vs failed race ends in exactly one coherent terminal pair', async () => {
    const tenant = await trackTenant();
    const prepared = await prepareConfirmableImport(
      tenant.apiKey,
      'confirm-race-ready-fail-001',
      'sku,name,price\nA1,Widget,"R$ 10,00"\nA2,Gadget,"R$ 20,00"\n',
    );

    const queue = app.get<Queue>(getQueueToken(IMPORT_PROCESSING_QUEUE));
    await queue.pause();

    try {
      const confirmed = await request(app.getHttpServer())
        .post(`/api/v1/imports/${prepared.importId}/confirm`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          expectedMappingRevision: prepared.revision,
          expectedContentSha256: prepared.contentSha256,
        })
        .expect(202);

      const executionId = confirmed.body.executionId as string;
      await prisma.importExecution.update({
        where: { id: executionId },
        data: { status: 'processing', startedAt: new Date() },
      });
      await prisma.importSession.update({
        where: { id: prepared.importId },
        data: { status: 'processing' },
      });

      await prisma.importRecord.createMany({
        data: [
          {
            organizationId: tenant.organizationId,
            importSessionId: prepared.importId,
            executionId,
            recordNumber: 1,
            classification: 'valid',
            payload: { sku: 'A1', priceInCents: 1000 },
            errors: undefined,
          },
          {
            organizationId: tenant.organizationId,
            importSessionId: prepared.importId,
            executionId,
            recordNumber: 2,
            classification: 'valid',
            payload: { sku: 'A2', priceInCents: 2000 },
            errors: undefined,
          },
        ],
      });

      const repo = app.get(ImportRepository);
      const outcomes = await Promise.allSettled([
        repo.markExecutionReady(
          tenant.organizationId,
          executionId,
          prepared.importId,
          {
            processedRows: 2,
            validRows: 2,
            invalidRows: 0,
            totalRows: 2,
          },
        ),
        repo.failExecutionAndDiscardRecords(
          tenant.organizationId,
          executionId,
          prepared.importId,
          {
            code: 'IMPORT.PROCESSING_FAILED',
            message: 'Injected race failure.',
          },
        ),
      ]);

      expect(outcomes.every((item) => item.status === 'fulfilled')).toBe(true);

      const execution = await prisma.importExecution.findFirstOrThrow({
        where: { id: executionId },
      });
      const session = await prisma.importSession.findFirstOrThrow({
        where: { id: prepared.importId },
      });
      const recordCount = await prisma.importRecord.count({
        where: { executionId },
      });

      if (execution.status === 'ready') {
        expect(session.status).toBe('ready');
        expect(recordCount).toBe(2);
      } else {
        expect(execution.status).toBe('failed');
        expect(session.status).toBe('processing_failed');
        expect(recordCount).toBe(0);
      }
    } finally {
      await queue.resume().catch(() => undefined);
    }
  });

  it(
    'republishes when BullMQ job is failed while execution stays processing',
    async () => {
      const tenant = await trackTenant();
      const prepared = await prepareConfirmableImport(
        tenant.apiKey,
        'confirm-reconcile-failed-job-001',
      );

      const nestWorker = app.get(ImportProcessingWorker).worker;
      await nestWorker.pause();

      let tempWorker: Worker | null = null;

      try {
        const confirmed = await request(app.getHttpServer())
          .post(`/api/v1/imports/${prepared.importId}/confirm`)
          .set('Authorization', `Bearer ${tenant.apiKey}`)
          .send({
            expectedMappingRevision: prepared.revision,
            expectedContentSha256: prepared.contentSha256,
          })
          .expect(202);

        const execution = await prisma.importExecution.findFirstOrThrow({
          where: { id: confirmed.body.executionId as string },
        });

        tempWorker = new Worker(
          IMPORT_PROCESSING_QUEUE,
          async (): Promise<void> => {
            throw new UnrecoverableError('synthetic terminal job failure');
          },
          {
            connection: { url: env.REDIS_URL },
            concurrency: 1,
          },
        );

        const queue = app.get<Queue>(getQueueToken(IMPORT_PROCESSING_QUEUE));
        const started = Date.now();
        let state = 'unknown';
        while (Date.now() - started < 15_000) {
          const job = await queue.getJob(execution.jobId);
          state = job ? await job.getState() : 'missing';
          if (state === 'failed') {
            break;
          }
          await sleep(50);
        }
        expect(state).toBe('failed');

        await prisma.importExecution.update({
          where: { id: execution.id },
          data: { status: 'processing', startedAt: new Date() },
        });
        await prisma.importSession.update({
          where: { id: prepared.importId },
          data: { status: 'processing' },
        });

        await tempWorker.close();
        tempWorker = null;

        const reconciler = app.get(ImportProcessingReconciler);
        reconciler.resetCursor();
        await reconciler.reconcileOnce();

        const recovered = await queue.getJob(execution.jobId);
        expect(recovered).toBeTruthy();
        const recoveredState = await recovered!.getState();
        expect(['waiting', 'delayed', 'active', 'prioritized']).toContain(
          recoveredState,
        );

        expect(
          await prisma.importExecution.count({
            where: { importSessionId: prepared.importId },
          }),
        ).toBe(1);

        await nestWorker.resume();
        const ready = await waitForReady(tenant.apiKey, prepared.importId);
        expect(ready.status).toBe('ready');
      } finally {
        if (tempWorker) {
          await tempWorker.close().catch(() => undefined);
        }
        try {
          await nestWorker.resume();
        } catch {
          // already running
        }
      }
    },
    30_000,
  );

  it(
    'returns 503 when a terminal job cannot be cleared, then recovers on a later cycle',
    async () => {
      const tenant = await trackTenant();
      const prepared = await prepareConfirmableImport(
        tenant.apiKey,
        'confirm-terminal-remove-fail-001',
      );

      const nestWorker = app.get(ImportProcessingWorker).worker;
      await nestWorker.pause();

      let tempWorker: Worker | null = null;
      let removeSpy: ReturnType<typeof vi.spyOn> | null = null;

      try {
        const confirmed = await request(app.getHttpServer())
          .post(`/api/v1/imports/${prepared.importId}/confirm`)
          .set('Authorization', `Bearer ${tenant.apiKey}`)
          .send({
            expectedMappingRevision: prepared.revision,
            expectedContentSha256: prepared.contentSha256,
          })
          .expect(202);

        const execution = await prisma.importExecution.findFirstOrThrow({
          where: { id: confirmed.body.executionId as string },
        });

        tempWorker = new Worker(
          IMPORT_PROCESSING_QUEUE,
          async (): Promise<void> => {
            throw new UnrecoverableError('synthetic terminal job failure');
          },
          {
            connection: { url: env.REDIS_URL },
            concurrency: 1,
          },
        );

        const queue = app.get<Queue>(getQueueToken(IMPORT_PROCESSING_QUEUE));
        const started = Date.now();
        let state = 'unknown';
        while (Date.now() - started < 15_000) {
          const job = await queue.getJob(execution.jobId);
          state = job ? await job.getState() : 'missing';
          if (state === 'failed') {
            break;
          }
          await sleep(50);
        }
        expect(state).toBe('failed');

        await prisma.importExecution.update({
          where: { id: execution.id },
          data: { status: 'processing', startedAt: new Date() },
        });
        await prisma.importSession.update({
          where: { id: prepared.importId },
          data: { status: 'processing' },
        });

        await tempWorker.close();
        tempWorker = null;

        removeSpy = vi
          .spyOn(Job.prototype, 'remove')
          .mockRejectedValue(new Error('synthetic remove failure'));

        await request(app.getHttpServer())
          .post(`/api/v1/imports/${prepared.importId}/confirm`)
          .set('Authorization', `Bearer ${tenant.apiKey}`)
          .send({
            expectedMappingRevision: prepared.revision,
            expectedContentSha256: prepared.contentSha256,
          })
          .expect(503)
          .expect((res) => {
            expect(res.body.code).toBe('IMPORT.PROCESSING_UNAVAILABLE');
          });

        const reconciler = app.get(ImportProcessingReconciler);
        reconciler.resetCursor();
        await reconciler.reconcileOnce();
        expect(await (await queue.getJob(execution.jobId))!.getState()).toBe(
          'failed',
        );

        removeSpy.mockRestore();
        removeSpy = null;

        await reconciler.reconcileOnce();
        const recovered = await queue.getJob(execution.jobId);
        expect(recovered).toBeTruthy();
        expect(['waiting', 'delayed', 'active', 'prioritized']).toContain(
          await recovered!.getState(),
        );

        expect(
          await prisma.importExecution.count({
            where: { importSessionId: prepared.importId },
          }),
        ).toBe(1);

        await nestWorker.resume();
        const ready = await waitForReady(tenant.apiKey, prepared.importId);
        expect(ready.status).toBe('ready');
      } finally {
        removeSpy?.mockRestore();
        if (tempWorker) {
          await tempWorker.close().catch(() => undefined);
        }
        try {
          await nestWorker.resume();
        } catch {
          // already running
        }
      }
    },
    30_000,
  );

  it(
    'returns 503 on persistent unknown job state, then recovers after the job is gone',
    async () => {
      const tenant = await trackTenant();
      const prepared = await prepareConfirmableImport(
        tenant.apiKey,
        'confirm-unknown-job-001',
      );

      const nestWorker = app.get(ImportProcessingWorker).worker;
      await nestWorker.pause();

      let getStateSpy: ReturnType<typeof vi.spyOn> | null = null;

      try {
        const confirmed = await request(app.getHttpServer())
          .post(`/api/v1/imports/${prepared.importId}/confirm`)
          .set('Authorization', `Bearer ${tenant.apiKey}`)
          .send({
            expectedMappingRevision: prepared.revision,
            expectedContentSha256: prepared.contentSha256,
          })
          .expect(202);

        const execution = await prisma.importExecution.findFirstOrThrow({
          where: { id: confirmed.body.executionId as string },
        });

        await prisma.importExecution.update({
          where: { id: execution.id },
          data: { status: 'processing', startedAt: new Date() },
        });
        await prisma.importSession.update({
          where: { id: prepared.importId },
          data: { status: 'processing' },
        });

        const queue = app.get<Queue>(getQueueToken(IMPORT_PROCESSING_QUEUE));
        expect(await queue.getJob(execution.jobId)).toBeTruthy();

        getStateSpy = vi
          .spyOn(Job.prototype, 'getState')
          .mockResolvedValue('unknown');

        await request(app.getHttpServer())
          .post(`/api/v1/imports/${prepared.importId}/confirm`)
          .set('Authorization', `Bearer ${tenant.apiKey}`)
          .send({
            expectedMappingRevision: prepared.revision,
            expectedContentSha256: prepared.contentSha256,
          })
          .expect(503)
          .expect((res) => {
            expect(res.body.code).toBe('IMPORT.PROCESSING_UNAVAILABLE');
          });

        const reconciler = app.get(ImportProcessingReconciler);
        reconciler.resetCursor();
        await reconciler.reconcileOnce();

        getStateSpy.mockRestore();
        getStateSpy = null;

        const lingering = await queue.getJob(execution.jobId);
        expect(lingering).toBeTruthy();
        await lingering!.remove();
        expect(await queue.getJob(execution.jobId)).toBeFalsy();

        await reconciler.reconcileOnce();
        const recovered = await queue.getJob(execution.jobId);
        expect(recovered).toBeTruthy();
        expect(['waiting', 'delayed', 'active', 'prioritized']).toContain(
          await recovered!.getState(),
        );

        expect(
          await prisma.importExecution.count({
            where: { importSessionId: prepared.importId },
          }),
        ).toBe(1);

        await nestWorker.resume();
        const ready = await waitForReady(tenant.apiKey, prepared.importId);
        expect(ready.status).toBe('ready');
      } finally {
        getStateSpy?.mockRestore();
        try {
          await nestWorker.resume();
        } catch {
          // already running
        }
      }
    },
    30_000,
  );

  it(
    'reconciler pages past a full healthy batch to reach a later orphan',
    async () => {
      const tenant = await trackTenant();
      const queue = app.get<Queue>(getQueueToken(IMPORT_PROCESSING_QUEUE));
      await queue.pause();

      const reconciler = app.get(ImportProcessingReconciler);
      reconciler.resetCursor();

      // E2E batch size is 10 — create 11 queued executions and orphan the last.
      const total = env.IMPORT_JOB_RECONCILE_BATCH_SIZE + 1;

      try {
        const prepared: Array<{ importId: string; jobId: string }> = [];
        for (let i = 0; i < total; i += 1) {
          const item = await prepareConfirmableImport(
            tenant.apiKey,
            `confirm-reconcile-page-${i}-${Date.now()}-${i}`,
          );
          const confirmed = await request(app.getHttpServer())
            .post(`/api/v1/imports/${item.importId}/confirm`)
            .set('Authorization', `Bearer ${tenant.apiKey}`)
            .send({
              expectedMappingRevision: item.revision,
              expectedContentSha256: item.contentSha256,
            })
            .expect(202);
          const execution = await prisma.importExecution.findFirstOrThrow({
            where: { id: confirmed.body.executionId as string },
          });
          prepared.push({ importId: item.importId, jobId: execution.jobId });
        }

        const orphan = prepared[prepared.length - 1]!;
        const orphanJob = await queue.getJob(orphan.jobId);
        expect(orphanJob).toBeTruthy();
        await orphanJob!.remove();
        expect(await queue.getJob(orphan.jobId)).toBeFalsy();

        await reconciler.reconcileOnce();
        expect(await queue.getJob(orphan.jobId)).toBeTruthy();
      } finally {
        try {
          await queue.resume();
        } catch {
          // already resumed
        }
      }
    },
    60_000,
  );

  it('documents confirm and rejected-rows in OpenAPI', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    expect(
      response.body.paths['/api/v1/imports/{importId}/confirm'],
    ).toBeDefined();
    expect(
      response.body.paths['/api/v1/imports/{importId}/rejected-rows'],
    ).toBeDefined();
    expect(
      response.body.paths['/api/v1/imports/{importId}/valid-rows'],
    ).toBeDefined();
    expect(
      response.body.paths['/api/v1/imports/{importId}/valid-rows'].get.security,
    ).toEqual([{ 'api-key': [] }]);
    expect(
      response.body.components.schemas.ValidRowDto.properties.data
        .additionalProperties,
    ).toEqual({
      oneOf: [{ type: 'string' }, { type: 'number' }],
    });
    const spec = JSON.stringify(response.body);
    expect(spec).toContain('IMPORT.CONFIRMATION_NOT_ALLOWED');
    expect(spec).toContain('IMPORT.PROCESSING_UNAVAILABLE');
    expect(spec).toContain('IMPORT.SNAPSHOT_NOT_READY');
    expect(spec).toContain('queued');
    expect(spec).toContain('processing_failed');
    expect(spec).toContain('failure');
    expect(spec).toContain('IMPORT.PROCESSING_FAILED');
  });

  it('paginates valid rows for the client backend with API key only', async () => {
    const tenant = await trackTenant();
    const other = await trackTenant();
    const csv = [
      'sku,name,price',
      'V1,a,"R$ 10,00"',
      'BAD1,b,not-a-price',
      'V2,c,"R$ 20,00"',
      'V3,d,"R$ 30,00"',
      'BAD2,e,bad',
      'V4,f,"R$ 40,00"',
      'V5,g,"R$ 50,00"',
      '',
    ].join('\n');

    const prepared = await prepareConfirmableImport(
      tenant.apiKey,
      'valid-rows-paginate-001',
      csv,
    );

    const beforeReady = await request(app.getHttpServer())
      .get(`/api/v1/imports/${prepared.importId}/valid-rows?limit=2`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(409);
    expect(beforeReady.body.code).toBe('IMPORT.SNAPSHOT_NOT_READY');

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
    expect(ready.progress).toMatchObject({
      processedRows: 7,
      validRows: 5,
      invalidRows: 2,
    });

    const progressBefore = {
      ...(ready.progress as Record<string, unknown>),
    };
    const statusBefore = ready.status;
    const recordCountBefore = await prisma.importRecord.count({
      where: {
        organizationId: tenant.organizationId,
        importSessionId: prepared.importId,
      },
    });

    const page1 = await request(app.getHttpServer())
      .get(`/api/v1/imports/${prepared.importId}/valid-rows?limit=2`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(page1.headers['cache-control']).toBe('no-store');
    expect(page1.body.importId).toBe(prepared.importId);
    expect(page1.body.executionId).toBe(confirmed.body.executionId);
    expect(page1.body.data).toEqual([
      { recordNumber: 1, data: { sku: 'V1', priceInCents: 1000 } },
      { recordNumber: 3, data: { sku: 'V2', priceInCents: 2000 } },
    ]);
    expect(page1.body.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(page1.body)).not.toContain('organizationId');
    expect(JSON.stringify(page1.body)).not.toContain('storageObjectKey');
    expect(page1.body.data[0]).not.toHaveProperty('id');
    expect(page1.body.data[0]).not.toHaveProperty('errors');
    expect(page1.body.data[0]).not.toHaveProperty('payload');

    const page1Again = await request(app.getHttpServer())
      .get(`/api/v1/imports/${prepared.importId}/valid-rows?limit=2`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(page1Again.body).toEqual(page1.body);

    const page2 = await request(app.getHttpServer())
      .get(
        `/api/v1/imports/${prepared.importId}/valid-rows?limit=2&after=${encodeURIComponent(page1.body.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(page2.body.data).toEqual([
      { recordNumber: 4, data: { sku: 'V3', priceInCents: 3000 } },
      { recordNumber: 6, data: { sku: 'V4', priceInCents: 4000 } },
    ]);
    expect(page2.body.nextCursor).toEqual(expect.any(String));

    const page3 = await request(app.getHttpServer())
      .get(
        `/api/v1/imports/${prepared.importId}/valid-rows?limit=2&after=${encodeURIComponent(page2.body.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(page3.body.data).toEqual([
      { recordNumber: 7, data: { sku: 'V5', priceInCents: 5000 } },
    ]);
    expect(page3.body.nextCursor).toBeNull();

    const all = [...page1.body.data, ...page2.body.data, ...page3.body.data] as Array<{
      recordNumber: number;
      data: Record<string, unknown>;
    }>;
    expect(all.map((row) => row.recordNumber)).toEqual([1, 3, 4, 6, 7]);
    expect(new Set(all.map((row) => row.recordNumber)).size).toBe(5);

    const invalidCursor = await request(app.getHttpServer())
      .get(
        `/api/v1/imports/${prepared.importId}/valid-rows?limit=2&after=not-a-cursor`,
      )
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(400);
    expect(invalidCursor.body.code).toBe('VALIDATION.FAILED');

    const foreignCursor = Buffer.from(
      `v1:99999999-9999-9999-9999-999999999999:1`,
      'utf8',
    ).toString('base64url');
    const otherExecution = await request(app.getHttpServer())
      .get(
        `/api/v1/imports/${prepared.importId}/valid-rows?limit=2&after=${encodeURIComponent(foreignCursor)}`,
      )
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(400);
    expect(otherExecution.body.code).toBe('VALIDATION.FAILED');

    const otherTenant = await request(app.getHttpServer())
      .get(`/api/v1/imports/${prepared.importId}/valid-rows?limit=2`)
      .set('Authorization', `Bearer ${other.apiKey}`)
      .expect(404);
    expect(otherTenant.body.code).toBe('IMPORT.NOT_FOUND');

    const issued = await request(app.getHttpServer())
      .post(`/api/v1/imports/${prepared.importId}/access-tokens`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({})
      .expect(201);
    const forbidden = await request(app.getHttpServer())
      .get(`/api/v1/imports/${prepared.importId}/valid-rows?limit=2`)
      .set('Authorization', `Bearer ${issued.body.accessToken}`)
      .expect(403);
    expect(forbidden.body.code).toBe('AUTH.INSUFFICIENT_SCOPE');

    const after = await request(app.getHttpServer())
      .get(`/api/v1/imports/${prepared.importId}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(after.body.status).toBe(statusBefore);
    expect(after.body.progress).toEqual(progressBefore);
    const recordCountAfter = await prisma.importRecord.count({
      where: {
        organizationId: tenant.organizationId,
        importSessionId: prepared.importId,
      },
    });
    expect(recordCountAfter).toBe(recordCountBefore);
  });
});
