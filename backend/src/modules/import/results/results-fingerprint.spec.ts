import { describe, expect, it } from 'vitest';
import { fingerprintReportResultsRequest } from './results-fingerprint.js';

describe('fingerprintReportResultsRequest', () => {
  it('is stable for the same logical payload regardless of item order', () => {
    const executionId = '11111111-1111-4111-8111-111111111111';
    const a = fingerprintReportResultsRequest({
      executionId,
      results: [
        { recordNumber: 3, outcome: 'rejected', error: { code: 'X', message: 'no' } },
        { recordNumber: 1, outcome: 'accepted', clientRecordId: 'c1' },
      ],
    });
    const b = fingerprintReportResultsRequest({
      executionId,
      results: [
        { recordNumber: 1, outcome: 'accepted', clientRecordId: 'c1' },
        { recordNumber: 3, outcome: 'rejected', error: { code: 'X', message: 'no' } },
      ],
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when executionId, outcome, clientRecordId, or error differs', () => {
    const base = {
      executionId: '11111111-1111-4111-8111-111111111111',
      results: [
        {
          recordNumber: 1,
          outcome: 'rejected' as const,
          error: { code: 'A', message: 'm' },
        },
      ],
    };
    const original = fingerprintReportResultsRequest(base);
    expect(
      fingerprintReportResultsRequest({
        ...base,
        executionId: '22222222-2222-4222-8222-222222222222',
      }),
    ).not.toBe(original);
    expect(
      fingerprintReportResultsRequest({
        ...base,
        results: [{ recordNumber: 1, outcome: 'accepted' }],
      }),
    ).not.toBe(original);
    expect(
      fingerprintReportResultsRequest({
        ...base,
        results: [
          {
            recordNumber: 1,
            outcome: 'rejected',
            clientRecordId: 'other',
            error: { code: 'A', message: 'm' },
          },
        ],
      }),
    ).not.toBe(original);
    expect(
      fingerprintReportResultsRequest({
        ...base,
        results: [
          {
            recordNumber: 1,
            outcome: 'rejected',
            error: { code: 'B', message: 'm' },
          },
        ],
      }),
    ).not.toBe(original);
  });
});
