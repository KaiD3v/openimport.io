import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  assertIdempotencyKey,
  fingerprintCreateImportRequest,
  hashIdempotencyKey,
} from './idempotency.js';

describe('assertIdempotencyKey', () => {
  it('accepts a valid key', () => {
    expect(assertIdempotencyKey('import-session-001')).toBe(
      'import-session-001',
    );
  });

  it('rejects a missing key', () => {
    expect(() => assertIdempotencyKey(undefined)).toThrow(/Idempotency-Key/);
    expect(() => assertIdempotencyKey(null)).toThrow(/Idempotency-Key/);
  });

  it('rejects an empty key', () => {
    expect(() => assertIdempotencyKey('')).toThrow(/Idempotency-Key/);
    expect(() => assertIdempotencyKey('   ')).toThrow(/Idempotency-Key/);
  });

  it('rejects a key that is too short', () => {
    expect(() => assertIdempotencyKey('short')).toThrow(
      new RegExp(String(IDEMPOTENCY_KEY_MIN_LENGTH)),
    );
  });

  it('rejects a key that is too long', () => {
    expect(() =>
      assertIdempotencyKey('k'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1)),
    ).toThrow(new RegExp(String(IDEMPOTENCY_KEY_MAX_LENGTH)));
  });

  it('rejects invalid characters', () => {
    expect(() => assertIdempotencyKey('bad key!')).toThrow(/Idempotency-Key/);
    expect(() => assertIdempotencyKey('has/slash')).toThrow(/Idempotency-Key/);
  });
});

describe('hashIdempotencyKey', () => {
  it('hashes without returning the plaintext', () => {
    const key = 'stable-idempotency-key';
    const digest = hashIdempotencyKey(key);

    expect(digest).toBe(
      createHash('sha256').update(key, 'utf8').digest('hex'),
    );
    expect(digest).not.toContain(key);
  });
});

describe('fingerprintCreateImportRequest', () => {
  it('is deterministic for the same payload', () => {
    const a = fingerprintCreateImportRequest({
      templateId: '11111111-1111-1111-1111-111111111111',
    });
    const b = fingerprintCreateImportRequest({
      templateId: '11111111-1111-1111-1111-111111111111',
    });

    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('changes when templateId changes', () => {
    const a = fingerprintCreateImportRequest({
      templateId: '11111111-1111-1111-1111-111111111111',
    });
    const b = fingerprintCreateImportRequest({
      templateId: '22222222-2222-2222-2222-222222222222',
    });

    expect(a).not.toBe(b);
  });
});
