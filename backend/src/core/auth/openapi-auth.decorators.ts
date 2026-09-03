import { applyDecorators } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';

export function ApiKeyOnlyAuth() {
  return applyDecorators(ApiSecurity('api-key'));
}

export function ApiKeyOrImportAccessTokenAuth() {
  return applyDecorators(
    ApiSecurity('api-key'),
    ApiSecurity('import-access-token'),
  );
}
