import { Module } from '@nestjs/common';
import { ObjectStorageModule } from '../../integrations/object-storage/object-storage.module.js';
import { TemplateModule } from '../template/index.js';
import { ImportController } from './import.controller.js';
import { ImportRepository } from './import.repository.js';
import { ImportService } from './import.service.js';

@Module({
  imports: [TemplateModule, ObjectStorageModule],
  controllers: [ImportController],
  providers: [ImportService, ImportRepository],
  exports: [ImportService],
})
export class ImportModule {}
