import { Module } from '@nestjs/common';
import { TemplateController } from './template.controller.js';
import { TemplateRepository } from './template.repository.js';
import { TemplateService } from './template.service.js';

@Module({
  controllers: [TemplateController],
  providers: [TemplateService, TemplateRepository],
  exports: [TemplateService, TemplateRepository],
})
export class TemplateModule {}
