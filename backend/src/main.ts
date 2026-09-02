import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureHttpApp, registerNotFoundFallback } from './configure-http.js';
import { env } from './core/config/env.singleton.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureHttpApp(app, env);
  app.enableShutdownHooks();
  await app.init();
  registerNotFoundFallback(app);
  await app.listen(env.PORT);
}

await bootstrap();
