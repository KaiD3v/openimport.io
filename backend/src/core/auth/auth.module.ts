import { Global, Module } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard.js';
import { ApiKeyService } from './api-key.service.js';

@Global()
@Module({
  providers: [ApiKeyService, ApiKeyGuard],
  exports: [ApiKeyService, ApiKeyGuard],
})
export class AuthModule {}
