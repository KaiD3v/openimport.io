import { forceE2eRedisEnv } from './helpers/e2e-redis.js';

// Must run before AppModule / env.singleton import in e2e files.
forceE2eRedisEnv();
process.env.WEBHOOK_SSRF_ALLOW_PRIVATE_TARGETS = 'true';
if (!process.env.WEBHOOK_SECRET_ENCRYPTION_KEY) {
  process.env.WEBHOOK_SECRET_ENCRYPTION_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
}

// Disabled for the general suite so long flows are not starved. Dedicated
// rate-limit e2e overrides ENV with low ceilings + enabled=true.
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_PRE_AUTH_MAX = '5';
process.env.RATE_LIMIT_MAX = '5';
process.env.RATE_LIMIT_UPLOAD_MAX = '3';
process.env.RATE_LIMIT_PREVIEW_MAX = '3';
process.env.RATE_LIMIT_CONFIRM_MAX = '3';
process.env.RATE_LIMIT_ACCESS_TOKEN_MAX = '3';
process.env.RATE_LIMIT_WEBHOOK_MAX = '3';
process.env.RATE_LIMIT_TRUSTED_PROXY = 'false';
process.env.HTTP_MAX_REQUESTS_PER_SOCKET = '100';
