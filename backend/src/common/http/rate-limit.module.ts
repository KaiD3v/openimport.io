import { Global, Module } from '@nestjs/common';
import { PostAuthRateLimitGuard } from './post-auth-rate-limit.guard.js';
import { PreAuthRateLimitGuard } from './pre-auth-rate-limit.guard.js';
import { RateLimitStore } from './rate-limit.store.js';

@Global()
@Module({
  providers: [RateLimitStore, PreAuthRateLimitGuard, PostAuthRateLimitGuard],
  exports: [RateLimitStore, PreAuthRateLimitGuard, PostAuthRateLimitGuard],
})
export class RateLimitModule {}
