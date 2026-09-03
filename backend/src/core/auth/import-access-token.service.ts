import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedOrganization } from './authenticated-organization.js';
import {
  generateImportAccessToken,
  hashImportAccessToken,
  importAccessTokenPrefix,
} from './import-access-token.crypto.js';

export type IssuedImportAccessToken = {
  accessToken: string;
  importId: string;
  expiresAt: Date;
};

@Injectable()
export class ImportAccessTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(rawToken: string): Promise<AuthenticatedOrganization | null> {
    const tokenHash = hashImportAccessToken(rawToken);
    const record = await this.prisma.importAccessToken.findUnique({
      where: { tokenHash },
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

    if (
      !record ||
      !record.issuerApiKey ||
      !record.importSession ||
      record.revokedAt ||
      record.issuerApiKey.revokedAt ||
      record.expiresAt.getTime() <= Date.now() ||
      record.importSession.id !== record.importSessionId ||
      record.issuerApiKey.organizationId !== record.importSession.organizationId ||
      record.organizationId !== record.importSession.organizationId
    ) {
      return null;
    }

    return {
      organizationId: record.importSession.organizationId,
      apiKeyId: record.issuerApiKeyId,
      apiKeyName: record.issuerApiKey.name,
      credential: {
        type: 'importAccessToken',
        importSessionId: record.importSessionId,
        accessTokenId: record.id,
      },
    };
  }

  async issue(input: {
    organizationId: string;
    importSessionId: string;
    issuerApiKeyId: string;
    expiresInSeconds: number;
  }): Promise<IssuedImportAccessToken | null> {
    const accessToken = generateImportAccessToken();
    const tokenHash = hashImportAccessToken(accessToken);
    const tokenPrefix = importAccessTokenPrefix(accessToken);
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.importSession.findFirst({
        where: {
          id: input.importSessionId,
          organizationId: input.organizationId,
        },
        select: { id: true },
      });
      if (!session) {
        return null;
      }

      await tx.importAccessToken.create({
        data: {
          organizationId: input.organizationId,
          importSessionId: session.id,
          issuerApiKeyId: input.issuerApiKeyId,
          tokenHash,
          tokenPrefix,
          expiresAt,
        },
      });

      return {
        accessToken,
        importId: session.id,
        expiresAt,
      };
    });
  }
}
