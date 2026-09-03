import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import {
  configureHttpApp,
  registerNotFoundFallback,
} from '../src/configure-http.js';
import { env } from '../src/core/config/env.singleton.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../src/integrations/object-storage/object-storage.port.js';
import {
  createTenant,
  productTemplatePayload,
  type TestTenant,
} from './helpers/tenant.factory.js';

function fragmentIntoSingleByteChunks(source: Readable): Readable {
  return Readable.from(
    (async function* () {
      for await (const chunk of source) {
        const buffer = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as string);
        for (let i = 0; i < buffer.length; i += 1) {
          yield Buffer.from([buffer[i]!]);
        }
      }
    })(),
  );
}

/** Split after the CR of the first data record so CRLF spans two chunks. */
function fragmentCrLfAfterFirstDataRecord(source: Readable): Readable {
  return Readable.from(
    (async function* () {
      const parts: Buffer[] = [];
      for await (const chunk of source) {
        parts.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string),
        );
      }
      const all = Buffer.concat(parts);
      const anchor = all.indexOf(Buffer.from('A\r\n', 'utf8'));
      if (anchor < 0) {
        yield all;
        return;
      }
      const splitAt = anchor + 2; // after 'A\r', before '\n'
      yield all.subarray(0, splitAt);
      // Keep the second chunk distinct through the hasher (no sync coalesce).
      await Promise.resolve();
      yield all.subarray(splitAt);
    })(),
  );
}

/** Splits the stream into two chunks at an exact byte offset. */
function fragmentAtByteOffset(source: Readable, offset: number): Readable {
  return Readable.from(
    (async function* () {
      const parts: Buffer[] = [];
      for await (const chunk of source) {
        parts.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string),
        );
      }
      const all = Buffer.concat(parts);
      yield all.subarray(0, offset);
      // Keep the second chunk distinct through the hasher (no sync coalesce).
      await Promise.resolve();
      yield all.subarray(offset);
    })(),
  );
}

describe('Import sessions (e2e)', () => {
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

  async function trackTenant(
    options?: Parameters<typeof createTenant>[1],
  ): Promise<TestTenant> {
    const tenant = await createTenant(prisma, options);
    organizationIds.push(tenant.organizationId);
    return tenant;
  }

  async function createTemplate(apiKey: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(productTemplatePayload)
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

  async function countObjects(prefix: string): Promise<number> {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: prefix,
      }),
    );
    return listed.KeyCount ?? listed.Contents?.length ?? 0;
  }

  it('creates an import session with Idempotency-Key', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);

    const response = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'create-import-001')
      .send({ templateId })
      .expect(201);

    expect(response.body).toMatchObject({
      templateId,
      status: 'created',
      columns: [],
    });
    expect(response.body.id).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty('organizationId');
    expect(response.body).not.toHaveProperty('storageObjectKey');
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('returns 400 when Idempotency-Key is missing', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);

    const response = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ templateId })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION.FAILED');
  });

  it('replays the same session for the same key and payload', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);

    const first = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'replay-key-001')
      .send({ templateId })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'replay-key-001')
      .send({ templateId })
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
  });

  it('returns 409 when the same key is reused with a different payload', async () => {
    const tenant = await trackTenant();
    const templateA = await createTemplate(tenant.apiKey);
    const templateB = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ ...productTemplatePayload, name: 'orders' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'conflict-key-001')
      .send({ templateId: templateA })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'conflict-key-001')
      .send({ templateId: templateB.body.id })
      .expect(409);

    expect(response.body.code).toBe('IDEMPOTENCY.KEY_REUSED');
  });

  it('allows different organizations to reuse the same Idempotency-Key', async () => {
    const tenantA = await trackTenant();
    const tenantB = await trackTenant();
    const templateA = await createTemplate(tenantA.apiKey);
    const templateB = await createTemplate(tenantB.apiKey);

    const a = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenantA.apiKey}`)
      .set('Idempotency-Key', 'shared-key-001')
      .send({ templateId: templateA })
      .expect(201);

    const b = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenantB.apiKey}`)
      .set('Idempotency-Key', 'shared-key-001')
      .send({ templateId: templateB })
      .expect(201);

    expect(a.body.id).not.toBe(b.body.id);
  });

  it('creates a single session under concurrent identical requests', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/imports')
          .set('Authorization', `Bearer ${tenant.apiKey}`)
          .set('Idempotency-Key', 'concurrent-key-001')
          .send({ templateId }),
      ),
    );

    const bodies = responses.map((response) => {
      expect(response.status).toBe(201);
      return response.body;
    });
    const ids = new Set(bodies.map((body) => body.id));
    expect(ids.size).toBe(1);
  });

  it('returns 404 when the template belongs to another organization', async () => {
    const tenantA = await trackTenant();
    const tenantB = await trackTenant();
    const templateId = await createTemplate(tenantA.apiKey);

    const response = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenantB.apiKey}`)
      .set('Idempotency-Key', 'foreign-template-001')
      .send({ templateId })
      .expect(404);

    expect(response.body.code).toBe('TEMPLATE.NOT_FOUND');
  });

  it('uploads a CSV, returns ordered columns, and supports GET', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'upload-key-001')
      .send({ templateId })
      .expect(201);

    const csv = 'sku,name,price\nA1,Widget,10\nA2,Gadget,20\n';
    const expectedHash = createHash('sha256').update(csv, 'utf8').digest('hex');

    const uploaded = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('X-Request-ID', 'req_cccccccc-cccc-cccc-cccc-cccccccccccc')
      .attach('file', Buffer.from(csv, 'utf8'), {
        filename: 'products.csv',
        contentType: 'text/csv',
      })
      .expect(201);

    expect(uploaded.headers['x-request-id']).toBe(
      'req_cccccccc-cccc-cccc-cccc-cccccccccccc',
    );
    expect(uploaded.body).toMatchObject({
      id: created.body.id,
      status: 'uploaded',
      originalFilename: 'products.csv',
      byteSize: Buffer.byteLength(csv, 'utf8'),
      contentSha256: expectedHash,
      encoding: 'utf-8',
      delimiter: ',',
      dataRowCount: 2,
      columns: [
        { name: 'sku', position: 0 },
        { name: 'name', position: 1 },
        { name: 'price', position: 2 },
      ],
    });
    expect(uploaded.body).not.toHaveProperty('organizationId');
    expect(uploaded.body).not.toHaveProperty('storageObjectKey');
    expect(JSON.stringify(uploaded.body)).not.toContain(env.S3_SECRET_ACCESS_KEY);

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/imports/${created.body.id}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);

    expect(fetched.body.status).toBe('uploaded');
    expect(fetched.body.columns).toEqual(uploaded.body.columns);
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(1);
  });

  it('strips a UTF-8 BOM when openObject delivers one-byte chunks', async () => {
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const originalOpen = storage.openObject.bind(storage);
    storage.openObject = async (key: string) =>
      fragmentIntoSingleByteChunks(await originalOpen(key));

    try {
      const tenant = await trackTenant();
      const templateId = await createTemplate(tenant.apiKey);
      const created = await request(app.getHttpServer())
        .post('/api/v1/imports')
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .set('Idempotency-Key', 'bom-fragment-001')
        .send({ templateId })
        .expect(201);

      const csv = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('"sku",name\nA1,Widget\n', 'utf8'),
      ]);

      const uploaded = await request(app.getHttpServer())
        .post(`/api/v1/imports/${created.body.id}/file`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .attach('file', csv, {
          filename: 'bom.csv',
          contentType: 'text/csv',
        })
        .expect(201);

      expect(uploaded.body.status).toBe('uploaded');
      expect(uploaded.body.columns).toEqual([
        { name: 'sku', position: 0 },
        { name: 'name', position: 1 },
      ]);
      expect(uploaded.body.columns[0].name).toBe('sku');
      expect(uploaded.body.columns[0].name.startsWith('\uFEFF')).toBe(false);
    } finally {
      storage.openObject = originalOpen;
    }
  });

  it('rejects a second upload for the same session', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'second-upload-001')
      .send({ templateId })
      .expect(201);

    const csv = 'sku,name\nA1,Widget\n';
    await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'products.csv')
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'products.csv')
      .expect(409);

    expect(second.body.code).toBe('IMPORT.FILE_ALREADY_UPLOADED');
  });

  it('returns 413 when the file exceeds the configured size limit', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'too-large-001')
      .send({ templateId })
      .expect(201);

    const huge = `sku,name\n${'x'.repeat(2000)},y\n`;
    const response = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from(huge, 'utf8'), 'big.csv')
      .expect(413);

    expect(response.body.code).toBe('IMPORT.FILE_TOO_LARGE');
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(0);
  });

  it('returns 422 for binary content and leaves no stored object', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'binary-001')
      .send({ templateId })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x00]), 'fake.csv')
      .expect(422);

    expect(response.body.code).toBe('IMPORT.INVALID_CSV');
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(0);

    const session = await request(app.getHttpServer())
      .get(`/api/v1/imports/${created.body.id}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(session.body.status).not.toBe('uploaded');
  });

  it('returns 422 for unsupported encoding', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'utf16-001')
      .send({ templateId })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach(
        'file',
        Buffer.from([0xff, 0xfe, 0x73, 0x00, 0x6b, 0x00, 0x75, 0x00]),
        'utf16.csv',
      )
      .expect(422);

    expect(response.body.code).toBe('IMPORT.INVALID_CSV');
  });

  it('returns 422 for duplicate headers and malformed CSV', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);

    const duplicateSession = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'dup-header-001')
      .send({ templateId })
      .expect(201);

    const duplicate = await request(app.getHttpServer())
      .post(`/api/v1/imports/${duplicateSession.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from('sku,sku\n1,2\n', 'utf8'), 'dup.csv')
      .expect(422);
    expect(duplicate.body.code).toBe('IMPORT.INVALID_CSV');

    const malformedSession = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'malformed-001')
      .send({ templateId })
      .expect(201);

    const malformed = await request(app.getHttpServer())
      .post(`/api/v1/imports/${malformedSession.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from('sku,name\n"unclosed\n', 'utf8'), 'bad.csv')
      .expect(422);
    expect(malformed.body.code).toBe('IMPORT.INVALID_CSV');
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(0);
  });

  it('returns 422 for invalid UTF-8 in the body, marks upload_failed, and leaves no object', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'invalid-utf8-body-001')
      .send({ templateId })
      .expect(201);

    const csv = Buffer.concat([
      Buffer.from('sku,name\nA1,', 'utf8'),
      Buffer.from([0xff]),
      Buffer.from('\n', 'utf8'),
    ]);
    const response = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', csv, 'invalid-utf8.csv')
      .expect(422);

    expect(response.body.code).toBe('IMPORT.INVALID_CSV');
    expect(JSON.stringify(response.body)).not.toContain(tenant.organizationId);
    expect(JSON.stringify(response.body)).not.toMatch(/org\//);
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(0);

    const session = await request(app.getHttpServer())
      .get(`/api/v1/imports/${created.body.id}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(session.body.status).toBe('upload_failed');
  });

  it('returns 409 IMPORT.UPLOAD_NOT_ALLOWED when retrying a failed upload', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'retry-failed-upload-001')
      .send({ templateId })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach(
        'file',
        Buffer.concat([
          Buffer.from('sku,name\nA1,', 'utf8'),
          Buffer.from([0xff]),
          Buffer.from('\n', 'utf8'),
        ]),
        'invalid-utf8.csv',
      )
      .expect(422);

    const retry = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from('sku,name\nA1,Widget\n', 'utf8'), 'ok.csv')
      .expect(409);

    expect(retry.body.code).toBe('IMPORT.UPLOAD_NOT_ALLOWED');
    expect(retry.body.message).not.toMatch(/already has an uploaded file/i);
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(0);
  });

  it('returns 400 for multipart with two files and leaves no stored object', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'two-files-001')
      .send({ templateId })
      .expect(201);

    const csv = 'sku,name\nA1,Widget\n';
    const response = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'a.csv')
      .attach('file', Buffer.from(csv, 'utf8'), 'b.csv')
      .expect(400);

    expect(response.body.code).toBe('VALIDATION.FAILED');
    expect(JSON.stringify(response.body)).not.toContain(tenant.organizationId);

    const session = await request(app.getHttpServer())
      .get(`/api/v1/imports/${created.body.id}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(session.body.status).not.toBe('uploaded');
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(0);
  });

  it('accepts a row larger than IMPORT_MAX_FIELD_BYTES when every field is within the limit', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'wide-row-001')
      .send({ templateId })
      .expect(201);

    const csv = `sku,name\n${'a'.repeat(200)},${'b'.repeat(200)}\n`;
    const uploaded = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'wide.csv')
      .expect(201);

    expect(uploaded.body.status).toBe('uploaded');
    expect(uploaded.body.columns).toEqual([
      { name: 'sku', position: 0 },
      { name: 'name', position: 1 },
    ]);
    expect(uploaded.body.contentSha256).toBe(
      createHash('sha256').update(csv, 'utf8').digest('hex'),
    );
    expect(uploaded.headers['x-request-id']).toEqual(expect.any(String));
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(1);
  });

  it('returns 422 when a single field exceeds IMPORT_MAX_FIELD_BYTES and leaves no object', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'huge-field-001')
      .send({ templateId })
      .expect(201);

    const csv = `sku\n${'x'.repeat(257)}\n`;
    const response = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'huge-field.csv')
      .expect(422);

    expect(response.body.code).toBe('IMPORT.INVALID_CSV');
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(0);

    const session = await request(app.getHttpServer())
      .get(`/api/v1/imports/${created.body.id}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(session.body.status).not.toBe('uploaded');
  });

  it('uploads a CSV whose quoted header contains a semicolon-delimited line break', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'quoted-header-semi-001')
      .send({ templateId })
      .expect(201);

    const csv = '"first\nname";sku\nvalue;A1\n';
    const uploaded = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'quoted.csv')
      .expect(201);

    expect(uploaded.body.status).toBe('uploaded');
    expect(uploaded.body.delimiter).toBe(';');
    expect(uploaded.body.columns).toEqual([
      { name: 'first\nname', position: 0 },
      { name: 'sku', position: 1 },
    ]);
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(1);
  });

  it('uploads a CSV whose quoted header contains a comma-delimited line break', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'quoted-header-comma-001')
      .send({ templateId })
      .expect(201);

    const csv = '"first\nname",sku\nvalue,A1\n';
    const uploaded = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'quoted.csv')
      .expect(201);

    expect(uploaded.body.status).toBe('uploaded');
    expect(uploaded.body.columns[0]?.name).toBe('first\nname');
    expect(uploaded.body.columns[1]?.name).toBe('sku');
  });

  it('uploads a quoted multiline header that uses CRLF', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'quoted-header-crlf-001')
      .send({ templateId })
      .expect(201);

    const csv = '"first\r\nname";sku\r\nvalue;A1\r\n';
    const uploaded = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'quoted.csv')
      .expect(201);

    expect(uploaded.body.status).toBe('uploaded');
    expect(uploaded.body.columns[0]?.name).toMatch(/first\r?\nname/);
    expect(uploaded.body.columns[1]?.name).toBe('sku');
  });

  it('rejects incompatible filename and MIME, keeps the session created, and allows a later CSV upload', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'invalid-signals-001')
      .send({ templateId })
      .expect(201);

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from('not-csv', 'utf8'), {
        filename: 'workbook.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(422);

    expect(rejected.body.code).toBe('IMPORT.INVALID_CSV');
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(0);

    const session = await request(app.getHttpServer())
      .get(`/api/v1/imports/${created.body.id}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(session.body.status).toBe('created');

    const uploaded = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from('sku,name\nA1,Widget\n', 'utf8'), 'ok.csv')
      .expect(201);
    expect(uploaded.body.status).toBe('uploaded');
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(1);
  });

  it('returns 400 when multipart Content-Type has no boundary', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'no-boundary-001')
      .send({ templateId })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Content-Type', 'multipart/form-data')
      .send('--x\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\n\r\nsku\n1\n\r\n--x--\r\n')
      .expect(400);

    expect(response.body.code).toBe('VALIDATION.FAILED');
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(0);

    const session = await request(app.getHttpServer())
      .get(`/api/v1/imports/${created.body.id}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(session.body.status).toBe('created');

    const uploaded = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from('sku,name\nA1,Widget\n', 'utf8'), 'ok.csv')
      .expect(201);
    expect(uploaded.body.status).toBe('uploaded');
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(1);
  });

  it('returns 404 when another organization reads the session', async () => {
    const tenantA = await trackTenant();
    const tenantB = await trackTenant();
    const templateId = await createTemplate(tenantA.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenantA.apiKey}`)
      .set('Idempotency-Key', 'cross-tenant-001')
      .send({ templateId })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/imports/${created.body.id}`)
      .set('Authorization', `Bearer ${tenantB.apiKey}`)
      .expect(404);

    expect(response.body.code).toBe('IMPORT.NOT_FOUND');
  });

  it('documents import endpoints in OpenAPI', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    expect(response.body.paths['/api/v1/imports']).toBeDefined();
    expect(response.body.paths['/api/v1/imports/{importId}/file']).toBeDefined();
    expect(response.body.paths['/api/v1/imports/{importId}/mapping']).toBeDefined();
    expect(response.body.paths['/api/v1/imports/{importId}/preview']).toBeDefined();
    const spec = JSON.stringify(response.body);
    expect(spec).toContain('IMPORT.FILE_ALREADY_UPLOADED');
    expect(spec).toContain('IMPORT.UPLOAD_NOT_ALLOWED');
    expect(spec).toContain('IMPORT.MAPPING_REVISION_CONFLICT');
    expect(spec).toContain('IMPORT.MAPPING_NOT_ALLOWED');
    expect(spec).toContain('IMPORT.MAPPING_INVALID');
    expect(spec).toContain('IMPORT.PREVIEW_NOT_ALLOWED');
    expect(spec).toContain('IMPORT.MAPPING_INCOMPLETE');
    expect(spec).toContain('IMPORT.FILE_CHANGED');
    expect(spec).toContain('IMPORT.PREVIEW_UNAVAILABLE');
    const createParams =
      response.body.paths['/api/v1/imports'].post.parameters ?? [];
    expect(
      createParams.some(
        (parameter: { name?: string }) => parameter.name === 'Idempotency-Key',
      ),
    ).toBe(true);
  });

  async function createUploadedSession(
    apiKey: string,
    idempotencyKey: string,
    csv = 'sku,name,price\nA1,Widget,10\n',
  ): Promise<{ importId: string; templateId: string }> {
    const templateId = await createTemplate(apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ templateId })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${apiKey}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'products.csv')
      .expect(201);

    return { importId: created.body.id as string, templateId };
  }

  it('returns an empty mapping draft after upload', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'mapping-empty-001',
    );

    const response = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);

    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.body).toEqual({
      importId,
      revision: 0,
      mappings: [],
      isComplete: false,
      missingRequiredFields: ['sku', 'priceInCents'],
    });
  });

  it('saves a partial mapping, completes it, clears it, and preserves no-op revision', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'mapping-flow-001',
    );

    const partial = await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedRevision: 0,
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      })
      .expect(200);

    expect(partial.body).toMatchObject({
      importId,
      revision: 1,
      mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      isComplete: false,
      missingRequiredFields: ['priceInCents'],
    });

    const afterGet = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(afterGet.body).toEqual(partial.body);

    const complete = await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedRevision: 1,
        mappings: [
          { columnPosition: 2, fieldKey: 'priceInCents' },
          { columnPosition: 0, fieldKey: 'sku' },
        ],
      })
      .expect(200);

    expect(complete.body).toMatchObject({
      revision: 2,
      isComplete: true,
      missingRequiredFields: [],
      mappings: [
        { columnPosition: 0, fieldKey: 'sku' },
        { columnPosition: 2, fieldKey: 'priceInCents' },
      ],
    });

    const noop = await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedRevision: 2,
        mappings: [
          { columnPosition: 0, fieldKey: 'sku' },
          { columnPosition: 2, fieldKey: 'priceInCents' },
        ],
      })
      .expect(200);
    expect(noop.body.revision).toBe(2);

    const cleared = await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ expectedRevision: 2, mappings: [] })
      .expect(200);
    expect(cleared.body).toMatchObject({
      revision: 3,
      mappings: [],
      isComplete: false,
      missingRequiredFields: ['sku', 'priceInCents'],
    });
  });

  it('rejects stale revisions and keeps the previous mapping', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'mapping-stale-001',
    );

    await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedRevision: 0,
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      })
      .expect(200);

    const conflict = await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedRevision: 0,
        mappings: [{ columnPosition: 2, fieldKey: 'priceInCents' }],
      })
      .expect(409);

    expect(conflict.body.code).toBe('IMPORT.MAPPING_REVISION_CONFLICT');

    const current = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(current.body).toMatchObject({
      revision: 1,
      mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
    });
  });

  it('allows only one concurrent writer for the same revision', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'mapping-race-001',
    );

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .put(`/api/v1/imports/${importId}/mapping`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          expectedRevision: 0,
          mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
        }),
      request(app.getHttpServer())
        .put(`/api/v1/imports/${importId}/mapping`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          expectedRevision: 0,
          mappings: [{ columnPosition: 2, fieldKey: 'priceInCents' }],
        }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = first.status === 200 ? first : second;
    const loser = first.status === 409 ? first : second;
    expect(loser.body.code).toBe('IMPORT.MAPPING_REVISION_CONFLICT');

    const current = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);

    expect(current.body.revision).toBe(1);
    expect(current.body.mappings).toEqual(winner.body.mappings);
  });

  it('rejects invalid associations without changing revision', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'mapping-invalid-001',
    );

    const response = await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedRevision: 0,
        mappings: [{ columnPosition: 0, fieldKey: 'unknownField' }],
      })
      .expect(422);

    expect(response.body.code).toBe('IMPORT.MAPPING_INVALID');

    const current = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(current.body.revision).toBe(0);
    expect(current.body.mappings).toEqual([]);
  });

  it('rejects nested arrays in mappings with 400 and preserves a saved mapping', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'mapping-structure-001',
    );

    const saved = await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedRevision: 0,
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      })
      .expect(200);

    expect(saved.body.revision).toBe(1);
    expect(saved.body.mappings).toEqual([
      { columnPosition: 0, fieldKey: 'sku' },
    ]);

    const nestedEmpty = await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('X-Request-ID', 'req_mapping_nested_empty')
      .send({ expectedRevision: 1, mappings: [[]] })
      .expect(400);

    expect(nestedEmpty.body.code).toBe('VALIDATION.FAILED');
    expect(nestedEmpty.headers['x-request-id']).toBe('req_mapping_nested_empty');

    const nestedAssoc = await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedRevision: 1,
        mappings: [[{ columnPosition: 0, fieldKey: 'sku' }]],
      })
      .expect(400);

    expect(nestedAssoc.body.code).toBe('VALIDATION.FAILED');

    const current = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);

    expect(current.body).toEqual(saved.body);
    expect(current.body.revision).toBe(1);
    expect(current.body.mappings).toEqual([
      { columnPosition: 0, fieldKey: 'sku' },
    ]);
  });

  it('returns 404 for another organization and 401 without auth', async () => {
    const tenantA = await trackTenant();
    const tenantB = await trackTenant();
    const { importId } = await createUploadedSession(
      tenantA.apiKey,
      'mapping-tenant-001',
    );

    const cross = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenantB.apiKey}`)
      .expect(404);
    expect(cross.body.code).toBe('IMPORT.NOT_FOUND');

    const unauth = await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .send({ expectedRevision: 0, mappings: [] })
      .expect(401);
    expect(unauth.body.code).toBe('AUTH.MISSING_BEARER');
  });

  it('rejects mapping before upload and after upload_failed', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'mapping-status-001')
      .send({ templateId })
      .expect(201);

    const beforeUpload = await request(app.getHttpServer())
      .get(`/api/v1/imports/${created.body.id}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(409);
    expect(beforeUpload.body.code).toBe('IMPORT.MAPPING_NOT_ALLOWED');

    await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from('sku,sku\n1,2\n', 'utf8'), 'dup.csv')
      .expect(422);

    const failed = await request(app.getHttpServer())
      .get(`/api/v1/imports/${created.body.id}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(failed.body.status).toBe('upload_failed');

    const afterFailed = await request(app.getHttpServer())
      .put(`/api/v1/imports/${created.body.id}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ expectedRevision: 0, mappings: [] })
      .expect(409);
    expect(afterFailed.body.code).toBe('IMPORT.MAPPING_NOT_ALLOWED');
  });

  it('does not call object storage for mapping GET/PUT and survives app restart', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'mapping-storage-001',
    );

    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const putObject = vi.spyOn(storage, 'putObject');
    const openObject = vi.spyOn(storage, 'openObject');
    const deleteObject = vi.spyOn(storage, 'deleteObject');

    await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedRevision: 0,
        mappings: [
          { columnPosition: 0, fieldKey: 'sku' },
          { columnPosition: 2, fieldKey: 'priceInCents' },
        ],
      })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);

    expect(putObject).not.toHaveBeenCalled();
    expect(openObject).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
    putObject.mockRestore();
    openObject.mockRestore();
    deleteObject.mockRestore();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const restarted = moduleFixture.createNestApplication();
    configureHttpApp(restarted, env);
    await restarted.init();
    registerNotFoundFallback(restarted);

    try {
      const response = await request(restarted.getHttpServer())
        .get(`/api/v1/imports/${importId}/mapping`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .expect(200);
      expect(response.body).toMatchObject({
        revision: 1,
        isComplete: true,
        mappings: [
          { columnPosition: 0, fieldKey: 'sku' },
          { columnPosition: 2, fieldKey: 'priceInCents' },
        ],
      });
    } finally {
      await restarted.close();
    }
  });

  async function completeMapping(
    apiKey: string,
    importId: string,
    expectedRevision = 0,
  ): Promise<{ revision: number }> {
    const response = await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        expectedRevision,
        mappings: [
          { columnPosition: 0, fieldKey: 'sku' },
          { columnPosition: 2, fieldKey: 'priceInCents' },
        ],
      })
      .expect(200);
    return { revision: response.body.revision as number };
  }

  it('previews mapped rows with exact cents, mixed validity, and full-file stats', async () => {
    const tenant = await trackTenant();
    const previewCsv =
      'sku,name,price\nTEN-001,Tênis Runner,"R$ 299,90"\nTEN-002,Broken,299.90\nTEN-003,Ok,10\n';
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'preview-flow-001',
      previewCsv,
    );
    const { revision } = await completeMapping(tenant.apiKey, importId);

    const preview = await request(app.getHttpServer())
      .post(`/api/v1/imports/${importId}/preview`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('X-Request-ID', 'req_preview_ok_001')
      .send({ expectedMappingRevision: revision, limit: 1 })
      .expect(200);

    expect(preview.status).toBe(200);
    expect(preview.headers['cache-control']).toMatch(/no-store/);
    expect(preview.headers['x-request-id']).toBe('req_preview_ok_001');
    expect(preview.body.importId).toBe(importId);
    expect(preview.body.mappingRevision).toBe(revision);
    expect(preview.body.normalizationProfile).toBe('pt-BR-v1');
    expect(preview.body.limit).toBe(1);
    expect(preview.body.sampleTruncated).toBe(true);
    expect(preview.body.summary).toEqual({
      totalRows: 3,
      validRows: 2,
      invalidRows: 1,
    });
    expect(preview.body.rows).toHaveLength(1);
    expect(preview.body.rows[0]).toEqual({
      recordNumber: 1,
      valid: true,
      data: { sku: 'TEN-001', priceInCents: 29990 },
      errors: [],
    });
    expect(preview.body).not.toHaveProperty('organizationId');
    expect(preview.body).not.toHaveProperty('storageObjectKey');

    const again = await request(app.getHttpServer())
      .post(`/api/v1/imports/${importId}/preview`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ expectedMappingRevision: revision, limit: 1 })
      .expect(200);
    expect(again.body).toEqual(preview.body);

    const session = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(session.body.status).toBe('uploaded');
    const mapping = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(mapping.body.revision).toBe(revision);
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(1);
  });

  it('returns 404 when another organization requests preview', async () => {
    const tenantA = await trackTenant();
    const tenantB = await trackTenant();
    const { importId } = await createUploadedSession(
      tenantA.apiKey,
      'preview-tenant-001',
    );
    const { revision } = await completeMapping(tenantA.apiKey, importId);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/imports/${importId}/preview`)
      .set('Authorization', `Bearer ${tenantB.apiKey}`)
      .send({ expectedMappingRevision: revision })
      .expect(404);
    expect(response.body.code).toBe('IMPORT.NOT_FOUND');
  });

  it('blocks preview for created and upload_failed sessions', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.apiKey);
    const created = await request(app.getHttpServer())
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('Idempotency-Key', 'preview-status-001')
      .send({ templateId })
      .expect(201);

    const before = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/preview`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ expectedMappingRevision: 0 })
      .expect(409);
    expect(before.body.code).toBe('IMPORT.PREVIEW_NOT_ALLOWED');

    await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/file`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .attach('file', Buffer.from('sku,sku\n1,2\n', 'utf8'), 'dup.csv')
      .expect(422);

    const afterFailed = await request(app.getHttpServer())
      .post(`/api/v1/imports/${created.body.id}/preview`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ expectedMappingRevision: 0 })
      .expect(409);
    expect(afterFailed.body.code).toBe('IMPORT.PREVIEW_NOT_ALLOWED');
  });

  it('blocks incomplete and stale mapping before opening storage', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'preview-precond-001',
    );
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const openObject = vi.spyOn(storage, 'openObject');

    const incomplete = await request(app.getHttpServer())
      .post(`/api/v1/imports/${importId}/preview`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ expectedMappingRevision: 0 })
      .expect(409);
    expect(incomplete.body.code).toBe('IMPORT.MAPPING_INCOMPLETE');
    expect(openObject).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .put(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        expectedRevision: 0,
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      })
      .expect(200);

    const stale = await request(app.getHttpServer())
      .post(`/api/v1/imports/${importId}/preview`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ expectedMappingRevision: 0 })
      .expect(409);
    expect(stale.body.code).toBe('IMPORT.MAPPING_REVISION_CONFLICT');
    expect(openObject).not.toHaveBeenCalled();
    openObject.mockRestore();

    const mapping = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(mapping.body.revision).toBe(1);
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(1);
  });

  it('returns 400 when expectedMappingRevision is outside the safe integer range', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'preview-revision-range-001',
    );
    const { revision } = await completeMapping(tenant.apiKey, importId);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const openObject = vi.spyOn(storage, 'openObject');

    const unsafe = await request(app.getHttpServer())
      .post(`/api/v1/imports/${importId}/preview`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .set('X-Request-ID', 'req_preview_unsafe_rev')
      .send({ expectedMappingRevision: Number.MAX_SAFE_INTEGER + 1 })
      .expect(400);

    expect(unsafe.body.code).toBe('VALIDATION.FAILED');
    expect(unsafe.headers['x-request-id']).toBe('req_preview_unsafe_rev');
    expect(openObject).not.toHaveBeenCalled();

    const scientific = await request(app.getHttpServer())
      .post(`/api/v1/imports/${importId}/preview`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ expectedMappingRevision: 1e100 })
      .expect(400);
    expect(scientific.body.code).toBe('VALIDATION.FAILED');
    expect(openObject).not.toHaveBeenCalled();
    openObject.mockRestore();

    const mapping = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(mapping.body.revision).toBe(revision);
  });

  it('returns 409 when mapping changes during the object read', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'preview-race-001',
    );
    const { revision } = await completeMapping(tenant.apiKey, importId);

    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const originalOpen = storage.openObject.bind(storage);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstChunkSeen!: () => void;
    const sawFirst = new Promise<void>((resolve) => {
      firstChunkSeen = resolve;
    });

    storage.openObject = async (key: string) => {
      const source = await originalOpen(key);
      return Readable.from(
        (async function* () {
          let notified = false;
          for await (const chunk of source) {
            const buffer = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk as string);
            if (!notified && buffer.length > 0) {
              notified = true;
              yield buffer.subarray(0, 1);
              firstChunkSeen();
              await gate;
              if (buffer.length > 1) {
                yield buffer.subarray(1);
              }
              continue;
            }
            yield buffer;
          }
        })(),
      );
    };

    try {
      const pending = request(app.getHttpServer())
        .post(`/api/v1/imports/${importId}/preview`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({ expectedMappingRevision: revision })
        .then((response) => response);

      await sawFirst;
      await request(app.getHttpServer())
        .put(`/api/v1/imports/${importId}/mapping`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          expectedRevision: revision,
          mappings: [
            { columnPosition: 0, fieldKey: 'priceInCents' },
            { columnPosition: 2, fieldKey: 'sku' },
          ],
        })
        .expect(200);
      release();

      const response = await pending;
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('IMPORT.MAPPING_REVISION_CONFLICT');
    } finally {
      storage.openObject = originalOpen;
    }
  }, 20_000);

  it('returns 503 when storage fails mid-read and keeps the uploaded object', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'preview-io-001',
    );
    const { revision } = await completeMapping(tenant.apiKey, importId);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const originalOpen = storage.openObject.bind(storage);

    storage.openObject = async (key: string) => {
      const source = await originalOpen(key);
      const out = new Readable({
        read() {
          // push from async pump
        },
      });
      void (async () => {
        try {
          for await (const chunk of source) {
            const buffer = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk as string);
            if (buffer.length > 0) {
              out.push(buffer.subarray(0, 1));
            }
            break;
          }
          source.destroy();
          out.destroy(new Error('storage read failed'));
        } catch (error) {
          out.destroy(
            error instanceof Error
              ? error
              : new Error('storage read failed'),
          );
        }
      })();
      return out;
    };

    try {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/imports/${importId}/preview`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({ expectedMappingRevision: revision })
        .expect(503);
      expect(response.body.code).toBe('IMPORT.PREVIEW_UNAVAILABLE');
    } finally {
      storage.openObject = originalOpen;
    }

    const session = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(session.body.status).toBe('uploaded');
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(1);
  }, 20_000);

  it('returns 503 when the storage stream closes before EOF and keeps the object', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'preview-eof-001',
    );
    const { revision } = await completeMapping(tenant.apiKey, importId);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const originalOpen = storage.openObject.bind(storage);

    storage.openObject = async (key: string) => {
      const source = await originalOpen(key);
      let started = false;
      const out = new Readable({
        read() {
          if (started) {
            return;
          }
          started = true;
          void (async () => {
            try {
              for await (const chunk of source) {
                const buffer = Buffer.isBuffer(chunk)
                  ? chunk
                  : Buffer.from(chunk as string);
                if (buffer.length > 0) {
                  out.push(buffer.subarray(0, Math.min(buffer.length, 8)));
                }
                break;
              }
            } finally {
              source.destroy();
              if (!out.destroyed) {
                out.destroy();
              }
            }
          })();
        },
      });
      out.once('close', () => {
        if (!source.destroyed) {
          source.destroy();
        }
      });
      return out;
    };

    try {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/imports/${importId}/preview`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .set('X-Request-ID', 'req_preview_premature_close')
        .send({ expectedMappingRevision: revision })
        .expect(503);
      expect(response.body.code).toBe('IMPORT.PREVIEW_UNAVAILABLE');
      expect(response.headers['x-request-id']).toBe('req_preview_premature_close');
      expect(response.body.traceId).toBe('req_preview_premature_close');
    } finally {
      storage.openObject = originalOpen;
    }

    const session = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(session.body.status).toBe('uploaded');
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(1);
  }, 20_000);

  it('detects a replaced stored object as FILE_CHANGED without deleting it', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'preview-changed-001',
    );
    const { revision } = await completeMapping(tenant.apiKey, importId);
    const stored = await prisma.importSession.findFirst({
      where: { id: importId, organizationId: tenant.organizationId },
    });
    expect(stored?.storageObjectKey).toEqual(expect.any(String));

    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    await storage.putObject(
      stored!.storageObjectKey as string,
      Readable.from([Buffer.from('sku,name,price\nZZ,Other,99\n', 'utf8')]),
      { contentType: 'text/csv' },
    );

    const response = await request(app.getHttpServer())
      .post(`/api/v1/imports/${importId}/preview`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ expectedMappingRevision: revision })
      .expect(409);
    expect(response.body.code).toBe('IMPORT.FILE_CHANGED');
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(1);

    const session = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(session.body.status).toBe('uploaded');
  });

  it('returns 422 when preview reads an inconsistent CSV without EOF and then succeeds after restore', async () => {
    const tenant = await trackTenant();
    const { importId } = await createUploadedSession(
      tenant.apiKey,
      'preview-inconsistent-001',
    );
    const { revision } = await completeMapping(tenant.apiKey, importId);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const originalOpen = storage.openObject.bind(storage);

    storage.openObject = async () => {
      let pushed = false;
      return new Readable({
        read() {
          if (pushed) {
            return;
          }
          pushed = true;
          this.push(Buffer.from('sku\nA,B\n', 'utf8'));
        },
      });
    };

    try {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/imports/${importId}/preview`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .set('X-Request-ID', 'req_preview_inconsistent_csv')
        .send({ expectedMappingRevision: revision })
        .expect(422);
      expect(response.body.code).toBe('IMPORT.INVALID_CSV');
      expect(response.headers['x-request-id']).toBe(
        'req_preview_inconsistent_csv',
      );
      expect(response.body.traceId).toBe('req_preview_inconsistent_csv');
    } finally {
      storage.openObject = originalOpen;
    }

    const session = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(session.body.status).toBe('uploaded');
    const mapping = await request(app.getHttpServer())
      .get(`/api/v1/imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);
    expect(mapping.body.revision).toBe(revision);
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(1);

    const preview = await request(app.getHttpServer())
      .post(`/api/v1/imports/${importId}/preview`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ expectedMappingRevision: revision })
      .expect(200);
    expect(preview.body.summary.totalRows).toBeGreaterThan(0);
    expect(preview.headers['cache-control']).toMatch(/no-store/);
  }, 20_000);

  it('keeps upload and preview consistent when CRLF is split across openObject chunks', async () => {
    const tenant = await trackTenant();
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const originalOpen = storage.openObject.bind(storage);
    storage.openObject = async (key: string) =>
      fragmentCrLfAfterFirstDataRecord(await originalOpen(key));

    const csv = 'sku\r\nA\r\nB\r\n';
    let importId: string;
    let revision: number;

    try {
      const template = await request(app.getHttpServer())
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          name: 'sku-only-crlf',
          fields: [
            { key: 'sku', label: 'SKU', type: 'string', required: true },
          ],
        })
        .expect(201);

      const created = await request(app.getHttpServer())
        .post('/api/v1/imports')
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .set('Idempotency-Key', 'crlf-fragment-upload-001')
        .send({ templateId: template.body.id })
        .expect(201);

      const uploaded = await request(app.getHttpServer())
        .post(`/api/v1/imports/${created.body.id}/file`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .attach('file', Buffer.from(csv, 'utf8'), {
          filename: 'crlf.csv',
          contentType: 'text/csv',
        })
        .expect(201);

      expect(uploaded.body.dataRowCount).toBe(2);
      expect(uploaded.body.columns).toEqual([{ name: 'sku', position: 0 }]);
      importId = created.body.id as string;

      const mapped = await request(app.getHttpServer())
        .put(`/api/v1/imports/${importId}/mapping`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          expectedRevision: 0,
          mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
        })
        .expect(200);
      revision = mapped.body.revision as number;

      const fragmentedPreview = await request(app.getHttpServer())
        .post(`/api/v1/imports/${importId}/preview`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .set('X-Request-ID', 'req_crlf_fragment_preview')
        .send({ expectedMappingRevision: revision })
        .expect(200);

      expect(fragmentedPreview.body.summary).toEqual({
        totalRows: 2,
        validRows: 2,
        invalidRows: 0,
      });
      expect(fragmentedPreview.body.rows).toEqual([
        {
          recordNumber: 1,
          valid: true,
          data: { sku: 'A' },
          errors: [],
        },
        {
          recordNumber: 2,
          valid: true,
          data: { sku: 'B' },
          errors: [],
        },
      ]);
    } finally {
      storage.openObject = originalOpen;
    }

    const restoredPreview = await request(app.getHttpServer())
      .post(`/api/v1/imports/${importId!}/preview`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ expectedMappingRevision: revision! })
      .expect(200);

    expect(restoredPreview.body.summary).toEqual({
      totalRows: 2,
      validRows: 2,
      invalidRows: 0,
    });
    expect(restoredPreview.body.rows).toEqual([
      {
        recordNumber: 1,
        valid: true,
        data: { sku: 'A' },
        errors: [],
      },
      {
        recordNumber: 2,
        valid: true,
        data: { sku: 'B' },
        errors: [],
      },
    ]);
    expect(restoredPreview.body.code).toBeUndefined();
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(1);
  }, 20_000);

  it('keeps upload and preview consistent when an escaped quote is split across openObject chunks', async () => {
    const tenant = await trackTenant();
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const originalOpen = storage.openObject.bind(storage);

    // Decodes to a single sku value: He said "Hi"
    const csv = 'sku\r\n"He said ""Hi"""\r\n';
    const csvBytes = Buffer.from(csv, 'utf8');
    const pairIndex = csvBytes.indexOf('""Hi');
    expect(pairIndex).toBeGreaterThan(0);
    // Land the split between the two quote bytes of the escaped pair.
    const splitOffset = pairIndex + 1;

    storage.openObject = async (key: string) =>
      fragmentAtByteOffset(await originalOpen(key), splitOffset);

    let importId: string;
    let revision: number;

    try {
      const template = await request(app.getHttpServer())
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          name: 'sku-only-escaped-quote',
          fields: [
            { key: 'sku', label: 'SKU', type: 'string', required: true },
          ],
        })
        .expect(201);

      const created = await request(app.getHttpServer())
        .post('/api/v1/imports')
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .set('Idempotency-Key', 'escaped-quote-fragment-upload-001')
        .send({ templateId: template.body.id })
        .expect(201);

      const uploaded = await request(app.getHttpServer())
        .post(`/api/v1/imports/${created.body.id}/file`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .attach('file', csvBytes, {
          filename: 'escaped-quote.csv',
          contentType: 'text/csv',
        })
        .expect(201);

      expect(uploaded.body.dataRowCount).toBe(1);
      importId = created.body.id as string;

      const mapped = await request(app.getHttpServer())
        .put(`/api/v1/imports/${importId}/mapping`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          expectedRevision: 0,
          mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
        })
        .expect(200);
      revision = mapped.body.revision as number;

      const fragmentedPreview = await request(app.getHttpServer())
        .post(`/api/v1/imports/${importId}/preview`)
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .set('X-Request-ID', 'req_escaped_quote_fragment_preview')
        .send({ expectedMappingRevision: revision })
        .expect(200);

      expect(fragmentedPreview.body.rows).toEqual([
        {
          recordNumber: 1,
          valid: true,
          data: { sku: 'He said "Hi"' },
          errors: [],
        },
      ]);
    } finally {
      storage.openObject = originalOpen;
    }

    const restoredPreview = await request(app.getHttpServer())
      .post(`/api/v1/imports/${importId!}/preview`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ expectedMappingRevision: revision! })
      .expect(200);

    expect(restoredPreview.body.rows).toEqual([
      {
        recordNumber: 1,
        valid: true,
        data: { sku: 'He said "Hi"' },
        errors: [],
      },
    ]);
    expect(restoredPreview.body.code).toBeUndefined();
    expect(await countObjects(`org/${tenant.organizationId}/`)).toBe(1);
  }, 20_000);
});
