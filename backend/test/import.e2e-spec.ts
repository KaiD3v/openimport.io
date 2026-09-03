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
    const spec = JSON.stringify(response.body);
    expect(spec).toContain('IMPORT.FILE_ALREADY_UPLOADED');
    expect(spec).toContain('IMPORT.UPLOAD_NOT_ALLOWED');
    const createParams =
      response.body.paths['/api/v1/imports'].post.parameters ?? [];
    expect(
      createParams.some(
        (parameter: { name?: string }) => parameter.name === 'Idempotency-Key',
      ),
    ).toBe(true);
  });
});
