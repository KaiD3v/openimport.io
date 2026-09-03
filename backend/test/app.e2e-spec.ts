import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp, registerNotFoundFallback } from '../src/configure-http.js';
import { env } from '../src/core/config/env.singleton.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import {
  createTenant,
  productTemplatePayload,
  type TestTenant,
} from './helpers/tenant.factory.js';

describe('OpenImport API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const organizationIds: string[] = [];

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
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      organizationIds.length = 0;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function trackTenant(
    options?: Parameters<typeof createTenant>[1],
  ): Promise<TestTenant> {
    const tenant = await createTenant(prisma, options);
    organizationIds.push(tenant.organizationId);
    return tenant;
  }

  it('exposes a public health check', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('reports readiness without exposing the database URL', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(response.body).toEqual({ status: 'ok' });
    expect(JSON.stringify(response.body)).not.toContain('DATABASE_URL');
    expect(JSON.stringify(response.body)).not.toContain('postgresql://');
  });

  it('exposes OpenAPI JSON with Bearer API key auth', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    expect(response.body.components.securitySchemes['api-key']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(
      response.body.components.securitySchemes['import-access-token'],
    ).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(
      response.body.paths['/api/v1/imports/{importId}/access-tokens'],
    ).toBeDefined();
    expect(
      response.body.paths['/api/v1/imports/{importId}/context'],
    ).toBeDefined();
    expect(response.body.paths['/api/v1/templates']).toBeDefined();
    expect(response.body.paths['/api/v1/templates'].post.security).toEqual([
      { 'api-key': [] },
    ]);
    expect(
      response.body.paths['/api/v1/templates/{templateId}'].get.security,
    ).toEqual([{ 'api-key': [] }]);
  });

  it('creates a template with an authenticated POST', async () => {
    const tenant = await trackTenant();

    const response = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send(productTemplatePayload)
      .expect(201);

    expect(response.body).toMatchObject({
      name: 'products',
      fields: [
        {
          key: 'sku',
          label: 'SKU',
          type: 'string',
          required: true,
          position: 0,
        },
        {
          key: 'priceInCents',
          label: 'Preço',
          type: 'currency',
          required: true,
          position: 1,
        },
      ],
    });
    expect(response.body.id).toEqual(expect.any(String));
    expect(response.body.createdAt).toEqual(expect.any(String));
    expect(response.body.updatedAt).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty('organizationId');
    expect(JSON.stringify(response.body)).not.toContain(tenant.apiKey);
  });

  it('returns the template with an authenticated GET', async () => {
    const tenant = await trackTenant();
    const created = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send(productTemplatePayload)
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/templates/${created.body.id}`)
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: created.body.id,
      name: 'products',
    });
    expect(response.body).not.toHaveProperty('organizationId');
  });

  it('returns 401 when the credential is missing', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .send(productTemplatePayload)
      .expect(401);

    expect(response.body.code).toBe('AUTH.MISSING_BEARER');
    expect(response.body.message).toBe(
      'Authorization header must contain a Bearer credential.',
    );
  });

  it('returns 401 when the API key is invalid', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', 'Bearer oi_live_this_key_does_not_exist_anywhere_0000000000000000')
      .send(productTemplatePayload)
      .expect(401);

    expect(response.body.code).toBe('AUTH.INVALID_API_KEY');
  });

  it('returns 401 when the API key is revoked', async () => {
    const tenant = await trackTenant({ revoked: true });

    const response = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send(productTemplatePayload)
      .expect(401);

    expect(response.body.code).toBe('AUTH.INVALID_API_KEY');
  });

  it('returns 400 when the payload contains an unknown property', async () => {
    const tenant = await trackTenant();

    const response = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ ...productTemplatePayload, extra: true })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION.FAILED');
  });

  it('returns 400 when a field key is duplicated in the payload', async () => {
    const tenant = await trackTenant();

    const response = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        name: 'products',
        fields: [
          { key: 'sku', label: 'SKU', type: 'string', required: true },
          { key: 'sku', label: 'Stock', type: 'string', required: false },
        ],
      })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION.FAILED');
  });

  it('returns 409 when the template name already exists in the organization', async () => {
    const tenant = await trackTenant();
    await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send(productTemplatePayload)
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send(productTemplatePayload)
      .expect(409);

    expect(response.body.code).toBe('TEMPLATE.NAME_CONFLICT');
  });

  it('allows two organizations to use the same template name', async () => {
    const tenantA = await trackTenant();
    const tenantB = await trackTenant();

    await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenantA.apiKey}`)
      .send(productTemplatePayload)
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenantB.apiKey}`)
      .send(productTemplatePayload)
      .expect(201);
  });

  it('returns 404, not 403, when organization B reads a template from organization A', async () => {
    const tenantA = await trackTenant();
    const tenantB = await trackTenant();
    const created = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenantA.apiKey}`)
      .send(productTemplatePayload)
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/templates/${created.body.id}`)
      .set('Authorization', `Bearer ${tenantB.apiKey}`)
      .expect(404);

    expect(response.body.code).toBe('TEMPLATE.NOT_FOUND');
    expect(response.status).not.toBe(403);
  });

  it('returns 400 when required is a string or number instead of a boolean', async () => {
    const tenant = await trackTenant();
    const cases = ['false', 'true', 0, 1] as const;

    for (const required of cases) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({
          name: 'products',
          fields: [{ key: 'sku', label: 'SKU', type: 'string', required }],
        })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION.FAILED');
    }

    await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send(productTemplatePayload)
      .expect(201);
  });

  it('returns 400 when name or label are numbers instead of strings', async () => {
    const tenant = await trackTenant();

    const numericName = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        name: 123,
        fields: [{ key: 'sku', label: 'SKU', type: 'string', required: true }],
      })
      .expect(400);

    const numericLabel = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({
        name: 'products',
        fields: [{ key: 'sku', label: 42, type: 'string', required: true }],
      })
      .expect(400);

    expect(numericName.body.code).toBe('VALIDATION.FAILED');
    expect(numericLabel.body.code).toBe('VALIDATION.FAILED');
  });

  it('returns JSON 404 for unknown routes with and without the API prefix', async () => {
    const unprefixed = await request(app.getHttpServer())
      .get('/does-not-exist')
      .expect(404);
    const prefixed = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404);

    for (const response of [unprefixed, prefixed]) {
      expect(response.headers['content-type']).toMatch(/json/);
      expect(response.body).toMatchObject({
        code: 'RESOURCE.NOT_FOUND',
        message: 'Resource not found.',
      });
      expect(response.body.traceId).toEqual(expect.any(String));
      expect(response.headers['x-request-id']).toBe(response.body.traceId);
      expect(JSON.stringify(response.body)).not.toMatch(/cannot get/i);
      expect(JSON.stringify(response.body)).not.toContain('Express');
    }
  });

  it('returns X-Request-ID on success and error using the logger id', async () => {
    const incoming = 'req_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    const success = await request(app.getHttpServer())
      .get('/health')
      .set('X-Request-ID', incoming)
      .expect(200);
    const error = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('X-Request-ID', incoming)
      .send(productTemplatePayload)
      .expect(401);

    expect(success.headers['x-request-id']).toBe(incoming);
    expect(error.headers['x-request-id']).toBe(incoming);
    expect(error.body.traceId).toBe(incoming);
  });

  it('does not echo an invalid or oversized X-Request-ID', async () => {
    const invalid = '../etc/passwd';
    const oversized = 'a'.repeat(200);

    const invalidResponse = await request(app.getHttpServer())
      .get('/health')
      .set('X-Request-ID', invalid)
      .expect(200);
    const oversizedResponse = await request(app.getHttpServer())
      .get('/does-not-exist')
      .set('X-Request-ID', oversized)
      .expect(404);

    expect(invalidResponse.headers['x-request-id']).not.toBe(invalid);
    expect(oversizedResponse.headers['x-request-id']).not.toBe(oversized);
    expect(oversizedResponse.body.traceId).toBe(
      oversizedResponse.headers['x-request-id'],
    );
    expect(oversizedResponse.body.traceId.length).toBeLessThanOrEqual(128);
  });

  it('returns 400 when templateId is not a UUID', async () => {
    const tenant = await trackTenant();

    const response = await request(app.getHttpServer())
      .get('/api/v1/templates/not-a-uuid')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .expect(400);

    expect(response.body.code).toBe('VALIDATION.FAILED');
  });

  it('documents status-specific error examples in OpenAPI', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    const schemas = response.body.components.schemas;
    const post = response.body.paths['/api/v1/templates'].post.responses;
    const get = response.body.paths['/api/v1/templates/{templateId}'].get
      .responses;

    expect(schemas.ValidationFailedErrorDto.properties.code.example).toBe(
      'VALIDATION.FAILED',
    );
    expect(schemas.UnauthorizedErrorDto.properties.code.example).toBe(
      'AUTH.MISSING_BEARER',
    );
    expect(schemas.UnauthorizedErrorDto.properties.message.example).toBe(
      'Authorization header must contain a Bearer credential.',
    );
    expect(schemas.TemplateNotFoundErrorDto.properties.code.example).toBe(
      'TEMPLATE.NOT_FOUND',
    );
    expect(schemas.TemplateNameConflictErrorDto.properties.code.example).toBe(
      'TEMPLATE.NAME_CONFLICT',
    );
    expect(schemas.InvalidUuidParamErrorDto.properties.code.example).toBe(
      'VALIDATION.FAILED',
    );

    expect(post['400'].content['application/json'].schema.$ref).toContain(
      'ValidationFailedErrorDto',
    );
    expect(post['401'].content['application/json'].schema.$ref).toContain(
      'UnauthorizedErrorDto',
    );
    expect(post['409'].content['application/json'].schema.$ref).toContain(
      'TemplateNameConflictErrorDto',
    );
    expect(get['400'].content['application/json'].schema.$ref).toContain(
      'InvalidUuidParamErrorDto',
    );
    expect(get['404'].content['application/json'].schema.$ref).toContain(
      'TemplateNotFoundErrorDto',
    );
  });
});
