import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';

function keepJsonNumber(value: unknown): unknown {
  return value;
}

export class CreateImportPreviewDto {
  @ApiProperty({
    example: 1,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    description:
      'Mapping revision captured by GET. Must be a JSON integer between 0 and Number.MAX_SAFE_INTEGER. Mismatches return 409 IMPORT.MAPPING_REVISION_CONFLICT.',
  })
  @Transform(({ value }) => keepJsonNumber(value))
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedMappingRevision!: number;

  @ApiPropertyOptional({
    example: 20,
    minimum: 1,
    maximum: 100,
    default: 20,
    description:
      'Maximum number of leading records to include in the sample. Defaults to 20. Statistics always cover the whole file.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => keepJsonNumber(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
