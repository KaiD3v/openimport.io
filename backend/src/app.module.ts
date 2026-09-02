import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { Request } from 'express';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { resolveRequestId } from './common/http/request-id.js';
import { ApiKeyGuard } from './core/auth/api-key.guard.js';
import { AuthModule } from './core/auth/auth.module.js';
import { ConfigModule } from './core/config/config.module.js';
import type { Env } from './core/config/env.js';
import { env } from './core/config/env.singleton.js';
import { ENV } from './core/config/env.token.js';
import { DatabaseModule } from './core/database/database.module.js';
import { HealthModule } from './core/health/health.module.js';
import { TemplateModule } from './modules/template/index.js';

@Module({
  imports: [
    ConfigModule.forRoot(env),
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
              'res.headers["set-cookie"]',
              '*.password',
              '*.passwordHash',
              '*.token',
              '*.apiKey',
              '*.secret',
              '*.keyHash',
              '*.SEED_API_KEY',
            ],
            censor: '[REDACTED]',
          },
          customProps: (req: Request) => ({
            traceId: req.id,
            organizationId: req.organization?.organizationId,
          }),
        },
      }),
    }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    TemplateModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
