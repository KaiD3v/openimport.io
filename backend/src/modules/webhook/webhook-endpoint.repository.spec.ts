import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../core/database/prisma.service.js';
import { IMPORT_READY_EVENT_TYPE } from './webhook.constants.js';
import { WebhookEndpointRepository } from './webhook-endpoint.repository.js';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const endpointId = '11111111-1111-4111-8111-111111111111';

describe('WebhookEndpointRepository', () => {
  let prisma: {
    webhookEndpoint: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let repo: WebhookEndpointRepository;

  beforeEach(() => {
    prisma = {
      webhookEndpoint: {
        create: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    };
    repo = new WebhookEndpointRepository(prisma as unknown as PrismaService);
  });

  it('creates without an update branch that could store a foreign AAD', async () => {
    prisma.webhookEndpoint.create.mockResolvedValue({ id: endpointId });

    await repo.createForOrganization({
      id: endpointId,
      organizationId,
      url: 'https://hooks.example.com/ready',
      secretCiphertext: 'v2.ciphertext-for-this-id',
      secretPrefix: 'oi_whsec_aaaaaaa',
    });

    expect(prisma.webhookEndpoint.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: endpointId,
        organizationId,
        secretCiphertext: 'v2.ciphertext-for-this-id',
        eventType: IMPORT_READY_EVENT_TYPE,
        isActive: true,
      }),
    });
    expect(prisma.webhookEndpoint.updateMany).not.toHaveBeenCalled();
    expect(prisma.webhookEndpoint.update).not.toHaveBeenCalled();
  });

  it('rotates only the organization-scoped row with the provided ciphertext', async () => {
    prisma.webhookEndpoint.update.mockResolvedValue({
      id: endpointId,
      organizationId,
      secretCiphertext: 'v2.rotated',
    });

    const record = await repo.rotateForOrganization({
      id: endpointId,
      organizationId,
      url: 'https://hooks.example.com/ready',
      secretCiphertext: 'v2.rotated',
      secretPrefix: 'oi_whsec_bbbbbbb',
    });

    expect(prisma.webhookEndpoint.update).toHaveBeenCalledWith({
      where: {
        id: endpointId,
        organizationId,
        eventType: IMPORT_READY_EVENT_TYPE,
      },
      data: expect.objectContaining({
        secretCiphertext: 'v2.rotated',
        isActive: true,
      }),
    });
    expect(record.id).toBe(endpointId);
    expect(record.secretCiphertext).toBe('v2.rotated');
    expect(prisma.webhookEndpoint.findFirst).not.toHaveBeenCalled();
    expect(prisma.webhookEndpoint.updateMany).not.toHaveBeenCalled();
  });

  it('does not treat a missed rotate as success', async () => {
    prisma.webhookEndpoint.update.mockRejectedValue(
      Object.assign(new Error('Record to update not found.'), { code: 'P2025' }),
    );

    await expect(
      repo.rotateForOrganization({
        id: endpointId,
        organizationId,
        url: 'https://hooks.example.com/ready',
        secretCiphertext: 'v2.rotated',
        secretPrefix: 'oi_whsec_bbbbbbb',
      }),
    ).rejects.toMatchObject({ code: 'P2025' });
    expect(prisma.webhookEndpoint.findFirst).not.toHaveBeenCalled();
  });

  it('returns the row from this rotation when another write commits before a later find', async () => {
    const rotationA = {
      url: 'https://hooks.example.com/a',
      secretCiphertext: 'v2.ciphertext-A',
      secretPrefix: 'oi_whsec_aaaaaaa',
    };
    const rotationB = {
      url: 'https://hooks.example.com/b',
      secretCiphertext: 'v2.ciphertext-B',
      secretPrefix: 'oi_whsec_bbbbbbb',
    };
    const live = {
      id: endpointId,
      organizationId,
      eventType: IMPORT_READY_EVENT_TYPE,
      isActive: true,
      createdAt: new Date('2026-09-04T12:00:00.000Z'),
      updatedAt: new Date('2026-09-04T12:00:00.000Z'),
      url: 'https://hooks.example.com/initial',
      secretCiphertext: 'v2.ciphertext-0',
      secretPrefix: 'oi_whsec_0000000',
    };

    prisma.webhookEndpoint.updateMany.mockImplementation(async ({ data }) => {
      Object.assign(live, data);
      Object.assign(live, rotationB);
      return { count: 1 };
    });
    prisma.webhookEndpoint.findFirst.mockImplementation(async () => ({
      ...live,
    }));
    prisma.webhookEndpoint.update.mockImplementation(async ({ data }) => {
      const written = { ...live, ...data };
      Object.assign(live, data);
      Object.assign(live, rotationB);
      return written;
    });

    const record = await repo.rotateForOrganization({
      id: endpointId,
      organizationId,
      ...rotationA,
    });

    expect(record.url).toBe(rotationA.url);
    expect(record.secretPrefix).toBe(rotationA.secretPrefix);
    expect(record.secretCiphertext).toBe(rotationA.secretCiphertext);
    expect(live.url).toBe(rotationB.url);
    expect(prisma.webhookEndpoint.update).toHaveBeenCalledWith({
      where: {
        id: endpointId,
        organizationId,
        eventType: IMPORT_READY_EVENT_TYPE,
      },
      data: expect.objectContaining({
        url: rotationA.url,
        secretCiphertext: rotationA.secretCiphertext,
        secretPrefix: rotationA.secretPrefix,
        isActive: true,
      }),
    });
    expect(prisma.webhookEndpoint.findFirst).not.toHaveBeenCalled();
    expect(prisma.webhookEndpoint.updateMany).not.toHaveBeenCalled();
  });

  it('returns each concurrent rotation atomically while last write wins', async () => {
    const rotationA = {
      url: 'https://hooks.example.com/a',
      secretCiphertext: 'v2.ciphertext-A',
      secretPrefix: 'oi_whsec_aaaaaaa',
    };
    const rotationB = {
      url: 'https://hooks.example.com/b',
      secretCiphertext: 'v2.ciphertext-B',
      secretPrefix: 'oi_whsec_bbbbbbb',
    };
    const now = new Date('2026-09-04T12:00:00.000Z');
    let row = {
      id: endpointId,
      organizationId,
      eventType: IMPORT_READY_EVENT_TYPE,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      url: 'https://hooks.example.com/initial',
      secretCiphertext: 'v2.ciphertext-0',
      secretPrefix: 'oi_whsec_0000000',
    };
    const commits: Array<{ url: string; secretPrefix: string; secretCiphertext: string }> =
      [];
    let writesStarted = 0;
    let resolveSecondWrite: () => void = () => undefined;
    const secondWrite = new Promise<void>((resolve) => {
      resolveSecondWrite = resolve;
    });

    function matchesWhere(where: {
      id?: string;
      organizationId?: string;
      eventType?: string;
    }): boolean {
      return (
        where.id === row.id &&
        where.organizationId === row.organizationId &&
        where.eventType === row.eventType
      );
    }

    prisma.webhookEndpoint.updateMany.mockImplementation(
      async ({ where, data }) => {
        if (!matchesWhere(where)) {
          return { count: 0 };
        }
        writesStarted += 1;
        const n = writesStarted;
        Object.assign(row, data);
        commits.push({
          url: row.url,
          secretPrefix: row.secretPrefix,
          secretCiphertext: row.secretCiphertext,
        });
        if (n === 1) {
          await secondWrite;
        } else {
          resolveSecondWrite();
        }
        return { count: 1 };
      },
    );
    prisma.webhookEndpoint.findFirst.mockImplementation(async () => ({
      ...row,
    }));
    prisma.webhookEndpoint.update.mockImplementation(async ({ where, data }) => {
      if (!matchesWhere(where)) {
        return Promise.reject(
          Object.assign(new Error('Record to update not found.'), {
            code: 'P2025',
          }),
        );
      }
      writesStarted += 1;
      const n = writesStarted;
      const written = { ...row, ...data };
      row = { ...written };
      commits.push({
        url: written.url,
        secretPrefix: written.secretPrefix,
        secretCiphertext: written.secretCiphertext,
      });
      if (n === 1) {
        await secondWrite;
      } else {
        resolveSecondWrite();
      }
      return { ...written };
    });

    const [first, second] = await Promise.all([
      repo.rotateForOrganization({
        id: endpointId,
        organizationId,
        ...rotationA,
      }),
      repo.rotateForOrganization({
        id: endpointId,
        organizationId,
        ...rotationB,
      }),
    ]);

    expect(first.url).toBe(rotationA.url);
    expect(first.secretPrefix).toBe(rotationA.secretPrefix);
    expect(first.secretCiphertext).toBe(rotationA.secretCiphertext);
    expect(second.url).toBe(rotationB.url);
    expect(second.secretPrefix).toBe(rotationB.secretPrefix);
    expect(second.secretCiphertext).toBe(rotationB.secretCiphertext);
    expect(row.url).toBe(commits.at(-1)?.url);
    expect(row.secretPrefix).toBe(commits.at(-1)?.secretPrefix);
    expect(row.secretCiphertext).toBe(commits.at(-1)?.secretCiphertext);
    expect(prisma.webhookEndpoint.findFirst).not.toHaveBeenCalled();
    expect(prisma.webhookEndpoint.updateMany).not.toHaveBeenCalled();
  });
});
