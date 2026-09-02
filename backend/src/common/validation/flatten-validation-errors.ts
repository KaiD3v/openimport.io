import type { ValidationError } from '@nestjs/common';

export type FieldError = {
  field: string;
  constraints: Record<string, string>;
};

export function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own: FieldError[] = error.constraints
      ? [{ field, constraints: error.constraints }]
      : [];
    const nested = error.children?.length
      ? flattenValidationErrors(error.children, field)
      : [];
    return [...own, ...nested];
  });
}
