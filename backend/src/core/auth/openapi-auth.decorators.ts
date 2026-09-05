import { applyDecorators } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import { ApiRateLimited } from '../../common/http/rate-limit.openapi.js';

export function ApiKeyOnlyAuth() {
  return applyDecorators(ApiSecurity('api-key'), ApiRateLimited());
}

export function ApiKeyOrImportAccessTokenAuth() {
  return applyDecorators(
    ApiSecurity('api-key'),
    ApiSecurity('import-access-token'),
    ApiRateLimited(),
  );
}
