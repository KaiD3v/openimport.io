import { Module } from '@nestjs/common';
import { ObjectStorageModule } from '../../integrations/object-storage/object-storage.module.js';
import { HealthController } from './health.controller.js';
import { ObjectStorageReadinessProbe } from './object-storage-readiness.probe.js';
import { PostgresReadinessProbe } from './postgres-readiness.probe.js';
import { RedisReadinessProbe } from './redis-readiness.probe.js';
import { READINESS_PROBES, ReadinessService } from './readiness.service.js';

@Module({
  imports: [ObjectStorageModule],
  controllers: [HealthController],
  providers: [
    ReadinessService,
    PostgresReadinessProbe,
    RedisReadinessProbe,
    ObjectStorageReadinessProbe,
    {
      provide: READINESS_PROBES,
      inject: [
        PostgresReadinessProbe,
        RedisReadinessProbe,
        ObjectStorageReadinessProbe,
      ],
      useFactory: (
        postgres: PostgresReadinessProbe,
        redis: RedisReadinessProbe,
        objectStorage: ObjectStorageReadinessProbe,
      ) => [postgres, redis, objectStorage],
    },
  ],
})
export class HealthModule {}
