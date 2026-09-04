import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImportProgressDto {
  @ApiProperty({ example: 420 })
  processedRows!: number;

  @ApiPropertyOptional({
    example: 1000,
    nullable: true,
    description:
      'Known data-row total from upload. Null when unavailable — clients must not invent a percentage.',
  })
  totalRows!: number | null;

  @ApiProperty({ example: 400 })
  validRows!: number;

  @ApiProperty({ example: 20 })
  invalidRows!: number;
}

export class ImportFailureDto {
  @ApiProperty({ example: 'IMPORT.PROCESSING_FAILED' })
  code!: string;

  @ApiProperty({
    example: 'Import processing failed after exhausting retries.',
  })
  message!: string;
}

export class ConfirmImportResponseDto {
  @ApiProperty({ format: 'uuid' })
  importId!: string;

  @ApiProperty({ format: 'uuid' })
  executionId!: string;

  @ApiProperty({
    enum: ['queued', 'processing', 'ready', 'processing_failed'],
    example: 'queued',
  })
  status!: 'queued' | 'processing' | 'ready' | 'processing_failed';

  @ApiProperty({ example: 1 })
  expectedMappingRevision!: number;

  @ApiProperty({ example: 'a'.repeat(64) })
  expectedContentSha256!: string;

  @ApiProperty({ type: ImportProgressDto })
  progress!: ImportProgressDto;

  @ApiPropertyOptional({
    type: ImportFailureDto,
    nullable: true,
    description:
      'Public failure when status is processing_failed; otherwise null.',
  })
  failure!: ImportFailureDto | null;

  @ApiProperty({
    example: false,
    description: 'True when this response replays an existing confirmation.',
  })
  replayed!: boolean;
}

export class RejectedRowDto {
  @ApiProperty({ example: 12 })
  recordNumber!: number;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        fieldKey: { type: 'string' },
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
  })
  errors!: Array<{ fieldKey: string; code: string; message: string }>;
}

export class RejectedRowsResponseDto {
  @ApiProperty({ type: [RejectedRowDto] })
  data!: RejectedRowDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Pass as `after` for the next page. Null when exhausted.',
  })
  nextCursor!: string | null;
}
