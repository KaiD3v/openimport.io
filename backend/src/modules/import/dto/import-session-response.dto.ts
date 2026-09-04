import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ImportFailureDto,
  ImportProgressDto,
} from './confirm-import-response.dto.js';

export class ImportColumnResponseDto {
  @ApiProperty({ example: 'sku' })
  name!: string;

  @ApiProperty({ example: 0 })
  position!: number;
}

export class ImportSessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  templateId!: string;

  @ApiProperty({
    enum: [
      'created',
      'uploaded',
      'queued',
      'processing',
      'ready',
      'processing_failed',
      'upload_failed',
    ],
    example: 'created',
  })
  status!:
    | 'created'
    | 'uploaded'
    | 'queued'
    | 'processing'
    | 'ready'
    | 'processing_failed'
    | 'upload_failed';

  @ApiPropertyOptional({ example: 'products.csv', nullable: true })
  originalFilename!: string | null;

  @ApiPropertyOptional({ example: 128, nullable: true })
  byteSize!: number | null;

  @ApiPropertyOptional({
    example: 'a'.repeat(64),
    nullable: true,
  })
  contentSha256!: string | null;

  @ApiPropertyOptional({ example: 'utf-8', nullable: true })
  encoding!: string | null;

  @ApiPropertyOptional({ example: ',', nullable: true })
  delimiter!: string | null;

  @ApiPropertyOptional({ example: 10, nullable: true })
  dataRowCount!: number | null;

  @ApiProperty({ type: [ImportColumnResponseDto] })
  columns!: ImportColumnResponseDto[];

  @ApiPropertyOptional({
    type: ImportProgressDto,
    nullable: true,
    description:
      'Present after confirmation. totalRows may be null — do not invent percentages.',
  })
  progress!: ImportProgressDto | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Current processing execution after confirmation.',
  })
  executionId!: string | null;

  @ApiPropertyOptional({
    type: ImportFailureDto,
    nullable: true,
    description:
      'Public failure details when status is processing_failed; otherwise null.',
  })
  failure!: ImportFailureDto | null;

  @ApiPropertyOptional({
    example: '2026-09-02T12:00:00.000Z',
    nullable: true,
  })
  uploadedAt!: string | null;

  @ApiPropertyOptional({
    example: '2026-09-02T12:05:00.000Z',
    nullable: true,
  })
  confirmedAt!: string | null;

  @ApiProperty({ example: '2026-09-02T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-02T12:00:00.000Z' })
  updatedAt!: string;
}
