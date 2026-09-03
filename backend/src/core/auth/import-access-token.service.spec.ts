import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import {
  hashImportAccessToken,
  IMPORT_ACCESS_TOKEN_PREFIX,
} from './import-access-token.crypto.js';
import { ImportAccessTokenService } from './import-access-token.service.js';

const organizationId = '11111111-1111-1111-1111-111111111111';
const importSessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const issuerApiKeyId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const accessTokenId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const rawToken = `${IMPORT_ACCESS_TOKEN_PREFIX}${'ab'.repeat(32)}`;

describe('ImportAccessTokenService', () => {
  let service: ImportAccessTokenService;
  let prisma: {
    importAccessToken: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    importSession: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prisma = {
      importAccessToken: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      importSession: {
        findFirst: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    service = new ImportAccessTokenService(prisma as unknown as PrismaService);
  });

  it('resolves by hashed lookup and never queries the plaintext', async () => {
    prisma.importAccessToken.findUnique.mockResolvedValue({
      id: accessTokenId,
      organizationId,
      importSessionId,
      issuerApiKeyId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      issuerApiKey: {
        name: 'local',
        revokedAt: null,
        organizationId,
      },
      importSession: {
        id: importSessionId,
        organizationId,
      },
    });

    const result = await service.resolve(rawToken);

    expect(prisma.importAccessToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashImportAccessToken(rawToken) },
      select: {
        id: true,
        organizationId: true,
        importSessionId: true,
        issuerApiKeyId: true,
        expiresAt: true,
        revokedAt: true,
        issuerApiKey: {
          select: {
            name: true,
            revokedAt: true,
            organizationId: true,
          },
        },
        importSession: {
          select: {
            id: true,
            organizationId: true,
          },
        },
      },
    });
    const call = prisma.importAccessToken.findUnique.mock.calls[0]?.[0] as {
      where: { tokenHash: string };
    };
    expect(call.where.tokenHash).not.toBe(rawToken);
    expect(result).toEqual({
      organizationId,
      apiKeyId: issuerApiKeyId,
      apiKeyName: 'local',
      credential: {
        type: 'importAccessToken',
        importSessionId,
        accessTokenId,
      },
    });
  });

  it('returns null for an unknown token', async () => {
    prisma.importAccessToken.findUnique.mockResolvedValue(null);
    await expect(service.resolve(rawToken)).resolves.toBeNull();
  });

  it('returns null for a revoked token even if it has not expired', async () => {
    prisma.importAccessToken.findUnique.mockResolvedValue({
      id: accessTokenId,
      organizationId,
      importSessionId,
      issuerApiKeyId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date('2026-01-01T00:00:00.000Z'),
      issuerApiKey: {
        name: 'local',
        revokedAt: null,
        organizationId,
      },
      importSession: {
        id: importSessionId,
        organizationId,
      },
    });
    await expect(service.resolve(rawToken)).resolves.toBeNull();
  });

  it('returns null for an expired token that is not revoked', async () => {
    prisma.importAccessToken.findUnique.mockResolvedValue({
      id: accessTokenId,
      organizationId,
      importSessionId,
      issuerApiKeyId,
      expiresAt: new Date(Date.now() - 1_000),
      revokedAt: null,
      issuerApiKey: {
        name: 'local',
        revokedAt: null,
        organizationId,
      },
      importSession: {
        id: importSessionId,
        organizationId,
      },
    });
    await expect(service.resolve(rawToken)).resolves.toBeNull();
  });

  it('returns null when the issuer API key is revoked', async () => {
    prisma.importAccessToken.findUnique.mockResolvedValue({
      id: accessTokenId,
      organizationId,
      importSessionId,
      issuerApiKeyId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      issuerApiKey: {
        name: 'local',
        revokedAt: new Date('2026-01-01T00:00:00.000Z'),
        organizationId,
      },
      importSession: {
        id: importSessionId,
        organizationId,
      },
    });
    await expect(service.resolve(rawToken)).resolves.toBeNull();
  });

  it('returns null when the issuer, session, and token organizations are inconsistent', async () => {
    prisma.importAccessToken.findUnique.mockResolvedValue({
      id: accessTokenId,
      organizationId,
      importSessionId,
      issuerApiKeyId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      issuerApiKey: {
        name: 'local',
        revokedAt: null,
        organizationId: '99999999-9999-9999-9999-999999999999',
      },
      importSession: {
        id: importSessionId,
        organizationId,
      },
    });
    await expect(service.resolve(rawToken)).resolves.toBeNull();
  });

  it('returns null when the import session organization does not match the token row', async () => {
    prisma.importAccessToken.findUnique.mockResolvedValue({
      id: accessTokenId,
      organizationId,
      importSessionId,
      issuerApiKeyId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      issuerApiKey: {
        name: 'local',
        revokedAt: null,
        organizationId,
      },
      importSession: {
        id: importSessionId,
        organizationId: '99999999-9999-9999-9999-999999999999',
      },
    });
    await expect(service.resolve(rawToken)).resolves.toBeNull();
  });

  it('issues a token only after confirming the session belongs to the organization', async () => {
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
    prisma.importSession.findFirst.mockResolvedValue({ id: importSessionId });
    prisma.importAccessToken.create.mockResolvedValue({});

    const issued = await service.issue({
      organizationId,
      importSessionId,
      issuerApiKeyId,
      expiresInSeconds: 1800,
    });

    expect(issued).not.toBeNull();
    expect(issued?.importId).toBe(importSessionId);
    expect(issued?.accessToken.startsWith(IMPORT_ACCESS_TOKEN_PREFIX)).toBe(
      true,
    );
    expect(issued?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(prisma.importSession.findFirst).toHaveBeenCalledWith({
      where: { id: importSessionId, organizationId },
      select: { id: true },
    });
    const createArg = prisma.importAccessToken.create.mock.calls[0]?.[0] as {
      data: { tokenHash: string; tokenPrefix: string; issuerApiKeyId: string };
    };
    expect(createArg.data.issuerApiKeyId).toBe(issuerApiKeyId);
    expect(createArg.data.tokenHash).toBe(
      hashImportAccessToken(issued!.accessToken),
    );
    expect(createArg.data.tokenPrefix).not.toBe(issued!.accessToken);
  });

  it('does not persist a token when the session is missing or belongs to another organization', async () => {
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
    prisma.importSession.findFirst.mockResolvedValue(null);

    await expect(
      service.issue({
        organizationId,
        importSessionId,
        issuerApiKeyId,
        expiresInSeconds: 1800,
      }),
    ).resolves.toBeNull();
    expect(prisma.importAccessToken.create).not.toHaveBeenCalled();
  });
});
