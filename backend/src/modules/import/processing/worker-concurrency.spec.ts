import { describe, expect, it } from 'vitest';
import { resolveImportWorkerConcurrency } from './worker-concurrency.js';
import type { Env } from '../../../core/config/env.js';

describe('resolveImportWorkerConcurrency', () => {
  it('reads concurrency from the validated Env object', () => {
    const env = { IMPORT_WORKER_CONCURRENCY: 7 } as Env;
    expect(resolveImportWorkerConcurrency(env)).toBe(7);
  });

  it('does not silently fall back to a parallel process.env value', () => {
    const previous = process.env.IMPORT_WORKER_CONCURRENCY;
    process.env.IMPORT_WORKER_CONCURRENCY = '99';
    try {
      const env = { IMPORT_WORKER_CONCURRENCY: 3 } as Env;
      expect(resolveImportWorkerConcurrency(env)).toBe(3);
    } finally {
      if (previous === undefined) {
        delete process.env.IMPORT_WORKER_CONCURRENCY;
      } else {
        process.env.IMPORT_WORKER_CONCURRENCY = previous;
      }
    }
  });
});
