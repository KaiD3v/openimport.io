import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiKeyOrImportAccessTokenAuth } from './openapi-auth.decorators.js';

export const ALLOW_IMPORT_ACCESS_TOKEN_KEY = 'allowImportAccessToken';

export const AllowImportAccessToken = () =>
  applyDecorators(
    SetMetadata(ALLOW_IMPORT_ACCESS_TOKEN_KEY, true),
    ApiKeyOrImportAccessTokenAuth(),
  );
