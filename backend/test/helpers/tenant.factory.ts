import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/core/database/prisma.service.js';
import {
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
} from '../../src/core/auth/api-key.crypto.js';

export type TestTenant = {
  organizationId: string;
  apiKey: string;
};

export async function createTenant(
  prisma: PrismaService,
  options?: { name?: string; revoked?: boolean; apiKey?: string },
): Promise<TestTenant> {
  const apiKey = options?.apiKey ?? generateApiKey();
  const organization = await prisma.organization.create({
    data: {
      name: options?.name ?? `org-${randomUUID()}`,
      apiKeys: {
        create: {
          name: 'e2e-key',
          keyHash: hashApiKey(apiKey),
          keyPrefix: apiKeyPrefix(apiKey),
          revokedAt: options?.revoked ? new Date() : undefined,
        },
      },
    },
  });

  return {
    organizationId: organization.id,
    apiKey,
  };
}

export const productTemplatePayload = {
  name: 'products',
  fields: [
    { key: 'sku', label: 'SKU', type: 'string', required: true },
    { key: 'priceInCents', label: 'Preço', type: 'currency', required: true },
  ],
};
