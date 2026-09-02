import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { flattenValidationErrors } from './flatten-validation-errors.js';

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: 'VALIDATION.FAILED',
        message: 'Request validation failed.',
        details: flattenValidationErrors(errors),
      }),
  });
}
