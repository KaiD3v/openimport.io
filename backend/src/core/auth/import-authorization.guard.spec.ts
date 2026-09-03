import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLOW_IMPORT_ACCESS_TOKEN_KEY } from './allow-import-access-token.decorator.js';
import type { AuthenticatedOrganization } from './authenticated-organization.js';
import { ImportAuthorizationGuard } from './import-authorization.guard.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

const organizationId = '11111111-1111-1111-1111-111111111111';
const importSessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const otherImportId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function apiKeyOrg(): AuthenticatedOrganization {
  return {
    organizationId,
    apiKeyId: 'key-1',
    apiKeyName: 'local',
    credential: { type: 'apiKey' },
  };
}

function importTokenOrg(): AuthenticatedOrganization {
  return {
    organizationId,
    apiKeyId: 'key-1',
    apiKeyName: 'local',
    credential: {
      type: 'importAccessToken',
      importSessionId,
      accessTokenId: 'token-1',
    },
  };
}

describe('ImportAuthorizationGuard', () => {
  let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
  let guard: ImportAuthorizationGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn() };
    guard = new ImportAuthorizationGuard(reflector as unknown as Reflector);
  });

  function context(input: {
    organization?: AuthenticatedOrganization;
    importId?: string;
  }) {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          organization: input.organization,
          params: { importId: input.importId },
        }),
      }),
    } as never;
  }

  it('allows API keys on any business route', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    expect(guard.canActivate(context({ organization: apiKeyOrg() }))).toBe(
      true,
    );
  });

  it('rejects an import token on a route that does not allow it', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) {
        return false;
      }
      if (key === ALLOW_IMPORT_ACCESS_TOKEN_KEY) {
        return false;
      }
      return undefined;
    });

    try {
      guard.canActivate(
        context({ organization: importTokenOrg(), importId: importSessionId }),
      );
      throw new Error('expected forbidden');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'AUTH.INSUFFICIENT_SCOPE',
      });
    }
  });

  it('allows an import token only for its bound importId', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === ALLOW_IMPORT_ACCESS_TOKEN_KEY) {
        return true;
      }
      return false;
    });

    expect(
      guard.canActivate(
        context({ organization: importTokenOrg(), importId: importSessionId }),
      ),
    ).toBe(true);
  });

  it('hides a different importId as IMPORT.NOT_FOUND', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === ALLOW_IMPORT_ACCESS_TOKEN_KEY) {
        return true;
      }
      return false;
    });

    try {
      guard.canActivate(
        context({ organization: importTokenOrg(), importId: otherImportId }),
      );
      throw new Error('expected not found');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'IMPORT.NOT_FOUND',
      });
    }
  });
});
