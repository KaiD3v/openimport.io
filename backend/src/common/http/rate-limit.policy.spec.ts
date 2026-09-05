import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Env } from '../../core/config/env.js';
import { PreAuthRateLimitGuard } from './pre-auth-rate-limit.guard.js';
import { PostAuthRateLimitGuard } from './post-auth-rate-limit.guard.js';
import type { RateLimitStore } from './rate-limit.store.js';
import {
  buildRateLimitRedisKey,
  assertRateLimitKeySafe,
} from './rate-limit.keys.js';
import {
  limitForTier,
  resolveRateLimitTier,
} from './rate-limit.tiers.js';
import { resolveClientIp } from './client-ip.js';
import {
  applyHttpServerLimits,
  parseTrustProxySetting,
} from './configure-http-server.js';
import type { Server } from 'node:http';

function contextFor(
  request: Record<string, unknown>,
  response: { setHeader: ReturnType<typeof vi.fn> } = { setHeader: vi.fn() },
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

const baseEnv = {
  RATE_LIMIT_ENABLED: true,
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_PRE_AUTH_MAX: 3,
  RATE_LIMIT_MAX: 5,
  RATE_LIMIT_UPLOAD_MAX: 2,
  RATE_LIMIT_PREVIEW_MAX: 2,
  RATE_LIMIT_CONFIRM_MAX: 2,
  RATE_LIMIT_ACCESS_TOKEN_MAX: 2,
  RATE_LIMIT_WEBHOOK_MAX: 2,
  RATE_LIMIT_TRUSTED_PROXY: false,
} as Env;

describe('rate-limit keys', () => {
  it('never embeds raw credentials', () => {
    const key = buildRateLimitRedisKey('general', {
      kind: 'apiKey',
      organizationId: 'org-1',
      apiKeyId: 'key-1',
    });
    expect(key).toBe('openimport:rl:general:org:org-1:apiKey:key-1');
    expect(() => assertRateLimitKeySafe(key)).not.toThrow();
    expect(() =>
      assertRateLimitKeySafe('openimport:rl:general:oi_live_abc'),
    ).toThrow(/raw credentials/);
  });
});

describe('rate-limit tiers', () => {
  it('maps sensitive routes to dedicated tiers', () => {
    expect(resolveRateLimitTier('POST', '/api/v1/imports/x/file')).toBe(
      'upload',
    );
    expect(resolveRateLimitTier('POST', '/api/v1/imports/x/preview')).toBe(
      'preview',
    );
    expect(resolveRateLimitTier('POST', '/api/v1/imports/x/confirm')).toBe(
      'confirm',
    );
    expect(
      resolveRateLimitTier('POST', '/api/v1/imports/x/access-tokens'),
    ).toBe('access_token');
    expect(resolveRateLimitTier('PUT', '/api/v1/webhook-endpoints')).toBe(
      'webhook',
    );
    expect(resolveRateLimitTier('GET', '/api/v1/templates')).toBe('general');
  });

  it('reads tier limits from env', () => {
    expect(limitForTier(baseEnv, 'upload')).toBe(2);
    expect(limitForTier(baseEnv, 'general')).toBe(5);
    expect(limitForTier(baseEnv, 'pre_auth')).toBe(3);
  });
});

describe('client IP and trust proxy', () => {
  it('ignores X-Forwarded-For unless trusted proxy is enabled', () => {
    const request = {
      ip: '203.0.113.10',
      socket: { remoteAddress: '10.0.0.8' },
    } as never;
    expect(resolveClientIp(request, baseEnv)).toBe('10.0.0.8');
    expect(
      resolveClientIp(request, {
        ...baseEnv,
        RATE_LIMIT_TRUSTED_PROXY: true,
      }),
    ).toBe('203.0.113.10');
  });

  it('parses TRUST_PROXY without unrestricted true', () => {
    expect(parseTrustProxySetting(undefined)).toBe(false);
    expect(parseTrustProxySetting('false')).toBe(false);
    expect(parseTrustProxySetting('true')).toBe('loopback');
    expect(parseTrustProxySetting('1')).toBe(1);
    expect(parseTrustProxySetting('loopback')).toBe('loopback');
    expect(parseTrustProxySetting('10.0.0.0/8')).toBe('10.0.0.0/8');
  });

  it('applies HTTP server limits including maxRequestsPerSocket', () => {
    const server = {} as Server & { connectionsCheckingInterval?: number };
    applyHttpServerLimits(server, {
      HTTP_REQUEST_TIMEOUT_MS: 1000,
      HTTP_HEADERS_TIMEOUT_MS: 500,
      HTTP_KEEP_ALIVE_TIMEOUT_MS: 200,
      HTTP_MAX_REQUESTS_PER_SOCKET: 7,
    });
    expect(server.requestTimeout).toBe(1000);
    expect(server.headersTimeout).toBe(500);
    expect(server.keepAliveTimeout).toBe(200);
    expect(server.maxRequestsPerSocket).toBe(7);
    expect(server.timeout).toBe(1000);
    expect(server.connectionsCheckingInterval).toBe(250);
  });
});

describe('PreAuthRateLimitGuard', () => {
  let store: { consume: ReturnType<typeof vi.fn> };
  let guard: PreAuthRateLimitGuard;

  beforeEach(() => {
    store = { consume: vi.fn() };
    guard = new PreAuthRateLimitGuard(
      baseEnv,
      store as unknown as RateLimitStore,
    );
  });

  it('skips health and blocks after the IP limit', async () => {
    expect(
      await guard.canActivate(contextFor({ path: '/health', ip: '1.1.1.1' })),
    ).toBe(true);
    expect(store.consume).not.toHaveBeenCalled();

    store.consume.mockResolvedValue({
      allowed: true,
      count: 1,
      limit: 3,
      retryAfterSeconds: 60,
    });
    expect(
      await guard.canActivate(
        contextFor({
          path: '/api/v1/templates',
          socket: { remoteAddress: '10.0.0.2' },
        }),
      ),
    ).toBe(true);

    store.consume.mockResolvedValue({
      allowed: false,
      count: 4,
      limit: 3,
      retryAfterSeconds: 12,
    });
    const response = { setHeader: vi.fn() };
    await expect(
      guard.canActivate(
        contextFor(
          {
            path: '/api/v1/templates',
            socket: { remoteAddress: '10.0.0.2' },
          },
          response,
        ),
      ),
    ).rejects.toMatchObject({
      response: { code: 'RATE_LIMIT.EXCEEDED' },
      status: 429,
    });
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '12');
  });
});

describe('PostAuthRateLimitGuard', () => {
  let store: { consume: ReturnType<typeof vi.fn> };
  let guard: PostAuthRateLimitGuard;

  beforeEach(() => {
    store = { consume: vi.fn() };
    guard = new PostAuthRateLimitGuard(
      baseEnv,
      store as unknown as RateLimitStore,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('isolates buckets by apiKeyId and accessTokenId', async () => {
    store.consume.mockResolvedValue({
      allowed: true,
      count: 1,
      limit: 5,
      retryAfterSeconds: 60,
    });

    await guard.canActivate(
      contextFor({
        method: 'GET',
        path: '/api/v1/templates',
        organization: {
          organizationId: 'org-a',
          apiKeyId: 'key-a',
          credential: { type: 'apiKey' },
        },
      }),
    );
    await guard.canActivate(
      contextFor({
        method: 'GET',
        path: '/api/v1/templates',
        organization: {
          organizationId: 'org-a',
          apiKeyId: 'key-b',
          credential: { type: 'apiKey' },
        },
      }),
    );
    await guard.canActivate(
      contextFor({
        method: 'GET',
        path: '/api/v1/imports/x/context',
        organization: {
          organizationId: 'org-a',
          apiKeyId: 'key-a',
          credential: {
            type: 'importAccessToken',
            accessTokenId: 'tok-1',
            importSessionId: 'imp-1',
          },
        },
      }),
    );

    expect(store.consume).toHaveBeenNthCalledWith(
      1,
      'general',
      { kind: 'apiKey', organizationId: 'org-a', apiKeyId: 'key-a' },
      5,
      60_000,
    );
    expect(store.consume).toHaveBeenNthCalledWith(
      2,
      'general',
      { kind: 'apiKey', organizationId: 'org-a', apiKeyId: 'key-b' },
      5,
      60_000,
    );
    expect(store.consume).toHaveBeenNthCalledWith(
      3,
      'general',
      {
        kind: 'importAccessToken',
        organizationId: 'org-a',
        accessTokenId: 'tok-1',
      },
      5,
      60_000,
    );
  });

  it('applies upload tier limits', async () => {
    store.consume.mockResolvedValue({
      allowed: true,
      count: 1,
      limit: 2,
      retryAfterSeconds: 60,
    });
    await guard.canActivate(
      contextFor({
        method: 'POST',
        path: '/api/v1/imports/11111111-1111-4111-8111-111111111111/file',
        organization: {
          organizationId: 'org-a',
          apiKeyId: 'key-a',
          credential: { type: 'apiKey' },
        },
      }),
    );
    expect(store.consume).toHaveBeenCalledWith(
      'upload',
      expect.any(Object),
      2,
      60_000,
    );
  });

  it('skips unauthenticated requests (post-auth only)', async () => {
    expect(
      await guard.canActivate(
        contextFor({ method: 'GET', path: '/api/v1/templates' }),
      ),
    ).toBe(true);
    expect(store.consume).not.toHaveBeenCalled();
  });
});
