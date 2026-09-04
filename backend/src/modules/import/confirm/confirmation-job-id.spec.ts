import { describe, expect, it } from 'vitest';
import { confirmationJobId } from '../confirm/confirmation-fingerprint.js';

describe('confirmationJobId format', () => {
  it('is deterministic and avoids colon separators', () => {
    const fingerprint = 'a'.repeat(64);
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const jobId = confirmationJobId(sessionId, fingerprint);

    expect(jobId).toBe(confirmationJobId(sessionId, fingerprint));
    expect(jobId).not.toContain(':');
    expect(jobId).toContain(sessionId);
    expect(jobId).toContain(fingerprint);
  });
});
