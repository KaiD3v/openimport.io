import { DynamicModule, Global, Module } from '@nestjs/common';
import type { Env } from './env.js';
import { ENV } from './env.token.js';

@Global()
@Module({})
export class ConfigModule {
  static forRoot(validatedEnv: Env): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: ENV, useValue: validatedEnv }],
      exports: [ENV],
    };
  }
}
