import type { Env } from '../../core/config/env.js';
import type { RateLimitTier } from './rate-limit.types.js';

const UPLOAD_PATH = /^\/api\/v1\/imports\/[^/]+\/file\/?$/;
const PREVIEW_PATH = /^\/api\/v1\/imports\/[^/]+\/preview\/?$/;
const CONFIRM_PATH = /^\/api\/v1\/imports\/[^/]+\/confirm\/?$/;
const ACCESS_TOKEN_PATH = /^\/api\/v1\/imports\/[^/]+\/access-tokens\/?$/;
const WEBHOOK_PATH = /^\/api\/v1\/webhook-endpoints\/?/;

export function resolveRateLimitTier(
  method: string,
  path: string,
): RateLimitTier {
  const normalized = path.split('?')[0] ?? path;
  const upper = method.toUpperCase();

  if (upper === 'POST' && UPLOAD_PATH.test(normalized)) {
    return 'upload';
  }
  if (upper === 'POST' && PREVIEW_PATH.test(normalized)) {
    return 'preview';
  }
  if (upper === 'POST' && CONFIRM_PATH.test(normalized)) {
    return 'confirm';
  }
  if (upper === 'POST' && ACCESS_TOKEN_PATH.test(normalized)) {
    return 'access_token';
  }
  if (WEBHOOK_PATH.test(normalized)) {
    return 'webhook';
  }
  return 'general';
}

export function limitForTier(env: Env, tier: RateLimitTier): number {
  switch (tier) {
    case 'pre_auth':
      return env.RATE_LIMIT_PRE_AUTH_MAX;
    case 'upload':
      return env.RATE_LIMIT_UPLOAD_MAX;
    case 'preview':
      return env.RATE_LIMIT_PREVIEW_MAX;
    case 'confirm':
      return env.RATE_LIMIT_CONFIRM_MAX;
    case 'access_token':
      return env.RATE_LIMIT_ACCESS_TOKEN_MAX;
    case 'webhook':
      return env.RATE_LIMIT_WEBHOOK_MAX;
    case 'general':
    default:
      return env.RATE_LIMIT_MAX;
  }
}

export function isHealthPath(path: string): boolean {
  const normalized = path.split('?')[0] ?? path;
  return normalized === '/health' || normalized.startsWith('/health/');
}
