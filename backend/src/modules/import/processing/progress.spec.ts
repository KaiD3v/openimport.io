import { describe, expect, it } from 'vitest';
import {
  applyBatchDelta,
  emptyProgress,
  mergeMonotonicProgress,
} from './progress.js';

describe('processing progress', () => {
  it('starts empty with optional totalRows', () => {
    expect(emptyProgress(100)).toEqual({
      processedRows: 0,
      totalRows: 100,
      validRows: 0,
      invalidRows: 0,
    });
    expect(emptyProgress(null).totalRows).toBeNull();
  });

  it('applies batch deltas', () => {
    const next = applyBatchDelta(emptyProgress(10), { valid: 3, invalid: 1 });
    expect(next).toEqual({
      processedRows: 4,
      totalRows: 10,
      validRows: 3,
      invalidRows: 1,
    });
  });

  it('keeps progress monotonic when a stale update arrives', () => {
    const current = {
      processedRows: 40,
      totalRows: 100,
      validRows: 35,
      invalidRows: 5,
    };
    const stale = {
      processedRows: 20,
      totalRows: 100,
      validRows: 18,
      invalidRows: 2,
    };
    expect(mergeMonotonicProgress(current, stale)).toEqual(current);
  });

  it('accepts a forward update', () => {
    const current = emptyProgress(50);
    const next = {
      processedRows: 10,
      totalRows: 50,
      validRows: 8,
      invalidRows: 2,
    };
    expect(mergeMonotonicProgress(current, next)).toEqual(next);
  });
});
