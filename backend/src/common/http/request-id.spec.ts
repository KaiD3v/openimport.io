import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import {
  isValidRequestId,
  resolveRequestId,
} from './request-id.js';

function fakeRequest(
  headers: Request['headers'],
  id?: string,
): Request {
  return { headers, id } as Request;
}

describe('isValidRequestId', () => {
  it('accepts a generated request id', () => {
    expect(
      isValidRequestId('req_11111111-1111-1111-1111-111111111111'),
    ).toBe(true);
  });

  it('rejects empty, oversized, and unsafe values', () => {
    expect(isValidRequestId('')).toBe(false);
    expect(isValidRequestId('x'.repeat(129))).toBe(false);
    expect(isValidRequestId('../etc/passwd')).toBe(false);
    expect(isValidRequestId('has spaces')).toBe(false);
    expect(isValidRequestId('id;drop')).toBe(false);
  });
});

describe('resolveRequestId', () => {
  it('reuses a valid incoming X-Request-ID', () => {
    const incoming = 'req_11111111-1111-1111-1111-111111111111';

    expect(
      resolveRequestId(fakeRequest({ 'x-request-id': incoming })),
    ).toBe(incoming);
  });

  it('generates a new id when the incoming value is invalid', () => {
    const incoming = '../etc/passwd';
    const resolved = resolveRequestId(
      fakeRequest({ 'x-request-id': incoming }),
    );

    expect(resolved).not.toBe(incoming);
    expect(resolved.startsWith('req_')).toBe(true);
    expect(isValidRequestId(resolved)).toBe(true);
  });

  it('generates a new id when the incoming value is too long', () => {
    const incoming = 'a'.repeat(200);
    const resolved = resolveRequestId(
      fakeRequest({ 'x-request-id': incoming }),
    );

    expect(resolved).not.toBe(incoming);
    expect(resolved.length).toBeLessThanOrEqual(128);
  });

  it('does not trust an already assigned invalid req.id', () => {
    const incoming = 'not valid!!';
    const resolved = resolveRequestId(
      fakeRequest({ 'x-request-id': incoming }, incoming),
    );

    expect(resolved).not.toBe(incoming);
  });
});
