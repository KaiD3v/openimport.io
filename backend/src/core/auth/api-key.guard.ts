import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyService } from './api-key.service.js';
import type { AuthenticatedOrganization } from './authenticated-organization.js';
import { isImportAccessToken } from './import-access-token.crypto.js';
import { ImportAccessTokenService } from './import-access-token.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

function readBearerToken(header: unknown): string | undefined {
  if (typeof header !== 'string' || header.trim().length === 0) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyService,
    private readonly importAccessTokens: ImportAccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      organization?: AuthenticatedOrganization;
    }>();
    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException({
        code: 'AUTH.MISSING_BEARER',
        message: 'Authorization header must contain a Bearer credential.',
      });
    }

    if (isImportAccessToken(token)) {
      const organization = await this.importAccessTokens.resolve(token);
      if (!organization) {
        throw new UnauthorizedException({
          code: 'AUTH.INVALID_IMPORT_TOKEN',
          message: 'Import access token is invalid.',
        });
      }
      request.organization = organization;
      return true;
    }

    const organization = await this.apiKeys.resolve(token);
    if (!organization) {
      throw new UnauthorizedException({
        code: 'AUTH.INVALID_API_KEY',
        message: 'API key is invalid or revoked.',
      });
    }

    request.organization = organization;
    return true;
  }
}
