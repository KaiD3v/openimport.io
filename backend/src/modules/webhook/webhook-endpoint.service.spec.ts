import { UnprocessableEntityException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../core/config/env.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import { WebhookEndpointService } from './webhook-endpoint.service.js';
import { WebhookEndpointRepository } from './webhook-endpoint.repository.js';
import type { WebhookEndpointRecord } from './webhook.types.js';
import {
  decryptWebhookSecret,
  webhookSecretAad,
  webhookSecretPrefix,
} from './crypto/webhook-secret.crypto.js';
import { signWebhookPayload, verifyWebhookSignature } from './crypto/webhook-signature.js';
import { IMPORT_READY_EVENT_TYPE } from './webhook.constants.js';

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>(
    'node:crypto',
  );
  return {
    ...actual,
    randomUUID: vi.fn(actual.randomUUID),
  };
});

const ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WINNER_ID = '11111111-1111-4111-8111-111111111111';
const LOSER_ID = '22222222-2222-4222-8222-222222222222';

type CommittedSnapshot = {
  operation: string;
  intendedId?: string;
  id: string;
  organizationId: string;
  secretCiphertext: string;
  secretPrefix: string;
  url: string;
};

function organizationEventUniqueConflict(): {
  code: string;
  meta: { target: string[] };
} {
  return {
    code: 'P2002',
    meta: { target: ['organizationId', 'eventType'] },
  };
}

function cloneRecord(row: WebhookEndpointRecord): WebhookEndpointRecord {
  return { ...row };
}

function createStore() {
  let row: WebhookEndpointRecord | null = null;
  const snapshots: CommittedSnapshot[] = [];

  function commit(
    operation: string,
    next: WebhookEndpointRecord,
    intendedId?: string,
  ): WebhookEndpointRecord {
    row = cloneRecord(next);
    snapshots.push({
      operation,
      intendedId,
      id: row.id,
      organizationId: row.organizationId,
      secretCiphertext: row.secretCiphertext,
      secretPrefix: row.secretPrefix,
      url: row.url,
    });
    return cloneRecord(row);
  }

  return {
    snapshots,
    find: () => (row ? cloneRecord(row) : null),
    create(input: {
      id: string;
      organizationId: string;
      url: string;
      secretCiphertext: string;
      secretPrefix: string;
      eventType?: string;
    }): WebhookEndpointRecord {
      if (row) {
        throw organizationEventUniqueConflict();
      }
      const now = new Date('2026-09-04T12:00:00.000Z');
      return commit(
        'create',
        {
          id: input.id,
          organizationId: input.organizationId,
          url: input.url,
          secretCiphertext: input.secretCiphertext,
          secretPrefix: input.secretPrefix,
          eventType: input.eventType ?? IMPORT_READY_EVENT_TYPE,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
        input.id,
      );
    },
    rotate(input: {
      id: string;
      organizationId: string;
      url: string;
      secretCiphertext: string;
      secretPrefix: string;
    }): WebhookEndpointRecord {
      if (
        !row ||
        row.id !== input.id ||
        row.organizationId !== input.organizationId
      ) {
        throw new Error('Webhook endpoint rotate failed.');
      }
      return commit('rotate', {
        ...row,
        url: input.url,
        secretCiphertext: input.secretCiphertext,
        secretPrefix: input.secretPrefix,
        isActive: true,
        updatedAt: new Date('2026-09-04T12:00:01.000Z'),
      });
    },
    upsert(input: {
      id: string;
      organizationId: string;
      url: string;
      secretCiphertext: string;
      secretPrefix: string;
      eventType?: string;
    }): WebhookEndpointRecord {
      if (!row) {
        return this.create(input);
      }
      return commit(
        'upsert-update',
        {
          ...row,
          url: input.url,
          secretCiphertext: input.secretCiphertext,
          secretPrefix: input.secretPrefix,
          isActive: true,
          updatedAt: new Date('2026-09-04T12:00:01.000Z'),
        },
        input.id,
      );
    },
  };
}

function assertSnapshotsDecryptWithPersistedId(
  snapshots: CommittedSnapshot[],
): void {
  expect(snapshots.length).toBeGreaterThan(0);
  for (const snapshot of snapshots) {
    expect(() =>
      decryptWebhookSecret(
        snapshot.secretCiphertext,
        ENCRYPTION_KEY,
        webhookSecretAad(snapshot.organizationId, snapshot.id),
      ),
    ).not.toThrow();
  }
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolveFn: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  return { promise, resolve: () => resolveFn() };
}

function repositoryFor(
  store: ReturnType<typeof createStore>,
  options?: {
    pairFirstFinds?: boolean;
    create?: ReturnType<typeof vi.fn>;
  },
) {
  let findsStarted = 0;
  const firstFind = deferred();

  return {
    findByOrganizationAndEvent: vi.fn(async () => {
      if (options?.pairFirstFinds) {
        findsStarted += 1;
        if (findsStarted === 1) {
          await firstFind.promise;
        }
        if (findsStarted === 2) {
          firstFind.resolve();
        }
      }
      return store.find();
    }),
    createForOrganization:
      options?.create ?? vi.fn(async (input) => store.create(input)),
    rotateForOrganization: vi.fn(async (input) => store.rotate(input)),
    upsertForOrganization: vi.fn(async (input) => store.upsert(input)),
    deactivateForOrganization: vi.fn(async () => {
      const current = store.find();
      if (!current) {
        return null;
      }
      return { ...current, isActive: false };
    }),
  };
}

describe('WebhookEndpointService', () => {
  const env = {
    WEBHOOK_SSRF_ALLOW_PRIVATE_TARGETS: true,
    WEBHOOK_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
  } as Env;

  afterEach(() => {
    vi.mocked(randomUUID).mockReset();
  });

  it('rejects private webhook URLs when SSRF private targets are disabled', async () => {
    const endpoints = repositoryFor(createStore());
    const service = new WebhookEndpointService(
      endpoints as unknown as WebhookEndpointRepository,
      {
        WEBHOOK_SSRF_ALLOW_PRIVATE_TARGETS: false,
        WEBHOOK_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
      } as Env,
    );

    await expect(
      service.upsert('org', { url: 'https://127.0.0.1/hook' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(endpoints.createForOrganization).not.toHaveBeenCalled();
    expect(endpoints.rotateForOrganization).not.toHaveBeenCalled();
    expect(endpoints.upsertForOrganization).not.toHaveBeenCalled();
    expect(endpoints.findByOrganizationAndEvent).not.toHaveBeenCalled();
  });

  it('does not commit ciphertext bound to a losing first-create id', async () => {
    vi.mocked(randomUUID)
      .mockReturnValueOnce(WINNER_ID)
      .mockReturnValueOnce(LOSER_ID);
    const store = createStore();
    const endpoints = repositoryFor(store, { pairFirstFinds: true });
    const service = new WebhookEndpointService(
      endpoints as unknown as WebhookEndpointRepository,
      env,
    );

    const [first, second] = await Promise.all([
      service.upsert(organizationId, { url: 'http://127.0.0.1:1/a' }),
      service.upsert(organizationId, { url: 'http://127.0.0.1:1/b' }),
    ]);

    expect(store.find()?.id).toBe(WINNER_ID);
    expect(store.snapshots.every((item) => item.id === WINNER_ID)).toBe(true);
    expect(store.snapshots.some((item) => item.intendedId === LOSER_ID)).toBe(
      false,
    );

    assertSnapshotsDecryptWithPersistedId(store.snapshots);

    const createSnapshot = store.snapshots[0]!;
    const createSecret = decryptWebhookSecret(
      createSnapshot.secretCiphertext,
      ENCRYPTION_KEY,
      webhookSecretAad(organizationId, createSnapshot.id),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = '{"id":"delivery-during-race"}';
    expect(
      verifyWebhookSignature({
        secret: createSecret,
        timestampHeader: timestamp,
        signatureHeader: signWebhookPayload(createSecret, timestamp, rawBody),
        rawBody,
      }),
    ).toEqual({ ok: true });

    const persisted = store.find()!;
    const liveSecret = decryptWebhookSecret(
      persisted.secretCiphertext,
      ENCRYPTION_KEY,
      webhookSecretAad(organizationId, persisted.id),
    );
    expect([first.secret, second.secret]).toContain(liveSecret);
    expect(first.secret).not.toBe(second.secret);
    expect(JSON.stringify(first)).not.toContain(persisted.secretCiphertext);
    expect(JSON.stringify(second)).not.toContain(ENCRYPTION_KEY);
    expect(endpoints.upsertForOrganization).not.toHaveBeenCalled();
  });

  it('rotates concurrently against an existing endpoint using only the real id', async () => {
    const store = createStore();
    store.create({
      id: WINNER_ID,
      organizationId,
      url: 'http://127.0.0.1:1/initial',
      secretCiphertext: 'v2.placeholder',
      secretPrefix: 'oi_whsec_aaaaaaa',
    });
    store.snapshots.length = 0;
    const endpoints = repositoryFor(store, { pairFirstFinds: true });
    const service = new WebhookEndpointService(
      endpoints as unknown as WebhookEndpointRepository,
      env,
    );

    const [first, second] = await Promise.all([
      service.upsert(organizationId, { url: 'http://127.0.0.1:1/r1' }),
      service.upsert(organizationId, { url: 'http://127.0.0.1:1/r2' }),
    ]);

    expect(store.find()?.id).toBe(WINNER_ID);
    expect(store.snapshots.every((item) => item.operation === 'rotate')).toBe(
      true,
    );
    assertSnapshotsDecryptWithPersistedId(store.snapshots);
    expect(first.url).toBe('http://127.0.0.1:1/r1');
    expect(second.url).toBe('http://127.0.0.1:1/r2');
    expect(first.secretPrefix).toBe(webhookSecretPrefix(first.secret!));
    expect(second.secretPrefix).toBe(webhookSecretPrefix(second.secret!));
    const snapshotByUrl = (url: string) =>
      store.snapshots.find((item) => item.url === url);
    expect(
      decryptWebhookSecret(
        snapshotByUrl(first.url)!.secretCiphertext,
        ENCRYPTION_KEY,
        webhookSecretAad(organizationId, WINNER_ID),
      ),
    ).toBe(first.secret);
    expect(
      decryptWebhookSecret(
        snapshotByUrl(second.url)!.secretCiphertext,
        ENCRYPTION_KEY,
        webhookSecretAad(organizationId, WINNER_ID),
      ),
    ).toBe(second.secret);
    expect(snapshotByUrl(first.url)!.secretPrefix).toBe(first.secretPrefix);
    expect(snapshotByUrl(second.url)!.secretPrefix).toBe(second.secretPrefix);
    const liveSecret = decryptWebhookSecret(
      store.find()!.secretCiphertext,
      ENCRYPTION_KEY,
      webhookSecretAad(organizationId, WINNER_ID),
    );
    expect([first.secret, second.secret]).toContain(liveSecret);
  });

  it('does not mix a generated secret with metadata from a later concurrent rotation', async () => {
    const now = new Date('2026-09-04T12:00:00.000Z');
    let row: WebhookEndpointRecord = {
      id: WINNER_ID,
      organizationId,
      url: 'http://127.0.0.1:1/initial',
      secretCiphertext: 'v2.placeholder',
      secretPrefix: 'oi_whsec_aaaaaaa',
      eventType: IMPORT_READY_EVENT_TYPE,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    const returnedRows: WebhookEndpointRecord[] = [];
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

    const prisma = {
      webhookEndpoint: {
        findFirst: vi.fn(async () => ({ ...row })),
        create: vi.fn(),
        updateMany: vi.fn(async ({ where, data }) => {
          if (!matchesWhere(where)) {
            return { count: 0 };
          }
          writesStarted += 1;
          const n = writesStarted;
          Object.assign(row, data, { updatedAt: new Date() });
          if (n === 1) {
            await secondWrite;
          } else {
            resolveSecondWrite();
          }
          return { count: 1 };
        }),
        update: vi.fn(async ({ where, data }) => {
          if (!matchesWhere(where)) {
            return Promise.reject(
              Object.assign(new Error('Record to update not found.'), {
                code: 'P2025',
              }),
            );
          }
          writesStarted += 1;
          const n = writesStarted;
          const written = { ...row, ...data, updatedAt: new Date() };
          row = { ...written };
          returnedRows.push({ ...written });
          if (n === 1) {
            await secondWrite;
          } else {
            resolveSecondWrite();
          }
          return { ...written };
        }),
      },
    };
    const endpoints = new WebhookEndpointRepository(
      prisma as unknown as PrismaService,
    );
    const service = new WebhookEndpointService(endpoints, env);

    const [first, second] = await Promise.all([
      service.upsert(organizationId, { url: 'http://127.0.0.1:1/r1' }),
      service.upsert(organizationId, { url: 'http://127.0.0.1:1/r2' }),
    ]);

    expect(first.url).toBe('http://127.0.0.1:1/r1');
    expect(second.url).toBe('http://127.0.0.1:1/r2');
    expect(first.secretPrefix).toBe(webhookSecretPrefix(first.secret!));
    expect(second.secretPrefix).toBe(webhookSecretPrefix(second.secret!));
    expect(first.secret).not.toBe(second.secret);

    const rowForUrl = (url: string) =>
      returnedRows.find((item) => item.url === url)!;
    expect(
      decryptWebhookSecret(
        rowForUrl(first.url).secretCiphertext,
        ENCRYPTION_KEY,
        webhookSecretAad(organizationId, WINNER_ID),
      ),
    ).toBe(first.secret);
    expect(
      decryptWebhookSecret(
        rowForUrl(second.url).secretCiphertext,
        ENCRYPTION_KEY,
        webhookSecretAad(organizationId, WINNER_ID),
      ),
    ).toBe(second.secret);
    expect(rowForUrl(first.url).secretPrefix).toBe(first.secretPrefix);
    expect(rowForUrl(second.url).secretPrefix).toBe(second.secretPrefix);
    expect(row.url).toBe(returnedRows.at(-1)?.url);
    expect(prisma.webhookEndpoint.findFirst).toHaveBeenCalled();
    expect(prisma.webhookEndpoint.updateMany).not.toHaveBeenCalled();
    expect(JSON.stringify(first)).not.toContain(
      rowForUrl(first.url).secretCiphertext,
    );
    expect(JSON.stringify(second)).not.toContain(ENCRYPTION_KEY);
  });

  it('lets a late PUT rotate the winner after the first create commits', async () => {
    const store = createStore();
    const endpoints = repositoryFor(store);
    const service = new WebhookEndpointService(
      endpoints as unknown as WebhookEndpointRepository,
      env,
    );
    vi.mocked(randomUUID).mockReturnValueOnce(WINNER_ID);

    const created = await service.upsert(organizationId, {
      url: 'http://127.0.0.1:1/first',
    });
    const rotated = await service.upsert(organizationId, {
      url: 'http://127.0.0.1:1/second',
    });

    expect(created.id).toBe(WINNER_ID);
    expect(rotated.id).toBe(WINNER_ID);
    expect(rotated.secret).not.toBe(created.secret);
    assertSnapshotsDecryptWithPersistedId(store.snapshots);
    expect(
      decryptWebhookSecret(
        store.find()!.secretCiphertext,
        ENCRYPTION_KEY,
        webhookSecretAad(organizationId, WINNER_ID),
      ),
    ).toBe(rotated.secret);
  });

  it('propagates unexpected unique conflicts instead of rotating the winner', async () => {
    const store = createStore();
    const endpoints = repositoryFor(store, {
      create: vi.fn(async () => {
        throw { code: 'P2002', meta: { target: ['id'] } };
      }),
    });
    const service = new WebhookEndpointService(
      endpoints as unknown as WebhookEndpointRepository,
      env,
    );

    await expect(
      service.upsert(organizationId, { url: 'http://127.0.0.1:1/hook' }),
    ).rejects.toEqual({ code: 'P2002', meta: { target: ['id'] } });
    expect(store.find()).toBeNull();
    expect(endpoints.rotateForOrganization).not.toHaveBeenCalled();
  });

  it('does not map a vanished winner after the expected unique conflict to 404', async () => {
    const endpoints = {
      findByOrganizationAndEvent: vi.fn().mockResolvedValue(null),
      createForOrganization: vi.fn(async () => {
        throw organizationEventUniqueConflict();
      }),
      rotateForOrganization: vi.fn(),
      upsertForOrganization: vi.fn(),
    };
    const service = new WebhookEndpointService(
      endpoints as unknown as WebhookEndpointRepository,
      env,
    );

    await expect(
      service.upsert(organizationId, { url: 'http://127.0.0.1:1/hook' }),
    ).rejects.toEqual(organizationEventUniqueConflict());
    expect(endpoints.rotateForOrganization).not.toHaveBeenCalled();
  });

  it('treats the mapped unique constraint name as the expected create conflict', async () => {
    const store = createStore();
    const winner = store.create({
      id: WINNER_ID,
      organizationId,
      url: 'http://127.0.0.1:1/first',
      secretCiphertext: 'v2.placeholder',
      secretPrefix: 'oi_whsec_aaaaaaa',
    });
    store.snapshots.length = 0;
    const endpoints = {
      findByOrganizationAndEvent: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner),
      createForOrganization: vi.fn(async () => {
        throw {
          code: 'P2002',
          meta: { target: 'uq_webhook_endpoints_organization_id_event_type' },
        };
      }),
      rotateForOrganization: vi.fn(async (input) => store.rotate(input)),
      upsertForOrganization: vi.fn(),
    };
    const service = new WebhookEndpointService(
      endpoints as unknown as WebhookEndpointRepository,
      env,
    );

    const rotated = await service.upsert(organizationId, {
      url: 'http://127.0.0.1:1/after-conflict',
    });
    expect(rotated.id).toBe(WINNER_ID);
    expect(endpoints.rotateForOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ id: WINNER_ID, organizationId }),
    );
    assertSnapshotsDecryptWithPersistedId(store.snapshots);
  });

  it('returns GET without secret and DELETE without exposing ciphertext', async () => {
    const store = createStore();
    const created = store.create({
      id: WINNER_ID,
      organizationId,
      url: 'http://127.0.0.1:1/hook',
      secretCiphertext: 'v1-legacy-blob',
      secretPrefix: 'oi_whsec_bbbbbbb',
    });
    const endpoints = repositoryFor(store);
    const service = new WebhookEndpointService(
      endpoints as unknown as WebhookEndpointRepository,
      env,
    );

    const listed = await service.get(organizationId);
    expect(listed.secret).toBeUndefined();
    expect(listed.id).toBe(WINNER_ID);
    expect(JSON.stringify(listed)).not.toContain(created.secretCiphertext);

    const deactivated = await service.deactivate(organizationId);
    expect(deactivated.id).toBe(WINNER_ID);
    expect(deactivated.secret).toBeUndefined();
    expect(JSON.stringify(deactivated)).not.toContain(created.secretCiphertext);
  });
});
