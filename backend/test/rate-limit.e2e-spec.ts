import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp, registerNotFoundFallback } from '../src/configure-http.js';
import { buildRateLimitRedisKey } from '../src/common/http/rate-limit.keys.js';
import { RateLimitStore } from '../src/common/http/rate-limit.store.js';
import { ApiKeyService } from '../src/core/auth/api-key.service.js';
import { ENV } from '../src/core/config/env.token.js';
import { env as baseEnv } from '../src/core/config/env.singleton.js';
import type { Env } from '../src/core/config/env.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import {
  createTenant,
  productTemplatePayload,
  type TestTenant,
} from './helpers/tenant.factory.js';
import { forceE2eRedisEnv } from './helpers/e2e-redis.js';

const LOOPBACK_IPS = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

const rateLimitEnv = Object.freeze({
  ...baseEnv,
  RATE_LIMIT_ENABLED: true,
  RATE_LIMIT_WINDOW_MS: 60_000,
  // Pre-auth applies to every non-health request; keep it high so post-auth
  // isolation tests are not starved by shared loopback IP quota.
  RATE_LIMIT_PRE_AUTH_MAX: 1_000,
  RATE_LIMIT_MAX: 5,
  RATE_LIMIT_UPLOAD_MAX: 3,
  RATE_LIMIT_PREVIEW_MAX: 3,
  RATE_LIMIT_CONFIRM_MAX: 3,
  RATE_LIMIT_ACCESS_TOKEN_MAX: 3,
  RATE_LIMIT_WEBHOOK_MAX: 3,
  RATE_LIMIT_TRUSTED_PROXY: false,
}) as Env;

describe('Rate limit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let store: RateLimitStore;
  let apiKeys: ApiKeyService;
  const organizationIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ENV)
      .useValue(rateLimitEnv)
      .compile();

    app = moduleFixture.createNestApplication();
    configureHttpApp(app, rateLimitEnv);
    await app.init();
    registerNotFoundFallback(app);
    prisma = app.get(PrismaService);
    store = app.get(RateLimitStore);
    apiKeys = app.get(ApiKeyService);
  });

  afterEach(async () => {
    for (const ip of LOOPBACK_IPS) {
      await store.deleteKey('pre_auth', { kind: 'ip', ip });
    }
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

  async function trackTenant(): Promise<TestTenant> {
    const tenant = await createTenant(prisma);
    organizationIds.push(tenant.organizationId);
    return tenant;
  }

  async function exhaustPreAuthIps(): Promise<void> {
    const redis = new Redis(forceE2eRedisEnv(), {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    await redis.connect();
    try {
      for (const ip of LOOPBACK_IPS) {
        const key = buildRateLimitRedisKey('pre_auth', { kind: 'ip', ip });
        await redis.set(
          key,
          String(rateLimitEnv.RATE_LIMIT_PRE_AUTH_MAX),
          'PX',
          rateLimitEnv.RATE_LIMIT_WINDOW_MS,
        );
      }
    } finally {
      await redis.quit();
    }
  }

  it('returns 429 with Retry-After after RATE_LIMIT_MAX for the same api key', async () => {
    const tenant = await trackTenant();
    const max = rateLimitEnv.RATE_LIMIT_MAX;

    for (let i = 0; i < max; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${tenant.apiKey}`)
        .send({ ...productTemplatePayload, name: `t-${i}-${Date.now()}` })
        .expect((response) => {
          expect([201, 409]).toContain(response.status);
        });
    }

    const limited = await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenant.apiKey}`)
      .send({ ...productTemplatePayload, name: `t-over-${Date.now()}` })
      .expect(429);

    expect(limited.body.code).toBe('RATE_LIMIT.EXCEEDED');
    expect(limited.body.traceId).toBeTruthy();
    expect(limited.headers['x-request-id']).toBeTruthy();
    expect(limited.headers['retry-after']).toBeDefined();
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('isolates the post-auth limit by organization/api key', async () => {
    const tenantA = await trackTenant();
    const tenantB = await trackTenant();
    const max = rateLimitEnv.RATE_LIMIT_MAX;

    for (let i = 0; i < max; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/templates')
        .set('Authorization', `Bearer ${tenantA.apiKey}`)
        .send({ ...productTemplatePayload, name: `a-${i}-${Date.now()}` })
        .expect((response) => {
          expect([201, 409]).toContain(response.status);
        });
    }

    await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenantA.apiKey}`)
      .send({ ...productTemplatePayload, name: `a-over-${Date.now()}` })
      .expect(429);

    await request(app.getHttpServer())
      .post('/api/v1/templates')
      .set('Authorization', `Bearer ${tenantB.apiKey}`)
      .send({ ...productTemplatePayload, name: `b-${Date.now()}` })
      .expect((response) => {
        expect([201, 409]).toContain(response.status);
      });
  });

  it('rate limits missing Bearer by IP before auth lookup', async () => {
    await exhaustPreAuthIps();
    const resolveSpy = vi.spyOn(apiKeys, 'resolve');

    const limited = await request(app.getHttpServer())
      .get('/api/v1/templates/11111111-1111-4111-8111-111111111111')
      .expect(429);

    expect(limited.body.code).toBe('RATE_LIMIT.EXCEEDED');
    expect(limited.headers['retry-after']).toBeDefined();
    expect(resolveSpy).not.toHaveBeenCalled();
    resolveSpy.mockRestore();
  });

  it('rate limits invalid API keys by IP before auth lookup', async () => {
    await exhaustPreAuthIps();
    const resolveSpy = vi.spyOn(apiKeys, 'resolve');
    const fakeKey = `oi_live_${randomBytes(32).toString('hex')}`;

    const limited = await request(app.getHttpServer())
      .get('/api/v1/templates/22222222-2222-4222-8222-222222222222')
      .set('Authorization', `Bearer ${fakeKey}`)
      .expect(429);

    expect(limited.body.code).toBe('RATE_LIMIT.EXCEEDED');
    expect(resolveSpy).not.toHaveBeenCalled();
    resolveSpy.mockRestore();
  });

  it('does not rate limit health endpoints', async () => {
    await exhaustPreAuthIps();
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer()).get('/health').expect(200);
    }
  });

  it('keeps store available for multi-instance style consumes', async () => {
    const identity = {
      kind: 'apiKey' as const,
      organizationId: `e2e-shared-${Date.now()}`,
      apiKeyId: `e2e-key-${Date.now()}`,
    };
    const a = await store.consume('general', identity, 2, 60_000);
    const b = await store.consume('general', identity, 2, 60_000);
    const c = await store.consume('general', identity, 2, 60_000);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(false);
    await store.deleteKey('general', identity);
  });
});
