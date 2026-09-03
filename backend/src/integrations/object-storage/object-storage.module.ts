import { Module } from '@nestjs/common';
import { ENV } from '../../core/config/env.token.js';
import type { Env } from '../../core/config/env.js';
import { OBJECT_STORAGE } from './object-storage.port.js';
import { S3ObjectStorage } from './s3-object-storage.js';

@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [ENV],
      useFactory: (env: Env) => new S3ObjectStorage(env),
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class ObjectStorageModule {}
