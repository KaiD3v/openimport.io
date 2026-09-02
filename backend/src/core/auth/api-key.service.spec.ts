import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashApiKey } from './api-key.crypto.js';
import { ApiKeyService } from './api-key.service.js';
import { PrismaService } from '../database/prisma.service.js';

const rawKey = 'oi_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const organizationId = '11111111-1111-1111-1111-111111111111';

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let prisma: {
    apiKey: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prisma = {
      apiKey: {
        findUnique: vi.fn(),
      },
    };
    service = new ApiKeyService(prisma as unknown as PrismaService);
  });

  it('resolves an organization by hashed lookup, never by plaintext', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      name: 'local',
      revokedAt: null,
      organizationId,
    });

    const result = await service.resolve(rawKey);

    expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash: hashApiKey(rawKey) },
      select: {
        id: true,
        name: true,
        revokedAt: true,
        organizationId: true,
      },
    });
    expect(result).toEqual({
      organizationId,
      apiKeyId: 'key-1',
      apiKeyName: 'local',
    });
    const call = prisma.apiKey.findUnique.mock.calls[0]?.[0] as {
      where: { keyHash: string };
    };
    expect(call.where.keyHash).not.toBe(rawKey);
  });

  it('returns null for an unknown key', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(null);

    await expect(service.resolve(rawKey)).resolves.toBeNull();
  });

  it('returns null for a revoked key', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      name: 'local',
      revokedAt: new Date('2026-01-01T00:00:00.000Z'),
      organizationId,
    });

    await expect(service.resolve(rawKey)).resolves.toBeNull();
  });
});
