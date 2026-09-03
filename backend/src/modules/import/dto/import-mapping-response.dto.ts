import { ApiProperty } from '@nestjs/swagger';

export class ImportMappingPairResponseDto {
  @ApiProperty({ example: 0 })
  columnPosition!: number;

  @ApiProperty({ example: 'sku' })
  fieldKey!: string;
}

export class ImportMappingResponseDto {
  @ApiProperty({ format: 'uuid' })
  importId!: string;

  @ApiProperty({ example: 1, minimum: 0 })
  revision!: number;

  @ApiProperty({ type: [ImportMappingPairResponseDto] })
  mappings!: ImportMappingPairResponseDto[];

  @ApiProperty({
    example: false,
    description:
      'True when at least one association exists and every required template field is mapped. Does not imply row validation.',
  })
  isComplete!: boolean;

  @ApiProperty({
    type: [String],
    example: ['model', 'size'],
    description:
      'Required template field keys still unmapped, ordered by template field position.',
  })
  missingRequiredFields!: string[];
}
