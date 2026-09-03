export const PREVIEW_DEFAULT_LIMIT = 20;
export const PREVIEW_MAX_LIMIT = 100;
export const PREVIEW_MAX_RESPONSE_BYTES = 1_048_576;

export type PreviewBudgetEnvelope = {
  importId: string;
  mappingRevision: number;
  contentSha256: string;
  normalizationProfile: string;
  summary: { totalRows: number; validRows: number; invalidRows: number };
  limit: number;
  sampleTruncated: boolean;
  rows: unknown[];
};

export type SampleBudgetOptions = {
  maxCount: number;
  maxBytes?: number;
};

export function jsonUtf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function widestCountToken(maxCount: number): number {
  const width = String(Math.max(0, Math.trunc(maxCount))).length;
  return Number.parseInt('9'.repeat(Math.max(width, 1)), 10);
}

export function canAppendPreviewRow(
  envelope: PreviewBudgetEnvelope,
  nextRow: unknown,
  options: SampleBudgetOptions,
): boolean {
  const maxBytes = options.maxBytes ?? PREVIEW_MAX_RESPONSE_BYTES;
  const widest = widestCountToken(options.maxCount);
  const candidate: PreviewBudgetEnvelope = {
    ...envelope,
    summary: {
      totalRows: widest,
      validRows: widest,
      invalidRows: widest,
    },
    sampleTruncated: false,
    rows: [...envelope.rows, nextRow],
  };
  return jsonUtf8Bytes(candidate) <= maxBytes;
}

export function trimPreviewToBudget<T extends PreviewBudgetEnvelope>(
  response: T,
  maxBytes: number = PREVIEW_MAX_RESPONSE_BYTES,
): T {
  while (response.rows.length > 0 && jsonUtf8Bytes(response) > maxBytes) {
    response.rows.pop();
    response.sampleTruncated = true;
  }
  return response;
}
