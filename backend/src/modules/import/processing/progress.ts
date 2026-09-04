export type ProgressCounters = {
  processedRows: number;
  totalRows: number | null;
  validRows: number;
  invalidRows: number;
};

export function emptyProgress(totalRows: number | null): ProgressCounters {
  return {
    processedRows: 0,
    totalRows,
    validRows: 0,
    invalidRows: 0,
  };
}

/**
 * Progress must never decrease. Batch updates apply only if the new
 * processedRows is greater than or equal to the previous value.
 */
export function mergeMonotonicProgress(
  current: ProgressCounters,
  next: ProgressCounters,
): ProgressCounters {
  if (next.processedRows < current.processedRows) {
    return current;
  }

  return {
    processedRows: next.processedRows,
    totalRows: next.totalRows ?? current.totalRows,
    validRows: Math.max(current.validRows, next.validRows),
    invalidRows: Math.max(current.invalidRows, next.invalidRows),
  };
}

export function applyBatchDelta(
  current: ProgressCounters,
  delta: { valid: number; invalid: number },
): ProgressCounters {
  const processedRows = current.processedRows + delta.valid + delta.invalid;
  return {
    processedRows,
    totalRows: current.totalRows,
    validRows: current.validRows + delta.valid,
    invalidRows: current.invalidRows + delta.invalid,
  };
}
