import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateTemplateDto } from './dto/create-template.dto.js';
import type { TemplateResponseDto } from './dto/template-response.dto.js';
import { TemplateRepository } from './template.repository.js';
import type { ImportTemplateRecord } from './template.types.js';

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

@Injectable()
export class TemplateService {
  constructor(private readonly templates: TemplateRepository) {}

  async create(
    organizationId: string,
    dto: CreateTemplateDto,
  ): Promise<TemplateResponseDto> {
    try {
      const created = await this.templates.create(organizationId, {
        name: dto.name,
        fields: dto.fields.map((field, position) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          position,
        })),
      });
      return this.toResponse(created);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({
          code: 'TEMPLATE.NAME_CONFLICT',
          message: 'A template with this name already exists in the organization.',
        });
      }
      throw error;
    }
  }

  async findById(
    organizationId: string,
    templateId: string,
  ): Promise<TemplateResponseDto> {
    const template = await this.templates.findByIdForOrganization(
      organizationId,
      templateId,
    );
    if (!template) {
      throw new NotFoundException({
        code: 'TEMPLATE.NOT_FOUND',
        message: 'Template not found.',
      });
    }
    return this.toResponse(template);
  }

  private toResponse(template: ImportTemplateRecord): TemplateResponseDto {
    return {
      id: template.id,
      name: template.name,
      fields: template.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        position: field.position,
      })),
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    };
  }
}
