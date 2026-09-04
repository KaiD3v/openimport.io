import { describe, expect, it } from 'vitest';
import {
  decodeRejectedRowsCursor,
  encodeRejectedRowsCursor,
} from './rejected-rows-cursor.js';

describe('rejected rows cursor', () => {
  it('round-trips a record number', () => {
    expect(decodeRejectedRowsCursor(encodeRejectedRowsCursor(42))).toBe(42);
  });

  it('rejects malformed cursors', () => {
    expect(() => decodeRejectedRowsCursor('not-a-cursor')).toThrow(
      /INVALID_CURSOR/,
    );
    expect(() =>
      decodeRejectedRowsCursor(Buffer.from('rn:-1', 'utf8').toString('base64url')),
    ).toThrow(/INVALID_CURSOR/);
  });
});
