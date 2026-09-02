import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import {
  TEMPLATE_FIELDS_MAX,
  TEMPLATE_FIELDS_MIN,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_NAME_MIN_LENGTH,
} from '../template.constants.js';
import { TemplateFieldInputDto } from './template-field-input.dto.js';

export class CreateTemplateDto {
  @ApiProperty({
    example: 'products',
    minLength: TEMPLATE_NAME_MIN_LENGTH,
    maxLength: TEMPLATE_NAME_MAX_LENGTH,
    description: `Non-empty template name, ${TEMPLATE_NAME_MIN_LENGTH}-${TEMPLATE_NAME_MAX_LENGTH} characters after trim. Unique per organization.`,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(TEMPLATE_NAME_MIN_LENGTH, TEMPLATE_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({
    type: [TemplateFieldInputDto],
    minItems: TEMPLATE_FIELDS_MIN,
    maxItems: TEMPLATE_FIELDS_MAX,
    description: `Ordered field definitions, ${TEMPLATE_FIELDS_MIN}-${TEMPLATE_FIELDS_MAX} items. Keys must be unique within the template.`,
  })
  @IsArray()
  @ArrayMinSize(TEMPLATE_FIELDS_MIN)
  @ArrayMaxSize(TEMPLATE_FIELDS_MAX)
  @ArrayUnique<TemplateFieldInputDto>((field) => field.key)
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldInputDto)
  fields!: TemplateFieldInputDto[];
}
