import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ENV } from '../../core/config/env.token.js';
import type { Env } from '../../core/config/env.js';
import type { AuthenticatedOrganization } from '../../core/auth/authenticated-organization.js';
import { RateLimitStore } from './rate-limit.store.js';
import {
  isHealthPath,
  limitForTier,
  resolveRateLimitTier,
} from './rate-limit.tiers.js';
import type { RateLimitIdentity } from './rate-limit.types.js';

/**
 * Runs after authentication. Keys by stable credential identity (never raw token).
 */
@Injectable()
export class PostAuthRateLimitGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly store: RateLimitStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.env.RATE_LIMIT_ENABLED) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const path = request.path ?? request.url ?? '';

    if (isHealthPath(path)) {
      return true;
    }

    const organization = request.organization;
    if (!organization) {
      return true;
    }

    const tier = resolveRateLimitTier(request.method, path);
    const identity = identityFor(organization);
    const limit = limitForTier(this.env, tier);
    const result = await this.store.consume(
      tier,
      identity,
      limit,
      this.env.RATE_LIMIT_WINDOW_MS,
    );

    if (result.allowed) {
      return true;
    }

    response.setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new HttpException(
      {
        code: 'RATE_LIMIT.EXCEEDED',
        message: 'Too many requests.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

function identityFor(
  organization: AuthenticatedOrganization,
): RateLimitIdentity {
  if (organization.credential.type === 'importAccessToken') {
    return {
      kind: 'importAccessToken',
      organizationId: organization.organizationId,
      accessTokenId: organization.credential.accessTokenId,
    };
  }
  return {
    kind: 'apiKey',
    organizationId: organization.organizationId,
    apiKeyId: organization.apiKeyId,
  };
}
