import { describe, expect, it } from 'vitest';
import {
  confirmationFingerprint,
  confirmationJobId,
  isContentSha256,
  snapshotsMatch,
} from './confirmation-fingerprint.js';

describe('confirmation fingerprint', () => {
  it('accepts lowercase 64-hex SHA-256 digests only', () => {
    expect(isContentSha256('a'.repeat(64))).toBe(true);
    expect(isContentSha256('A'.repeat(64))).toBe(false);
    expect(isContentSha256('a'.repeat(63))).toBe(false);
    expect(isContentSha256('g'.repeat(64))).toBe(false);
  });

  it('is stable for the same confirmation snapshot', () => {
    const snapshot = {
      expectedMappingRevision: 1,
      expectedContentSha256: 'b'.repeat(64),
    };
    expect(confirmationFingerprint(snapshot)).toBe(
      confirmationFingerprint(snapshot),
    );
  });

  it('changes when revision or hash changes', () => {
    const base = {
      expectedMappingRevision: 1,
      expectedContentSha256: 'c'.repeat(64),
    };
    expect(
      confirmationFingerprint({
        ...base,
        expectedMappingRevision: 2,
      }),
    ).not.toBe(confirmationFingerprint(base));
    expect(
      confirmationFingerprint({
        ...base,
        expectedContentSha256: 'd'.repeat(64),
      }),
    ).not.toBe(confirmationFingerprint(base));
  });

  it('compares snapshots by revision and hash', () => {
    const left = {
      expectedMappingRevision: 3,
      expectedContentSha256: 'e'.repeat(64),
    };
    expect(snapshotsMatch(left, { ...left })).toBe(true);
    expect(
      snapshotsMatch(left, {
        ...left,
        expectedMappingRevision: 4,
      }),
    ).toBe(false);
  });

  it('builds a deterministic BullMQ job id from session and fingerprint', () => {
    const fingerprint = 'f'.repeat(64);
    expect(
      confirmationJobId('11111111-1111-4111-8111-111111111111', fingerprint),
    ).toBe(
      `import-process.11111111-1111-4111-8111-111111111111.${fingerprint}`,
    );
  });
});
