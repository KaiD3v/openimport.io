import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  apiKeyPrefix,
  assertBootstrapApiKey,
  hashApiKey,
} from '../src/core/auth/api-key.crypto.js';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the development seed in production.');
  }

  const rawKey = assertBootstrapApiKey(process.env.SEED_API_KEY);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed the database.');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const keyHash = hashApiKey(rawKey);
    const prefix = apiKeyPrefix(rawKey);
    const organizationName =
      process.env.SEED_ORGANIZATION_NAME?.trim() || 'Local Development';

    const existing = await prisma.apiKey.findUnique({
      where: { keyHash },
      select: { id: true },
    });
    if (existing) {
      console.log(`Seed complete. API key prefix ${prefix} is already present.`);
      return;
    }

    await prisma.organization.create({
      data: {
        name: organizationName,
        apiKeys: {
          create: {
            name: 'local-dev',
            keyHash,
            keyPrefix: prefix,
          },
        },
      },
    });

    console.log(
      `Seed complete. Organization "${organizationName}" created with API key prefix ${prefix}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Seed failed.';
  console.error(message);
  process.exit(1);
}
