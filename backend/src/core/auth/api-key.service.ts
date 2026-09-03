import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { hashApiKey } from './api-key.crypto.js';
import type { AuthenticatedOrganization } from './authenticated-organization.js';

@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(rawKey: string): Promise<AuthenticatedOrganization | null> {
    const keyHash = hashApiKey(rawKey);
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      select: {
        id: true,
        name: true,
        revokedAt: true,
        organizationId: true,
      },
    });

    if (!apiKey || apiKey.revokedAt) {
      return null;
    }

    return {
      organizationId: apiKey.organizationId,
      apiKeyId: apiKey.id,
      apiKeyName: apiKey.name,
      credential: { type: 'apiKey' },
    };
  }
}
