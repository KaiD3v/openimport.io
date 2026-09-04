import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const TRACE_ID_EXAMPLE = 'req_11111111-1111-1111-1111-111111111111';

export class WebhookEndpointNotFoundErrorDto {
  @ApiProperty({ example: 'WEBHOOK.ENDPOINT_NOT_FOUND' })
  code!: string;

  @ApiProperty({ example: 'Webhook endpoint not found.' })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}

export class WebhookUrlUnsafeErrorDto {
  @ApiProperty({ example: 'WEBHOOK.URL_UNSAFE' })
  code!: string;

  @ApiProperty({ example: 'Webhook URL is not allowed.' })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;

  @ApiProperty({ example: TRACE_ID_EXAMPLE })
  traceId!: string;
}
