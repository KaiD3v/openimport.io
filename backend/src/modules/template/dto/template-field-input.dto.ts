import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import {
  FIELD_KEY_MAX_LENGTH,
  FIELD_KEY_PATTERN,
  FIELD_KEY_PATTERN_DESCRIPTION,
  FIELD_LABEL_MAX_LENGTH,
} from '../template.constants.js';
import { TemplateFieldType } from '../template-field-type.js';

export class TemplateFieldInputDto {
  @ApiProperty({
    example: 'sku',
    maxLength: FIELD_KEY_MAX_LENGTH,
    description: FIELD_KEY_PATTERN_DESCRIPTION,
  })
  @IsString()
  @Matches(FIELD_KEY_PATTERN, { message: FIELD_KEY_PATTERN_DESCRIPTION })
  key!: string;

  @ApiProperty({ example: 'SKU', maxLength: FIELD_LABEL_MAX_LENGTH })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, FIELD_LABEL_MAX_LENGTH)
  label!: string;

  @ApiProperty({
    enum: TemplateFieldType,
    enumName: 'TemplateFieldType',
    example: TemplateFieldType.String,
  })
  @IsEnum(TemplateFieldType)
  type!: TemplateFieldType;

  @ApiProperty({ example: true })
  @IsBoolean()
  required!: boolean;
}
