import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import {
  configureHttpApp,
  registerNotFoundFallback,
} from '../src/configure-http.js';
import { ConfigModule } from '../src/core/config/config.module.js';
import { env } from '../src/core/config/env.singleton.js';
import { HealthController } from '../src/core/health/health.controller.js';
import {
  READINESS_PROBES,
  ReadinessService,
} from '../src/core/health/readiness.service.js';
import type { ReadinessProbe } from '../src/core/health/readiness.types.js';

describe('Health readiness (e2e)', () => {
  let app: INestApplication;

  async function createApp(
    overrides?: Partial<{
      postgres: ReadinessProbe['check'];
      redis: ReadinessProbe['check'];
      objectStorage: ReadinessProbe['check'];
    }>,
  ): Promise<INestApplication> {
    const probes: ReadinessProbe[] = [
      {
        dependency: 'postgres',
        check: overrides?.postgres ?? (async () => undefined),
      },
      {
        dependency: 'redis',
        check: overrides?.redis ?? (async () => undefined),
      },
      {
        dependency: 'object_storage',
        check: overrides?.objectStorage ?? (async () => undefined),
      },
    ];

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(env)],
      controllers: [HealthController],
      providers: [
        ReadinessService,
        { provide: READINESS_PROBES, useValue: probes },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();

    const nestApp = moduleFixture.createNestApplication();
    configureHttpApp(nestApp, env);
    await nestApp.init();
    registerNotFoundFallback(nestApp);
    return nestApp;
  }

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('returns 200 when PostgreSQL, Redis, and object storage are available', async () => {
    app = await createApp();

    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns 503 when PostgreSQL is unavailable without exposing connection details', async () => {
    app = await createApp({
      postgres: async () => {
        throw new Error('postgresql://secret:password@db.internal:5432/openimport');
      },
    });

    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);

    expect(response.body.code).toBe('HEALTH.NOT_READY');
    expect(response.body.message).toBe('Application is not ready.');
    expect(JSON.stringify(response.body)).not.toMatch(
      /postgresql:\/\/|redis:\/\/|openimport|password|secret|bucket/i,
    );
    expect(response.headers['x-request-id']).toBe(response.body.traceId);
  });

  it('returns 503 when Redis is unavailable', async () => {
    app = await createApp({
      redis: async () => {
        throw new Error('redis://secret-host:6379/0');
      },
    });

    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);

    expect(response.body.code).toBe('HEALTH.NOT_READY');
    expect(JSON.stringify(response.body)).not.toContain('redis://');
  });

  it('returns 503 when object storage is unavailable', async () => {
    app = await createApp({
      objectStorage: async () => {
        throw new Error('http://minio.internal:9000/openimport-bucket');
      },
    });

    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);

    expect(response.body.code).toBe('HEALTH.NOT_READY');
    expect(JSON.stringify(response.body)).not.toMatch(
      /minio|9000|openimport-bucket/i,
    );
  });

  it('recovers on the next probe after a transient dependency failure', async () => {
    let failPostgres = true;
    app = await createApp({
      postgres: async () => {
        if (failPostgres) {
          throw new ServiceUnavailableException();
        }
      },
    });

    await request(app.getHttpServer()).get('/health/ready').expect(503);

    failPostgres = false;
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });

  it('keeps liveness independent from dependency probes', async () => {
    app = await createApp({
      postgres: async () => {
        throw new Error('postgres down');
      },
      redis: async () => {
        throw new Error('redis down');
      },
      objectStorage: async () => {
        throw new Error('storage down');
      },
    });

    await request(app.getHttpServer()).get('/health').expect(200);
  });
});
