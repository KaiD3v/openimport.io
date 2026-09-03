import { ApiProperty } from '@nestjs/swagger';

export class ImportPreviewFieldErrorDto {
  @ApiProperty({ example: 'size' })
  fieldKey!: string;

  @ApiProperty({
    example: 'FIELD.INVALID_INTEGER',
    enum: [
      'FIELD.REQUIRED',
      'FIELD.INVALID_INTEGER',
      'FIELD.INVALID_CURRENCY',
      'FIELD.NUMBER_OUT_OF_RANGE',
    ],
  })
  code!: string;

  @ApiProperty({ example: 'Value must be an integer.' })
  message!: string;
}

export class ImportPreviewRowDto {
  @ApiProperty({ example: 1, minimum: 1 })
  recordNumber!: number;

  @ApiProperty({ example: true })
  valid!: boolean;

  @ApiProperty({
    nullable: true,
    example: { sku: 'TEN-001', priceInCents: 29990 },
    description:
      'Normalized object keyed by template field keys. Null when the record has any field error.',
  })
  data!: Record<string, string | number> | null;

  @ApiProperty({ type: [ImportPreviewFieldErrorDto] })
  errors!: ImportPreviewFieldErrorDto[];
}

export class ImportPreviewSummaryDto {
  @ApiProperty({ example: 2 })
  totalRows!: number;

  @ApiProperty({ example: 1 })
  validRows!: number;

  @ApiProperty({ example: 1 })
  invalidRows!: number;
}

export class ImportPreviewResponseDto {
  @ApiProperty({ format: 'uuid' })
  importId!: string;

  @ApiProperty({ example: 1 })
  mappingRevision!: number;

  @ApiProperty({ example: 'a'.repeat(64) })
  contentSha256!: string;

  @ApiProperty({ example: 'pt-BR-v1' })
  normalizationProfile!: string;

  @ApiProperty({ type: ImportPreviewSummaryDto })
  summary!: ImportPreviewSummaryDto;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({
    example: false,
    description:
      'True when the sample does not include every data record. A first record larger than the 1 MiB JSON budget can yield an empty sample while summary still covers the file.',
  })
  sampleTruncated!: boolean;

  @ApiProperty({ type: [ImportPreviewRowDto] })
  rows!: ImportPreviewRowDto[];
}
