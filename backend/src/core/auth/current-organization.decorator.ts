import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedOrganization } from './authenticated-organization.js';

export const CurrentOrganization = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedOrganization => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ organization?: AuthenticatedOrganization }>();
    if (!request.organization) {
      throw new UnauthorizedException({
        code: 'AUTH.UNAUTHENTICATED',
        message: 'No authenticated organization on the request.',
      });
    }
    return request.organization;
  },
);
