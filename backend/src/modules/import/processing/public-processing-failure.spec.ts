import { describe, expect, it } from 'vitest';
import {
  PUBLIC_PROCESSING_FAILURE_CODES,
  toPublicProcessingFailure,
} from './public-processing-failure.js';

describe('toPublicProcessingFailure', () => {
  it('returns null when there is no failure code', () => {
    expect(toPublicProcessingFailure(null, null)).toBeNull();
    expect(toPublicProcessingFailure(undefined, 'x')).toBeNull();
  });

  it('returns a canned public message for known codes', () => {
    for (const code of PUBLIC_PROCESSING_FAILURE_CODES) {
      const failure = toPublicProcessingFailure(code, 'internal sdk boom redis://secret');
      expect(failure).toEqual({
        code,
        message: expect.any(String),
      });
      expect(failure!.message).not.toMatch(/redis|sdk|secret|sql|stack/i);
    }
  });

  it('maps unknown codes to IMPORT.PROCESSING_FAILED without leaking internals', () => {
    const failure = toPublicProcessingFailure(
      'AWS.S3.NoSuchKey',
      'https://minio.local/bucket/key?token=abc',
    );
    expect(failure).toEqual({
      code: 'IMPORT.PROCESSING_FAILED',
      message: expect.stringMatching(/failed/i),
    });
    expect(failure!.message).not.toContain('minio');
    expect(failure!.message).not.toContain('token=abc');
  });
});
