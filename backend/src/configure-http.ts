import {
  INestApplication,
  RequestMethod,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import { applyRequestId, resolveRequestId } from './common/http/request-id.js';
import { createValidationPipe } from './common/validation/create-validation-pipe.js';
import type { Env } from './core/config/env.js';

export function configureHttpApp(app: INestApplication, env: Env): void {
  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
    }),
  );
  app.use((req: Request, res: Response, next: () => void) => {
    applyRequestId(req, res);
    next();
  });
  app.enableCors({
    origin: env.ALLOWED_ORIGINS,
  });
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(createValidationPipe());

  if (env.NODE_ENV !== 'production' || env.ENABLE_DOCS) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('OpenImport API')
        .setDescription(
          'Multi-tenant import template API. Authenticate with an organization API key. Selected import routes also accept a short-lived import access token.',
        )
        .setVersion('1.0.0')
        .addBearerAuth(
          {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'API Key',
            description: 'Organization API key',
          },
          'api-key',
        )
        .addBearerAuth(
          {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'Import access token',
            description:
              'Session-scoped import access token (oi_import_). Allowed only on annotated import routes for the bound importId.',
          },
          'import-access-token',
        )
        .build(),
    );
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }
}

export function registerNotFoundFallback(app: INestApplication): void {
  const instance = app.getHttpAdapter().getInstance() as {
    use: (handler: (req: Request, res: Response) => void) => void;
  };

  instance.use((req: Request, res: Response) => {
    const traceId = resolveRequestId(req);
    if (res.headersSent) {
      return;
    }

    res.setHeader('X-Request-ID', traceId);
    res.status(404).json({
      code: 'RESOURCE.NOT_FOUND',
      message: 'Resource not found.',
      traceId,
    });
  });
}
