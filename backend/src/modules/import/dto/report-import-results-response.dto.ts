import { ApiProperty } from '@nestjs/swagger';

export class ImportResultsSummaryDto {
  @ApiProperty({ format: 'uuid' })
  importId!: string;

  @ApiProperty({ format: 'uuid' })
  executionId!: string;

  @ApiProperty({
    example: 5,
    description: 'Count of valid records in the ready OpenImport snapshot.',
  })
  totalValid!: number;

  @ApiProperty({
    example: 2,
    description: 'accepted + rejected already reported by the client.',
  })
  reported!: number;

  @ApiProperty({ example: 1 })
  accepted!: number;

  @ApiProperty({ example: 1 })
  rejected!: number;

  @ApiProperty({
    example: 3,
    description: 'totalValid - reported. Pending client acknowledgement.',
  })
  pending!: number;

  @ApiProperty({
    example: false,
    description:
      'True exactly when pending === 0 (including zero-valid snapshots). Does not change session status ready.',
  })
  isComplete!: boolean;
}

export class ReportImportResultsResponseDto {
  @ApiProperty({ format: 'uuid' })
  importId!: string;

  @ApiProperty({ format: 'uuid' })
  executionId!: string;

  @ApiProperty({ format: 'uuid' })
  batchId!: string;

  @ApiProperty({
    example: false,
    description: 'True when the same Idempotency-Key and payload were replayed.',
  })
  replayed!: boolean;

  @ApiProperty({ type: ImportResultsSummaryDto })
  summary!: ImportResultsSummaryDto;
}
