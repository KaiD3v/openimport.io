import { forceE2eRedisEnv } from './helpers/e2e-redis.js';

// Must run before AppModule / env.singleton import in e2e files.
forceE2eRedisEnv();
