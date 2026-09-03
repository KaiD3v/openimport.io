import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeyGuard } from './api-key.guard.js';
import { ApiKeyService } from './api-key.service.js';
import { IMPORT_ACCESS_TOKEN_PREFIX } from './import-access-token.crypto.js';
import { ImportAccessTokenService } from './import-access-token.service.js';

describe('ApiKeyGuard', () => {
  let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
  let apiKeys: { resolve: ReturnType<typeof vi.fn> };
  let importAccessTokens: { resolve: ReturnType<typeof vi.fn> };
  let guard: ApiKeyGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn() };
    apiKeys = { resolve: vi.fn() };
    importAccessTokens = { resolve: vi.fn() };
    guard = new ApiKeyGuard(
      reflector as unknown as Reflector,
      apiKeys as unknown as ApiKeyService,
      importAccessTokens as unknown as ImportAccessTokenService,
    );
  });

  function context(authorization?: string) {
    const request: { headers: { authorization?: string }; organization?: unknown } =
      {
        headers: { authorization },
      };
    return {
      request,
      ctx: {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as never,
    };
  }

  it('skips public routes', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { ctx } = context();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(apiKeys.resolve).not.toHaveBeenCalled();
    expect(importAccessTokens.resolve).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer without treating it as an API key lookup', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const { ctx } = context();
    try {
      await guard.canActivate(ctx);
      throw new Error('expected unauthorized');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        code: 'AUTH.MISSING_BEARER',
        message: 'Authorization header must contain a Bearer credential.',
      });
    }
    expect(apiKeys.resolve).not.toHaveBeenCalled();
  });

  it('resolves import-prefixed tokens through the import token service', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const raw = `${IMPORT_ACCESS_TOKEN_PREFIX}${'ab'.repeat(32)}`;
    importAccessTokens.resolve.mockResolvedValue({
      organizationId: 'org-1',
      credential: { type: 'importAccessToken', importSessionId: 'imp-1' },
    });
    const { ctx, request } = context(`Bearer ${raw}`);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(importAccessTokens.resolve).toHaveBeenCalledWith(raw);
    expect(apiKeys.resolve).not.toHaveBeenCalled();
    expect(request.organization).toMatchObject({
      credential: { type: 'importAccessToken' },
    });
  });

  it('does not look up an import token as an API key when it is invalid', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    importAccessTokens.resolve.mockResolvedValue(null);
    const raw = `${IMPORT_ACCESS_TOKEN_PREFIX}${'cd'.repeat(32)}`;
    const { ctx } = context(`Bearer ${raw}`);

    try {
      await guard.canActivate(ctx);
      throw new Error('expected unauthorized');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        code: 'AUTH.INVALID_IMPORT_TOKEN',
      });
    }
    expect(apiKeys.resolve).not.toHaveBeenCalled();
  });

  it('still authenticates organization API keys', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    apiKeys.resolve.mockResolvedValue({
      organizationId: 'org-1',
      credential: { type: 'apiKey' },
    });
    const { ctx, request } = context(
      'Bearer oi_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(importAccessTokens.resolve).not.toHaveBeenCalled();
    expect(request.organization).toMatchObject({
      credential: { type: 'apiKey' },
    });
  });
});
