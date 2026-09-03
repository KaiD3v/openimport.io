import { Global, Module } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard.js';
import { ApiKeyService } from './api-key.service.js';
import { ImportAccessTokenService } from './import-access-token.service.js';
import { ImportAuthorizationGuard } from './import-authorization.guard.js';

@Global()
@Module({
  providers: [
    ApiKeyService,
    ImportAccessTokenService,
    ApiKeyGuard,
    ImportAuthorizationGuard,
  ],
  exports: [
    ApiKeyService,
    ImportAccessTokenService,
    ApiKeyGuard,
    ImportAuthorizationGuard,
  ],
})
export class AuthModule {}
