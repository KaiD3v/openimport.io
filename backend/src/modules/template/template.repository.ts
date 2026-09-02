import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import type { CreateTemplateData, ImportTemplateRecord } from './template.types.js';

@Injectable()
export class TemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    organizationId: string,
    data: CreateTemplateData,
  ): Promise<ImportTemplateRecord> {
    return this.prisma.importTemplate.create({
      data: {
        organizationId,
        name: data.name,
        fields: {
          create: data.fields,
        },
      },
      include: {
        fields: {
          orderBy: { position: 'asc' },
        },
      },
    });
  }

  findByIdForOrganization(
    organizationId: string,
    templateId: string,
  ): Promise<ImportTemplateRecord | null> {
    return this.prisma.importTemplate.findFirst({
      where: {
        id: templateId,
        organizationId,
      },
      include: {
        fields: {
          orderBy: { position: 'asc' },
        },
      },
    });
  }
}
