import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Public ceiling; runtime may tighten via IMPORT_RESULT_BATCH_MAX_SIZE. */
export const IMPORT_RESULT_BATCH_PUBLIC_MAX_SIZE = 100;
export const IMPORT_RESULT_CLIENT_RECORD_ID_MAX = 128;
export const IMPORT_RESULT_ERROR_CODE_MAX = 64;
export const IMPORT_RESULT_ERROR_MESSAGE_MAX = 500;

/** Upper bound for Prisma Int / PostgreSQL INTEGER columns. */
export const POSTGRES_INTEGER_MAX = 2_147_483_647;

function keepJsonNumber(value: unknown): unknown {
  return value;
}

export class ImportResultItemErrorDto {
  @ApiProperty({
    example: 'SKU_ALREADY_EXISTS',
    maxLength: IMPORT_RESULT_ERROR_CODE_MAX,
    description: 'Client-defined rejection code (sanitized length).',
  })
  @IsString()
  @MaxLength(IMPORT_RESULT_ERROR_CODE_MAX)
  @Matches(/^[A-Za-z0-9._-]+$/)
  code!: string;

  @ApiProperty({
    example: 'SKU already exists in the catalog.',
    maxLength: IMPORT_RESULT_ERROR_MESSAGE_MAX,
  })
  @IsString()
  @MaxLength(IMPORT_RESULT_ERROR_MESSAGE_MAX)
  message!: string;
}

export class ImportResultItemDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: POSTGRES_INTEGER_MAX,
    description:
      '1-based data-row number from the ready snapshot. Must fit PostgreSQL INTEGER.',
  })
  @Transform(({ value }) => keepJsonNumber(value))
  @IsInt()
  @Min(1)
  @Max(POSTGRES_INTEGER_MAX)
  recordNumber!: number;

  @ApiProperty({ enum: ['accepted', 'rejected'] })
  @IsIn(['accepted', 'rejected'])
  outcome!: 'accepted' | 'rejected';

  @ApiPropertyOptional({
    maxLength: IMPORT_RESULT_CLIENT_RECORD_ID_MAX,
    description:
      'Optional id assigned by the client system for an accepted or rejected row.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(IMPORT_RESULT_CLIENT_RECORD_ID_MAX)
  clientRecordId?: string;

  @ApiPropertyOptional({
    type: ImportResultItemErrorDto,
    description:
      'Required when outcome is rejected; must be omitted when accepted.',
  })
  @ValidateIf((item: ImportResultItemDto) => item.outcome === 'rejected')
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ImportResultItemErrorDto)
  error?: ImportResultItemErrorDto;
}

export class ReportImportResultsDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Ready execution that produced the valid rows being acknowledged.',
  })
  @IsUUID()
  executionId!: string;

  @ApiProperty({
    type: [ImportResultItemDto],
    minItems: 1,
    maxItems: IMPORT_RESULT_BATCH_PUBLIC_MAX_SIZE,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORT_RESULT_BATCH_PUBLIC_MAX_SIZE)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ImportResultItemDto)
  results!: ImportResultItemDto[];
}
