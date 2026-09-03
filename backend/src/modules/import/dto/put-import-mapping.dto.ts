import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  FIELD_KEY_PATTERN,
  FIELD_KEY_PATTERN_DESCRIPTION,
  TEMPLATE_FIELDS_MAX,
} from '../../template/template.constants.js';

function keepJsonNumber(value: unknown): unknown {
  return value;
}

export class ImportMappingPairDto {
  @ApiProperty({ example: 0, minimum: 0 })
  @Transform(({ value }) => keepJsonNumber(value))
  @IsInt()
  @Min(0)
  columnPosition!: number;

  @ApiProperty({
    example: 'sku',
    description: FIELD_KEY_PATTERN_DESCRIPTION,
  })
  @IsString()
  @Matches(FIELD_KEY_PATTERN)
  fieldKey!: string;
}

export class PutImportMappingDto {
  @ApiProperty({
    example: 0,
    minimum: 0,
    description:
      'Current mapping revision from GET. Mismatches return 409 IMPORT.MAPPING_REVISION_CONFLICT.',
  })
  @Transform(({ value }) => keepJsonNumber(value))
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ApiProperty({
    type: [ImportMappingPairDto],
    maxItems: TEMPLATE_FIELDS_MAX,
    description:
      'Full replacement list of columnPosition → fieldKey associations. Empty array clears the draft.',
  })
  @IsArray()
  @ArrayMaxSize(TEMPLATE_FIELDS_MAX)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ImportMappingPairDto)
  mappings!: ImportMappingPairDto[];
}
