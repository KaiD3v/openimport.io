import { forceE2eRedisEnv } from './helpers/e2e-redis.js';

// Must run before AppModule / env.singleton import in e2e files.
forceE2eRedisEnv();
process.env.WEBHOOK_SSRF_ALLOW_PRIVATE_TARGETS = 'true';
if (!process.env.WEBHOOK_SECRET_ENCRYPTION_KEY) {
  process.env.WEBHOOK_SECRET_ENCRYPTION_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
}
