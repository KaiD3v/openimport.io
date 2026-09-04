import type { Env } from '../../../core/config/env.js';

/** Single source for BullMQ worker concurrency — always the validated Env. */
export function resolveImportWorkerConcurrency(env: Env): number {
  return env.IMPORT_WORKER_CONCURRENCY;
}
