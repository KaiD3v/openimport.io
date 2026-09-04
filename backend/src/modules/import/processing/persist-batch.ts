import type { FieldError } from '../normalize/normalize.js';

export type PersistableRecord = {
  recordNumber: number;
  classification: 'valid' | 'invalid';
  payload: Record<string, string | number> | null;
  errors: FieldError[] | null;
};

export function buildPersistBatch(
  pending: PersistableRecord[],
  batchSize: number,
): { flush: PersistableRecord[]; rest: PersistableRecord[] } {
  if (pending.length < batchSize) {
    return { flush: [], rest: pending };
  }
  return {
    flush: pending.slice(0, batchSize),
    rest: pending.slice(batchSize),
  };
}

export function classifyNormalizedRecord(
  recordNumber: number,
  result: {
    valid: boolean;
    data: Record<string, string | number> | null;
    errors: FieldError[];
  },
): PersistableRecord {
  if (result.valid) {
    return {
      recordNumber,
      classification: 'valid',
      payload: result.data,
      errors: null,
    };
  }
  return {
    recordNumber,
    classification: 'invalid',
    payload: null,
    errors: result.errors,
  };
}
