import type { Env } from '../../../core/config/env.js';

export function resolveWebhookWorkerConcurrency(env: Env): number {
  return env.WEBHOOK_WORKER_CONCURRENCY;
}

export function isRetryableWebhookStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function isSuccessfulWebhookStatus(status: number): boolean {
  return status >= 200 && status < 300;
}
