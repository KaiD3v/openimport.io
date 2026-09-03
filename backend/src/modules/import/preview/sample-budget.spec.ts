import { describe, expect, it } from 'vitest';
import {
  PREVIEW_MAX_RESPONSE_BYTES,
  canAppendPreviewRow,
  jsonUtf8Bytes,
  trimPreviewToBudget,
  widestCountToken,
  type PreviewBudgetEnvelope,
} from './sample-budget.js';

function baseEnvelope(
  rows: unknown[] = [],
): PreviewBudgetEnvelope {
  return {
    importId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    mappingRevision: 1,
    contentSha256: 'a'.repeat(64),
    normalizationProfile: 'pt-BR-v1',
    summary: { totalRows: 0, validRows: 0, invalidRows: 0 },
    limit: 20,
    sampleTruncated: false,
    rows,
  };
}

describe('jsonUtf8Bytes', () => {
  it('counts UTF-8 bytes of JSON, including unicode and escapes', () => {
    expect(jsonUtf8Bytes({ sku: 'é' })).toBe(
      Buffer.byteLength(JSON.stringify({ sku: 'é' }), 'utf8'),
    );
    expect(jsonUtf8Bytes({ sku: 'é' })).toBeGreaterThan(
      jsonUtf8Bytes({ sku: 'e' }),
    );
    expect(jsonUtf8Bytes({ note: 'a"b' })).toBe(
      Buffer.byteLength('{"note":"a\\"b"}', 'utf8'),
    );
  });
});

describe('widestCountToken', () => {
  it('uses the digit width of the persisted or configured maximum count', () => {
    expect(widestCountToken(9)).toBe(9);
    expect(widestCountToken(10)).toBe(99);
    expect(widestCountToken(999_999)).toBe(999_999);
    expect(widestCountToken(10_000_000)).toBe(99_999_999);
  });
});

describe('canAppendPreviewRow', () => {

  it('accepts rows while under the byte budget and rejects the first overflow', () => {
    const envelope = baseEnvelope();
    const small = {
      recordNumber: 1,
      valid: true,
      data: { sku: 'A1' },
      errors: [],
    };
    expect(
      canAppendPreviewRow(envelope, small, { maxCount: 10, maxBytes: 400 }),
    ).toBe(true);

    const huge = {
      recordNumber: 1,
      valid: true,
      data: { sku: 'x'.repeat(500) },
      errors: [],
    };
    expect(
      canAppendPreviewRow(envelope, huge, { maxCount: 10, maxBytes: 400 }),
    ).toBe(false);
  });

  it('accounts for seven-or-more-digit counters without scanning millions of rows', () => {
    const row = {
      recordNumber: 1,
      valid: true,
      data: { sku: 'A' },
      errors: [],
    };
    const envelope = baseEnvelope();
    const maxBytes = jsonUtf8Bytes({
      ...envelope,
      summary: {
        totalRows: 999_999,
        validRows: 999_999,
        invalidRows: 999_999,
      },
      sampleTruncated: false,
      rows: [row],
    });

    expect(
      canAppendPreviewRow(envelope, row, {
        maxCount: 999_999,
        maxBytes,
      }),
    ).toBe(true);
    expect(
      canAppendPreviewRow(envelope, row, {
        maxCount: 10_000_000,
        maxBytes,
      }),
    ).toBe(false);
  });

  it('rejects a first row that exceeds the budget by itself', () => {
    const envelope = baseEnvelope();
    const huge = {
      recordNumber: 1,
      valid: true,
      data: { sku: 'x'.repeat(200) },
      errors: [],
    };
    expect(
      canAppendPreviewRow(envelope, huge, { maxCount: 3, maxBytes: 80 }),
    ).toBe(false);
  });
});

describe('trimPreviewToBudget', () => {
  it('keeps a payload that is exactly at the limit and trims one byte over', () => {
    const row = {
      recordNumber: 1,
      valid: true,
      data: { sku: 'A1' },
      errors: [] as unknown[],
    };
    const exact = {
      ...baseEnvelope([row]),
      summary: { totalRows: 2, validRows: 2, invalidRows: 0 },
      sampleTruncated: true,
    };
    const maxBytes = jsonUtf8Bytes(exact);
    expect(jsonUtf8Bytes(trimPreviewToBudget(exact, maxBytes))).toBe(maxBytes);

    const over = {
      ...baseEnvelope([
        row,
        { recordNumber: 2, valid: true, data: { sku: 'B2' }, errors: [] },
      ]),
      summary: { totalRows: 2, validRows: 2, invalidRows: 0 },
      sampleTruncated: false,
    };
    const oneByteOver = jsonUtf8Bytes(over) - 1;
    const trimmed = trimPreviewToBudget(over, oneByteOver);
    expect(jsonUtf8Bytes(trimmed)).toBeLessThanOrEqual(oneByteOver);
    expect(trimmed.rows).toHaveLength(1);
    expect(trimmed.rows[0]).toEqual(row);
    expect(trimmed.sampleTruncated).toBe(true);
    expect(trimmed.summary).toEqual({ totalRows: 2, validRows: 2, invalidRows: 0 });
  });

  it('drops the first row when it alone exceeds the budget and keeps summary', () => {
    const huge = {
      recordNumber: 1,
      valid: true,
      data: { sku: 'é'.repeat(50) },
      errors: [],
    };
    const emptyFit = {
      ...baseEnvelope(),
      summary: { totalRows: 4, validRows: 4, invalidRows: 0 },
      sampleTruncated: true,
      rows: [] as unknown[],
    };
    const maxBytes = jsonUtf8Bytes(emptyFit);
    const response = {
      ...emptyFit,
      sampleTruncated: false,
      rows: [huge],
    };
    const trimmed = trimPreviewToBudget(response, maxBytes);
    expect(trimmed.rows).toEqual([]);
    expect(trimmed.sampleTruncated).toBe(true);
    expect(trimmed.summary.totalRows).toBe(4);
    expect(jsonUtf8Bytes(trimmed)).toBeLessThanOrEqual(maxBytes);
  });
});

describe('PREVIEW_MAX_RESPONSE_BYTES', () => {
  it('remains 1 MiB', () => {
    expect(PREVIEW_MAX_RESPONSE_BYTES).toBe(1_048_576);
  });
});
