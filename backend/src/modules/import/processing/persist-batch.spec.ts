import { describe, expect, it } from 'vitest';
import {
  buildPersistBatch,
  classifyNormalizedRecord,
} from './persist-batch.js';

describe('persist batch', () => {
  it('does not flush until the batch size is reached', () => {
    const pending = [
      classifyNormalizedRecord(1, {
        valid: true,
        data: { sku: 'A' },
        errors: [],
      }),
    ];
    expect(buildPersistBatch(pending, 2)).toEqual({
      flush: [],
      rest: pending,
    });
  });

  it('flushes exact batches and keeps the remainder', () => {
    const pending = [1, 2, 3].map((recordNumber) =>
      classifyNormalizedRecord(recordNumber, {
        valid: false,
        data: null,
        errors: [
          {
            fieldKey: 'sku',
            code: 'FIELD.REQUIRED',
            message: 'This field is required.',
          },
        ],
      }),
    );
    expect(buildPersistBatch(pending, 2)).toEqual({
      flush: pending.slice(0, 2),
      rest: pending.slice(2),
    });
  });

  it('classifies valid and invalid normalized records', () => {
    expect(
      classifyNormalizedRecord(1, {
        valid: true,
        data: { sku: 'X' },
        errors: [],
      }),
    ).toMatchObject({
      classification: 'valid',
      payload: { sku: 'X' },
      errors: null,
    });
    expect(
      classifyNormalizedRecord(2, {
        valid: false,
        data: null,
        errors: [
          {
            fieldKey: 'priceInCents',
            code: 'FIELD.INVALID_CURRENCY',
            message: 'Value must be a currency amount in pt-BR format.',
          },
        ],
      }),
    ).toMatchObject({
      classification: 'invalid',
      payload: null,
    });
  });
});
