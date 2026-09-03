import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  IMPORT_ACCESS_TOKEN_PREFIX,
  generateImportAccessToken,
  hashImportAccessToken,
  importAccessTokenPrefix,
  isImportAccessToken,
} from './import-access-token.crypto.js';

describe('import-access-token crypto', () => {
  it('generates an opaque token with the import prefix and at least 256 bits of entropy', () => {
    const raw = generateImportAccessToken();

    expect(raw.startsWith(IMPORT_ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(raw.length).toBe(IMPORT_ACCESS_TOKEN_PREFIX.length + 64);
    expect(raw.slice(IMPORT_ACCESS_TOKEN_PREFIX.length)).toMatch(/^[0-9a-f]{64}$/);
    expect(isImportAccessToken(raw)).toBe(true);
  });

  it('does not collide across generated tokens', () => {
    const tokens = new Set(
      Array.from({ length: 20 }, () => generateImportAccessToken()),
    );
    expect(tokens.size).toBe(20);
  });

  it('hashes with SHA-256 and never returns the plaintext or prefix', () => {
    const raw = generateImportAccessToken();
    const digest = hashImportAccessToken(raw);

    expect(digest).toBe(createHash('sha256').update(raw, 'utf8').digest('hex'));
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(raw);
    expect(digest).not.toContain(IMPORT_ACCESS_TOKEN_PREFIX);
  });

  it('produces a deterministic hash for the same input', () => {
    const raw = generateImportAccessToken();
    expect(hashImportAccessToken(raw)).toBe(hashImportAccessToken(raw));
  });

  it('stores only a short diagnostic prefix, never the secret', () => {
    const raw = generateImportAccessToken();
    const prefix = importAccessTokenPrefix(raw);

    expect(prefix).toHaveLength(24);
    expect(prefix.startsWith(IMPORT_ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(prefix).not.toBe(raw);
    expect(raw.startsWith(prefix)).toBe(true);
  });

  it('does not treat organization API keys as import access tokens', () => {
    expect(
      isImportAccessToken(
        'oi_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toBe(false);
    expect(isImportAccessToken('Bearer oi_import_abc')).toBe(false);
    expect(isImportAccessToken('')).toBe(false);
  });
});
