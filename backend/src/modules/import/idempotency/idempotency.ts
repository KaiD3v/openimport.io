import { createHash } from 'node:crypto';

export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

export class IdempotencyKeyError extends Error {
  readonly code = 'VALIDATION.FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyKeyError';
  }
}

export function assertIdempotencyKey(
  value: string | string[] | undefined | null,
): string {
  if (value === undefined || value === null) {
    throw new IdempotencyKeyError(
      'Idempotency-Key header is required.',
    );
  }

  const key = Array.isArray(value) ? value[0] : value;
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new IdempotencyKeyError(
      'Idempotency-Key header must not be empty.',
    );
  }

  if (key.length < IDEMPOTENCY_KEY_MIN_LENGTH) {
    throw new IdempotencyKeyError(
      `Idempotency-Key must be at least ${IDEMPOTENCY_KEY_MIN_LENGTH} characters.`,
    );
  }

  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new IdempotencyKeyError(
      `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
    );
  }

  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new IdempotencyKeyError(
      'Idempotency-Key contains invalid characters.',
    );
  }

  return key;
}

export function hashIdempotencyKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function fingerprintCreateImportRequest(payload: {
  templateId: string;
}): string {
  const canonical = JSON.stringify({ templateId: payload.templateId });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
