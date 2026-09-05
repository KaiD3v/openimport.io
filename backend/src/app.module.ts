import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { Request } from 'express';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { PostAuthRateLimitGuard } from './common/http/post-auth-rate-limit.guard.js';
import { PreAuthRateLimitGuard } from './common/http/pre-auth-rate-limit.guard.js';
import { RateLimitModule } from './common/http/rate-limit.module.js';
import { resolveRequestId } from './common/http/request-id.js';
import { ApiKeyGuard } from './core/auth/api-key.guard.js';
import { ImportAuthorizationGuard } from './core/auth/import-authorization.guard.js';
import { AuthModule } from './core/auth/auth.module.js';
import { ConfigModule } from './core/config/config.module.js';
import type { Env } from './core/config/env.js';
import { env } from './core/config/env.singleton.js';
import { ENV } from './core/config/env.token.js';
import { DatabaseModule } from './core/database/database.module.js';
import { HealthModule } from './core/health/health.module.js';
import { ImportModule } from './modules/import/index.js';
import { TemplateModule } from './modules/template/index.js';

@Module({
  imports: [
    ConfigModule.forRoot(env),
    RateLimitModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (validatedEnv: Env) => ({
        pinoHttp: {
          level: validatedEnv.NODE_ENV === 'test' ? 'silent' : validatedEnv.LOG_LEVEL,
          genReqId: (req: Request) => resolveRequestId(req),
          transport:
            validatedEnv.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
              : undefined,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["idempotency-key"]',
              'res.headers["set-cookie"]',
              '*.password',
              '*.passwordHash',
              '*.accessToken',
              '*.tokenHash',
              '*.token',
              '*.apiKey',
              '*.secret',
              '*.keyHash',
              '*.SEED_API_KEY',
              '*.S3_SECRET_ACCESS_KEY',
              '*.S3_ACCESS_KEY_ID',
              '*.WEBHOOK_SECRET_ENCRYPTION_KEY',
              '*.secretCiphertext',
              'req.headers["openimport-signature"]',
            ],
            censor: '[REDACTED]',
          },
          customProps: (req: Request) => ({
            traceId: req.id,
            organizationId: req.organization?.organizationId,
            credentialType: req.organization?.credential.type,
          }),
        },
      }),
    }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    TemplateModule,
    ImportModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: PreAuthRateLimitGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: ImportAuthorizationGuard },
    { provide: APP_GUARD, useClass: PostAuthRateLimitGuard },
  ],
})
export class AppModule {}
