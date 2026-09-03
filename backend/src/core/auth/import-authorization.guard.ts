import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_IMPORT_ACCESS_TOKEN_KEY } from './allow-import-access-token.decorator.js';
import type { AuthenticatedOrganization } from './authenticated-organization.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

@Injectable()
export class ImportAuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      organization?: AuthenticatedOrganization;
      params?: { importId?: string };
    }>();
    const organization = request.organization;
    if (!organization) {
      throw new UnauthorizedException({
        code: 'AUTH.UNAUTHENTICATED',
        message: 'No authenticated organization on the request.',
      });
    }

    if (organization.credential.type === 'apiKey') {
      return true;
    }

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_IMPORT_ACCESS_TOKEN_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!allowed) {
      throw new ForbiddenException({
        code: 'AUTH.INSUFFICIENT_SCOPE',
        message: 'This credential cannot access this resource.',
      });
    }

    const importId = request.params?.importId;
    if (
      typeof importId !== 'string' ||
      importId !== organization.credential.importSessionId
    ) {
      throw new NotFoundException({
        code: 'IMPORT.NOT_FOUND',
        message: 'Import session not found.',
      });
    }

    return true;
  }
}
