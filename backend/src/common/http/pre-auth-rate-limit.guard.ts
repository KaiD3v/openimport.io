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
import { resolveClientIp } from './client-ip.js';
import { RateLimitStore } from './rate-limit.store.js';
import { isHealthPath } from './rate-limit.tiers.js';

/**
 * Runs before authentication. Keys by client IP only.
 * Blocks floods (missing/invalid credentials) without auth lookup once exceeded.
 */
@Injectable()
export class PreAuthRateLimitGuard implements CanActivate {
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

    const ip = resolveClientIp(request, this.env);
    const result = await this.store.consume(
      'pre_auth',
      { kind: 'ip', ip },
      this.env.RATE_LIMIT_PRE_AUTH_MAX,
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
