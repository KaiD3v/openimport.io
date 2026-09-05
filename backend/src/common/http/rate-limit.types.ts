export const RATE_LIMIT_REDIS_NAMESPACE = 'openimport:rl';

export type RateLimitTier =
  | 'pre_auth'
  | 'general'
  | 'upload'
  | 'preview'
  | 'confirm'
  | 'access_token'
  | 'webhook';

export type RateLimitConsumeResult = {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
};

export type RateLimitIdentity =
  | { kind: 'ip'; ip: string }
  | {
      kind: 'apiKey';
      organizationId: string;
      apiKeyId: string;
    }
  | {
      kind: 'importAccessToken';
      organizationId: string;
      accessTokenId: string;
    };
