import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ObjectStorageModule } from '../../integrations/object-storage/object-storage.module.js';
import { ENV } from '../../core/config/env.token.js';
import type { Env } from '../../core/config/env.js';
import { TemplateModule } from '../template/index.js';
import { WebhookModule } from '../webhook/index.js';
import { ConfirmService } from './confirm/confirm.service.js';
import { ImportController } from './import.controller.js';
import { ImportRepository } from './import.repository.js';
import { ImportService } from './import.service.js';
import { PreviewService } from './preview/preview.service.js';
import { IMPORT_PROCESSING_QUEUE } from './processing/import-processing.queue.js';
import { ImportProcessingJobPublisher } from './processing/ensure-processable-job.js';
import { ImportProcessingReconciler } from './processing/import-processing.reconciler.js';
import { ImportProcessingWorker } from './processing/import-processing.worker.js';
import { RejectedRowsService } from './processing/rejected-rows.service.js';
import { ValidRowsService } from './processing/valid-rows.service.js';
import { ReportResultsService } from './results/report-results.service.js';
import { ImportFileRetentionCleaner } from './storage/import-file-retention.cleaner.js';

@Module({
  imports: [
    TemplateModule,
    ObjectStorageModule,
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: {
          url: env.REDIS_URL,
        },
      }),
    }),
    BullModule.registerQueue({
      name: IMPORT_PROCESSING_QUEUE,
    }),
    WebhookModule,
  ],
  controllers: [ImportController],
  providers: [
    ImportService,
    PreviewService,
    ConfirmService,
    RejectedRowsService,
    ValidRowsService,
    ReportResultsService,
    ImportRepository,
    ImportProcessingJobPublisher,
    ImportProcessingWorker,
    ImportProcessingReconciler,
    ImportFileRetentionCleaner,
  ],
  exports: [
    ImportService,
    ImportProcessingReconciler,
    ImportFileRetentionCleaner,
  ],
})
export class ImportModule {}
