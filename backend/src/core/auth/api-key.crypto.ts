import { createHash, randomBytes } from 'node:crypto';

export const API_KEY_PREFIX = 'oi_live_';
export const API_KEY_PREFIX_LENGTH = 16;
const KEY_ENTROPY_BYTES = 32;
const BOOTSTRAP_API_KEY_HEX_LENGTH = KEY_ENTROPY_BYTES * 2;
const BOOTSTRAP_API_KEY_PATTERN = new RegExp(
  `^${API_KEY_PREFIX}[0-9a-f]{${BOOTSTRAP_API_KEY_HEX_LENGTH}}$`,
);
const BOOTSTRAP_API_KEY_PLACEHOLDERS = new Set([
  'oi_live_replace_with_a_high_entropy_random_key',
]);

export function assertBootstrapApiKey(
  value: string | undefined,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error('SEED_API_KEY is missing or empty.');
  }

  if (BOOTSTRAP_API_KEY_PLACEHOLDERS.has(value)) {
    throw new Error(
      'SEED_API_KEY is a placeholder. Generate a high-entropy key instead.',
    );
  }

  if (/\s/.test(value)) {
    throw new Error('SEED_API_KEY must not contain whitespace.');
  }

  if (!BOOTSTRAP_API_KEY_PATTERN.test(value)) {
    throw new Error(
      `SEED_API_KEY must start with ${API_KEY_PREFIX} followed by exactly ${BOOTSTRAP_API_KEY_HEX_LENGTH} hexadecimal characters.`,
    );
  }

  return value;
}

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(KEY_ENTROPY_BYTES).toString('hex')}`;
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

export function apiKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, API_KEY_PREFIX_LENGTH);
}
