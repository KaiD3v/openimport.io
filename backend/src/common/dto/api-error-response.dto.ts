import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const TRACE_ID_EXAMPLE = 'req_11111111-1111-1111-1111-111111111111';

export class ApiErrorResponseDto {
  @ApiProperty({ example: 'INTERNAL.UNEXPECTED' })
  code!: string;

  @ApiProperty({ example: 'Something went wrong.' })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ValidationFailedErrorDto {
  @ApiProperty({ example: 'VALIDATION.FAILED' })
  code!: string;

  @ApiProperty({ example: 'Request validation failed.' })
  message!: string;

  @ApiPropertyOptional({
    example: [
      {
        field: 'name',
        constraints: { isString: 'name must be a string' },
      },
    ],
  })
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class UnauthorizedErrorDto {
  @ApiProperty({ example: 'AUTH.MISSING_BEARER' })
  code!: string;

  @ApiProperty({
    example: 'Authorization header must contain a Bearer credential.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class ForbiddenErrorDto {
  @ApiProperty({ example: 'AUTH.INSUFFICIENT_SCOPE' })
  code!: string;

  @ApiProperty({
    example: 'This credential cannot access this resource.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class RateLimitExceededErrorDto {
  @ApiProperty({ example: 'RATE_LIMIT.EXCEEDED' })
  code!: string;

  @ApiProperty({ example: 'Too many requests.' })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

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

export class TemplateNameConflictErrorDto {
  @ApiProperty({ example: 'TEMPLATE.NAME_CONFLICT' })
  code!: string;

  @ApiProperty({
    example: 'A template with this name already exists in the organization.',
  })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class InvalidUuidParamErrorDto {
  @ApiProperty({ example: 'VALIDATION.FAILED' })
  code!: string;

  @ApiProperty({ example: 'Request validation failed.' })
  message!: string;

  @ApiPropertyOptional({
    example: [
      {
        field: 'templateId',
        constraints: { isUuid: 'templateId must be a UUID' },
      },
    ],
  })
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}
