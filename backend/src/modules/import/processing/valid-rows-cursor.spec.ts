import { describe, expect, it } from 'vitest';
import {
  decodeValidRowsCursor,
  encodeValidRowsCursor,
} from './valid-rows-cursor.js';

const executionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const otherExecutionId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('valid-rows cursor', () => {
  it('round-trips version, executionId, and recordNumber', () => {
    const encoded = encodeValidRowsCursor({
      executionId,
      recordNumber: 42,
    });
    expect(decodeValidRowsCursor(encoded)).toEqual({
      version: 1,
      executionId,
      recordNumber: 42,
    });
  });

  it('rejects a malformed cursor', () => {
    expect(() => decodeValidRowsCursor('not-a-cursor')).toThrow('INVALID_CURSOR');
  });

  it('rejects an unknown version', () => {
    const cursor = Buffer.from(
      `v2:${executionId}:1`,
      'utf8',
    ).toString('base64url');
    expect(() => decodeValidRowsCursor(cursor)).toThrow('INVALID_CURSOR');
  });

  it('rejects an invalid recordNumber', () => {
    const negative = Buffer.from(
      `v1:${executionId}:-1`,
      'utf8',
    ).toString('base64url');
    expect(() => decodeValidRowsCursor(negative)).toThrow('INVALID_CURSOR');

    const decimal = Buffer.from(
      `v1:${executionId}:1.5`,
      'utf8',
    ).toString('base64url');
    expect(() => decodeValidRowsCursor(decimal)).toThrow('INVALID_CURSOR');
  });

  it('rejects a cursor whose executionId is not a UUID', () => {
    const cursor = Buffer.from('v1:not-a-uuid:1', 'utf8').toString('base64url');
    expect(() => decodeValidRowsCursor(cursor)).toThrow('INVALID_CURSOR');
  });

  it('preserves distinct execution ids without silently equating them', () => {
    const a = decodeValidRowsCursor(
      encodeValidRowsCursor({ executionId, recordNumber: 1 }),
    );
    const b = decodeValidRowsCursor(
      encodeValidRowsCursor({
        executionId: otherExecutionId,
        recordNumber: 1,
      }),
    );
    expect(a.executionId).not.toBe(b.executionId);
  });
});
