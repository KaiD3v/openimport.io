import { createHash } from 'node:crypto';

export type ReportResultsFingerprintItem = {
  recordNumber: number;
  outcome: 'accepted' | 'rejected';
  clientRecordId?: string | null;
  error?: { code: string; message: string } | null;
};

/**
 * Canonical fingerprint for result-batch idempotency.
 * Items are sorted by recordNumber so request order does not change the hash.
 */
export function fingerprintReportResultsRequest(payload: {
  executionId: string;
  results: ReportResultsFingerprintItem[];
}): string {
  const results = [...payload.results]
    .map((item) => ({
      recordNumber: item.recordNumber,
      outcome: item.outcome,
      clientRecordId: item.clientRecordId ?? null,
      error:
        item.outcome === 'rejected' && item.error
          ? { code: item.error.code, message: item.error.message }
          : null,
    }))
    .sort((left, right) => left.recordNumber - right.recordNumber);

  const canonical = JSON.stringify({
    executionId: payload.executionId,
    results,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
