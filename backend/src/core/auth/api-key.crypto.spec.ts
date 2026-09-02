import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  API_KEY_PREFIX,
  apiKeyPrefix,
  assertBootstrapApiKey,
  generateApiKey,
  hashApiKey,
} from './api-key.crypto.js';

function expectRejectedWithoutEchoing(
  value: string,
  expectedMessage: RegExp,
): void {
  expect(() => assertBootstrapApiKey(value)).toThrow(expectedMessage);
  try {
    assertBootstrapApiKey(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain(value);
  }
}

describe('api-key crypto', () => {
  it('hashes a key with SHA-256 and never returns the plaintext', () => {
    const rawKey = `${API_KEY_PREFIX}${'ab'.repeat(32)}`;

    const digest = hashApiKey(rawKey);

    expect(digest).toBe(createHash('sha256').update(rawKey, 'utf8').digest('hex'));
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(rawKey);
    expect(digest).not.toContain(API_KEY_PREFIX);
  });

  it('produces a deterministic hash for the same input', () => {
    const rawKey = generateApiKey();

    expect(hashApiKey(rawKey)).toBe(hashApiKey(rawKey));
  });

  it('generates a high-entropy key with a stable diagnostic prefix', () => {
    const rawKey = generateApiKey();

    expect(rawKey.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(rawKey.length).toBeGreaterThanOrEqual(API_KEY_PREFIX.length + 64);
    expect(apiKeyPrefix(rawKey)).toBe(rawKey.slice(0, 16));
    expect(apiKeyPrefix(rawKey)).not.toBe(rawKey);
  });

  it('does not collide across generated keys', () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateApiKey()));

    expect(keys.size).toBe(20);
  });
});

describe('assertBootstrapApiKey', () => {
  it('accepts a generated key', () => {
    const rawKey = generateApiKey();

    expect(assertBootstrapApiKey(rawKey)).toBe(rawKey);
  });

  it('rejects an empty key', () => {
    expect(() => assertBootstrapApiKey(undefined)).toThrow(
      /SEED_API_KEY is missing or empty/,
    );
    expect(() => assertBootstrapApiKey('')).toThrow(
      /SEED_API_KEY is missing or empty/,
    );
  });

  it('rejects a short key', () => {
    expectRejectedWithoutEchoing('oi_live_abc', /SEED_API_KEY/);
  });

  it('rejects the documented placeholder', () => {
    expectRejectedWithoutEchoing(
      'oi_live_replace_with_a_high_entropy_random_key',
      /placeholder/,
    );
  });

  it('rejects a key with the wrong prefix', () => {
    expectRejectedWithoutEchoing(
      `oi_test_${'ab'.repeat(32)}`,
      /oi_live_/,
    );
  });

  it('rejects a key with the wrong hex length', () => {
    expectRejectedWithoutEchoing(`${API_KEY_PREFIX}${'ab'.repeat(31)}`, /64/);
    expectRejectedWithoutEchoing(
      `${API_KEY_PREFIX}${'ab'.repeat(32)}ff`,
      /64/,
    );
  });

  it('rejects non-hexadecimal characters after the prefix', () => {
    expectRejectedWithoutEchoing(
      `${API_KEY_PREFIX}${'g'.repeat(64)}`,
      /hexadecimal/,
    );
  });

  it('rejects whitespace anywhere in the key', () => {
    const valid = generateApiKey();
    expectRejectedWithoutEchoing(` ${valid}`, /whitespace/);
    expectRejectedWithoutEchoing(`${valid}\n`, /whitespace/);
  });
});
