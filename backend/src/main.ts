import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { applyHttpServerLimits } from './common/http/configure-http-server.js';
import { configureHttpApp, registerNotFoundFallback } from './configure-http.js';
import { env } from './core/config/env.singleton.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  configureHttpApp(app, env);
  if (env.TRUST_PROXY) {
    app.set('trust proxy', env.TRUST_PROXY);
  }
  app.enableShutdownHooks();
  await app.init();
  registerNotFoundFallback(app);

  // Configure reception limits before accepting connections.
  applyHttpServerLimits(app.getHttpServer(), env);

  await app.listen(env.PORT, '0.0.0.0');
}

await bootstrap();
