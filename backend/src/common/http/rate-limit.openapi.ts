import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { RateLimitExceededErrorDto } from '../dto/api-error-response.dto.js';

export function ApiRateLimited() {
  return applyDecorators(
    ApiResponse({
      status: 429,
      description:
        'RATE_LIMIT.EXCEEDED — fixed window exceeded for this client identity and operation tier. Response includes Retry-After (seconds).',
      type: RateLimitExceededErrorDto,
      headers: {
        'Retry-After': {
          description: 'Seconds until the rate-limit window resets.',
          schema: { type: 'string', example: '42' },
        },
        'X-Request-ID': {
          description: 'Correlation id (matches body.traceId).',
          schema: { type: 'string' },
        },
      },
    }),
  );
}
