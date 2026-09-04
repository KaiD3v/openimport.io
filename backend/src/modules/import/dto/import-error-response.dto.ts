import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const TRACE_ID_EXAMPLE = 'req_11111111-1111-1111-1111-111111111111';

export class TemplateNotFoundErrorDto {
  @ApiProperty({ example: 'TEMPLATE.NOT_FOUND' })
  code!: string;

  @ApiProperty({ example: 'Template not found.' })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportNotFoundErrorDto {
  @ApiProperty({ example: 'IMPORT.NOT_FOUND' })
  code!: string;

  @ApiProperty({ example: 'Import session not found.' })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class IdempotencyKeyReusedErrorDto {
  @ApiProperty({ example: 'IDEMPOTENCY.KEY_REUSED' })
  code!: string;

  @ApiProperty({
    example:
      'Idempotency-Key was already used with a different request payload.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportFileAlreadyUploadedErrorDto {
  @ApiProperty({ example: 'IMPORT.FILE_ALREADY_UPLOADED' })
  code!: string;

  @ApiProperty({
    example: 'This import session already has an uploaded file.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportUploadNotAllowedErrorDto {
  @ApiProperty({ example: 'IMPORT.UPLOAD_NOT_ALLOWED' })
  code!: string;

  @ApiProperty({
    example: 'This import session can no longer accept a file upload.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportFileTooLargeErrorDto {
  @ApiProperty({ example: 'IMPORT.FILE_TOO_LARGE' })
  code!: string;

  @ApiProperty({
    example: 'Uploaded file exceeds the configured size limit.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportInvalidCsvErrorDto {
  @ApiProperty({ example: 'IMPORT.INVALID_CSV' })
  code!: string;

  @ApiProperty({ example: 'CSV is malformed.' })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportMappingNotAllowedErrorDto {
  @ApiProperty({ example: 'IMPORT.MAPPING_NOT_ALLOWED' })
  code!: string;

  @ApiProperty({
    example:
      'Column mapping is only available after a CSV file has been uploaded.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportMappingRevisionConflictErrorDto {
  @ApiProperty({ example: 'IMPORT.MAPPING_REVISION_CONFLICT' })
  code!: string;

  @ApiProperty({
    example:
      'Mapping revision is out of date. GET the mapping and retry with the current revision.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportMappingInvalidErrorDto {
  @ApiProperty({ example: 'IMPORT.MAPPING_INVALID' })
  code!: string;

  @ApiProperty({
    example: 'Field key "unknown" is not part of this session template.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportPreviewNotAllowedErrorDto {
  @ApiProperty({ example: 'IMPORT.PREVIEW_NOT_ALLOWED' })
  code!: string;

  @ApiProperty({
    example: 'Preview is only available after a CSV file has been uploaded.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportMappingIncompleteErrorDto {
  @ApiProperty({ example: 'IMPORT.MAPPING_INCOMPLETE' })
  code!: string;

  @ApiProperty({
    example:
      'Preview requires every required template field to be mapped.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportFileChangedErrorDto {
  @ApiProperty({ example: 'IMPORT.FILE_CHANGED' })
  code!: string;

  @ApiProperty({
    example: 'Stored file no longer matches the upload metadata.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportPreviewUnavailableErrorDto {
  @ApiProperty({ example: 'IMPORT.PREVIEW_UNAVAILABLE' })
  code!: string;

  @ApiProperty({
    example: 'The import file could not be read for preview.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportConfirmationNotAllowedErrorDto {
  @ApiProperty({ example: 'IMPORT.CONFIRMATION_NOT_ALLOWED' })
  code!: string;

  @ApiProperty({
    example:
      'Confirmation is only available for uploaded sessions with a complete mapping.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportProcessingUnavailableErrorDto {
  @ApiProperty({ example: 'IMPORT.PROCESSING_UNAVAILABLE' })
  code!: string;

  @ApiProperty({
    example: 'Import processing queue is temporarily unavailable.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ImportSnapshotNotReadyErrorDto {
  @ApiProperty({ example: 'IMPORT.SNAPSHOT_NOT_READY' })
  code!: string;

  @ApiProperty({
    example: 'Rejected rows are available only after processing completes.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}
