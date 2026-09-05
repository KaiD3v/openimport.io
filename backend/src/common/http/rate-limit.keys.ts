import type { RateLimitIdentity, RateLimitTier } from './rate-limit.types.js';
import { RATE_LIMIT_REDIS_NAMESPACE } from './rate-limit.types.js';

/**
 * Builds Redis keys for rate limiting. Never include raw Bearer tokens or API keys.
 */
export function buildRateLimitRedisKey(
  tier: RateLimitTier,
  identity: RateLimitIdentity,
): string {
  switch (identity.kind) {
    case 'ip':
      return `${RATE_LIMIT_REDIS_NAMESPACE}:${tier}:ip:${identity.ip}`;
    case 'apiKey':
      return `${RATE_LIMIT_REDIS_NAMESPACE}:${tier}:org:${identity.organizationId}:apiKey:${identity.apiKeyId}`;
    case 'importAccessToken':
      return `${RATE_LIMIT_REDIS_NAMESPACE}:${tier}:org:${identity.organizationId}:token:${identity.accessTokenId}`;
  }
}

export function assertRateLimitKeySafe(key: string): void {
  if (
    key.includes('oi_live_') ||
    key.includes('oi_import_') ||
    /Bearer\s+/i.test(key)
  ) {
    throw new Error('Rate limit Redis key must not contain raw credentials');
  }
}
