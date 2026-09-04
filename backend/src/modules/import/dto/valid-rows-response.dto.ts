import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ValidRowDto {
  @ApiProperty({ example: 1 })
  recordNumber!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      oneOf: [{ type: 'string' }, { type: 'number' }],
    },
    example: { sku: 'TEN-001', priceInCents: 29990 },
    description: 'Normalized payload persisted for a valid record.',
  })
  data!: Record<string, string | number>;
}

export class ValidRowsResponseDto {
  @ApiProperty({ format: 'uuid' })
  importId!: string;

  @ApiProperty({ format: 'uuid' })
  executionId!: string;

  @ApiProperty({ type: [ValidRowDto] })
  data!: ValidRowDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Pass as `after` for the next page. Null when exhausted.',
    example: null,
  })
  nextCursor!: string | null;
}
