import { ApiProperty } from '@nestjs/swagger';
import { TemplateFieldType } from '../template-field-type.js';

export class TemplateFieldResponseDto {
  @ApiProperty({ example: 'sku' })
  key!: string;

  @ApiProperty({ example: 'SKU' })
  label!: string;

  @ApiProperty({
    enum: TemplateFieldType,
    enumName: 'TemplateFieldType',
    example: TemplateFieldType.String,
  })
  type!: TemplateFieldType;

  @ApiProperty({ example: true })
  required!: boolean;

  @ApiProperty({ example: 0, description: 'Zero-based order of the field in the template' })
  position!: number;
}

export class TemplateResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'products' })
  name!: string;

  @ApiProperty({ type: [TemplateFieldResponseDto] })
  fields!: TemplateFieldResponseDto[];

  @ApiProperty({ example: '2026-09-02T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-02T12:00:00.000Z' })
  updatedAt!: string;
}
