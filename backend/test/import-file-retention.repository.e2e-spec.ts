import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import {
  configureHttpApp,
  registerNotFoundFallback,
} from '../src/configure-http.js';
import { env } from '../src/core/config/env.singleton.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { ImportRepository } from '../src/modules/import/import.repository.js';
import {
  createTenant,
  type TestTenant,
} from './helpers/tenant.factory.js';

const RETENTION_HOURS = 168;
const CLAIM_TTL_MS = 120_000;

describe('Import file retention repository (postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let imports: ImportRepository;
  const organizationIds: string[] = [];

  const now = new Date('2026-09-04T12:00:00.000Z');
  const expiredFinishedAt = new Date(
    now.getTime() - (RETENTION_HOURS + 1) * 60 * 60 * 1000,
  );
  const recentFinishedAt = new Date(
    now.getTime() - (RETENTION_HOURS - 1) * 60 * 60 * 1000,
  );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureHttpApp(app, env);
    await app.init();
    registerNotFoundFallback(app);
    prisma = app.get(PrismaService);
    imports = app.get(ImportRepository);
  });

  afterEach(async () => {
    if (organizationIds.length === 0) {
      return;
    }
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    organizationIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  async function trackTenant(): Promise<TestTenant> {
    const tenant = await createTenant(prisma);
    organizationIds.push(tenant.organizationId);
    return tenant;
  }

  async function createTemplate(organizationId: string): Promise<string> {
    const template = await prisma.importTemplate.create({
      data: {
        organizationId,
        name: `retention-${randomUUID().slice(0, 8)}`,
        fields: {
          create: [
            {
              key: 'sku',
              label: 'SKU',
              type: 'string',
              required: true,
              position: 0,
            },
            {
              key: 'priceInCents',
              label: 'Preço',
              type: 'currency',
              required: true,
              position: 1,
            },
          ],
        },
      },
    });
    return template.id;
  }

  type FixtureInput = {
    organizationId: string;
    templateId: string;
    sessionStatus:
      | 'ready'
      | 'processing_failed'
      | 'uploaded'
      | 'queued'
      | 'processing';
    executionStatus: 'ready' | 'failed' | 'queued' | 'processing';
    finishedAt: Date | null;
    storageObjectKey?: string | null;
    storageDeletedAt?: Date | null;
    storageCleanupClaimedAt?: Date | null;
    storageCleanupClaimToken?: string | null;
    finishedAtOffsetMs?: number;
  };

  async function seedTerminalFixture(input: FixtureInput): Promise<{
    sessionId: string;
    executionId: string;
    storageObjectKey: string | null;
  }> {
    const sessionId = randomUUID();
    const executionId = randomUUID();
    const storageObjectKey =
      input.storageObjectKey === undefined
        ? `org/${input.organizationId}/imports/${sessionId}/fixture.csv`
        : input.storageObjectKey;

    await prisma.importSession.create({
      data: {
        id: sessionId,
        organizationId: input.organizationId,
        templateId: input.templateId,
        status: input.sessionStatus,
        idempotencyKeyHash: randomUUID().replace(/-/g, '').slice(0, 64),
        requestFingerprint: randomUUID().replace(/-/g, '').slice(0, 64),
        originalFilename: 'fixture.csv',
        byteSize: 32,
        contentSha256: 'a'.repeat(64),
        encoding: 'utf-8',
        delimiter: ',',
        dataRowCount: 1,
        storageObjectKey,
        storageDeletedAt: input.storageDeletedAt ?? null,
        storageCleanupClaimedAt: input.storageCleanupClaimedAt ?? null,
        storageCleanupClaimToken: input.storageCleanupClaimToken ?? null,
        mapping: [{ columnPosition: 0, fieldKey: 'sku' }],
        mappingRevision: 1,
        uploadedAt: now,
        confirmedAt: now,
      },
    });

    const finishedAt =
      input.finishedAt === null
        ? null
        : new Date(
            input.finishedAt.getTime() + (input.finishedAtOffsetMs ?? 0),
          );

    await prisma.importExecution.create({
      data: {
        id: executionId,
        organizationId: input.organizationId,
        importSessionId: sessionId,
        status: input.executionStatus,
        confirmationFingerprint: randomUUID().replace(/-/g, '').slice(0, 64),
        expectedMappingRevision: 1,
        expectedContentSha256: 'a'.repeat(64),
        jobId: `import-process.${sessionId}.${randomUUID()}`,
        attempt: 1,
        processedRows: 1,
        totalRows: 1,
        validRows: 1,
        invalidRows: 0,
        startedAt: now,
        finishedAt,
      },
    });

    return { sessionId, executionId, storageObjectKey };
  }

  function listParams(overrides: {
    now?: Date;
    claimTtlMs?: number;
    limit?: number;
    after?: { finishedAt: Date; id: string } | null;
  } = {}) {
    return {
      limit: overrides.limit ?? 50,
      retentionHours: RETENTION_HOURS,
      claimTtlMs: overrides.claimTtlMs ?? CLAIM_TTL_MS,
      now: overrides.now ?? now,
      after: overrides.after ?? null,
    };
  }

  it('lists ready and processing_failed when finishedAt is past the retention cutoff', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.organizationId);
    const ready = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'ready',
      executionStatus: 'ready',
      finishedAt: expiredFinishedAt,
    });
    const failed = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'processing_failed',
      executionStatus: 'failed',
      finishedAt: new Date(expiredFinishedAt.getTime() + 1000),
    });

    const listed = await imports.listFileRetentionCandidates(listParams());
    const ids = listed
      .filter((row) => row.organizationId === tenant.organizationId)
      .map((row) => row.id);

    expect(ids).toEqual(
      expect.arrayContaining([ready.sessionId, failed.sessionId]),
    );
  });

  it('excludes non-terminal sessions and recent finishedAt', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.organizationId);

    const uploaded = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'uploaded',
      executionStatus: 'queued',
      finishedAt: null,
    });
    const queued = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'queued',
      executionStatus: 'queued',
      finishedAt: null,
    });
    const processing = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'processing',
      executionStatus: 'processing',
      finishedAt: null,
    });
    const recent = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'ready',
      executionStatus: 'ready',
      finishedAt: recentFinishedAt,
    });

    const listed = await imports.listFileRetentionCandidates(listParams());
    const ids = new Set(listed.map((row) => row.id));

    expect(ids.has(uploaded.sessionId)).toBe(false);
    expect(ids.has(queued.sessionId)).toBe(false);
    expect(ids.has(processing.sessionId)).toBe(false);
    expect(ids.has(recent.sessionId)).toBe(false);
  });

  it('hides a valid claim from listing and re-lists after lease expiry via now', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.organizationId);
    const fixture = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'ready',
      executionStatus: 'ready',
      finishedAt: expiredFinishedAt,
    });

    const token = randomUUID();
    const claimedAt = now;
    const claim = await imports.claimFileRetentionCandidate(
      fixture.sessionId,
      token,
      claimedAt,
      CLAIM_TTL_MS,
    );
    expect(claim.claimed).toBe(true);

    const whileHeld = await imports.listFileRetentionCandidates(
      listParams({ now: claimedAt }),
    );
    expect(whileHeld.map((row) => row.id)).not.toContain(fixture.sessionId);

    const afterLease = new Date(claimedAt.getTime() + CLAIM_TTL_MS + 1);
    const listedAgain = await imports.listFileRetentionCandidates(
      listParams({ now: afterLease }),
    );
    expect(listedAgain.map((row) => row.id)).toContain(fixture.sessionId);
  });

  it('allows exactly one winner when two claims race', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.organizationId);
    const fixture = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'ready',
      executionStatus: 'ready',
      finishedAt: expiredFinishedAt,
    });

    const tokenA = randomUUID();
    const tokenB = randomUUID();
    const [a, b] = await Promise.all([
      imports.claimFileRetentionCandidate(
        fixture.sessionId,
        tokenA,
        now,
        CLAIM_TTL_MS,
      ),
      imports.claimFileRetentionCandidate(
        fixture.sessionId,
        tokenB,
        now,
        CLAIM_TTL_MS,
      ),
    ]);

    const winners = [a, b].filter((row) => row.claimed);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.storageObjectKey).toBe(fixture.storageObjectKey);

    const session = await prisma.importSession.findUniqueOrThrow({
      where: { id: fixture.sessionId },
    });
    expect(session.storageCleanupClaimToken).toEqual(expect.any(String));
    expect([tokenA, tokenB]).toContain(session.storageCleanupClaimToken);
  });

  it('completes only with the current claim token and rejects stale tokens', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.organizationId);
    const fixture = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'ready',
      executionStatus: 'ready',
      finishedAt: expiredFinishedAt,
    });

    const staleToken = randomUUID();
    const first = await imports.claimFileRetentionCandidate(
      fixture.sessionId,
      staleToken,
      now,
      CLAIM_TTL_MS,
    );
    expect(first.claimed).toBe(true);

    const reclaimAt = new Date(now.getTime() + CLAIM_TTL_MS + 1);
    const freshToken = randomUUID();
    const second = await imports.claimFileRetentionCandidate(
      fixture.sessionId,
      freshToken,
      reclaimAt,
      CLAIM_TTL_MS,
    );
    expect(second.claimed).toBe(true);

    const staleComplete = await imports.completeFileRetentionCleanup(
      fixture.sessionId,
      {
        expectedKey: fixture.storageObjectKey!,
        claimToken: staleToken,
        deletedAt: reclaimAt,
      },
    );
    expect(staleComplete).toBe(false);

    const still = await prisma.importSession.findUniqueOrThrow({
      where: { id: fixture.sessionId },
    });
    expect(still.storageObjectKey).toBe(fixture.storageObjectKey);
    expect(still.storageDeletedAt).toBeNull();
    expect(still.storageCleanupClaimToken).toBe(freshToken);

    const ok = await imports.completeFileRetentionCleanup(fixture.sessionId, {
      expectedKey: fixture.storageObjectKey!,
      claimToken: freshToken,
      deletedAt: reclaimAt,
    });
    expect(ok).toBe(true);

    const done = await prisma.importSession.findUniqueOrThrow({
      where: { id: fixture.sessionId },
    });
    expect(done.storageObjectKey).toBeNull();
    expect(done.storageDeletedAt).toEqual(reclaimAt);
    expect(done.storageCleanupClaimToken).toBeNull();
    expect(done.storageCleanupClaimedAt).toBeNull();
  });

  it('release with the correct token re-enables listing; wrong token is a no-op', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.organizationId);
    const fixture = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'processing_failed',
      executionStatus: 'failed',
      finishedAt: expiredFinishedAt,
    });

    const token = randomUUID();
    await imports.claimFileRetentionCandidate(
      fixture.sessionId,
      token,
      now,
      CLAIM_TTL_MS,
    );

    await imports.releaseFileRetentionClaim(fixture.sessionId, randomUUID());
    const afterWrong = await prisma.importSession.findUniqueOrThrow({
      where: { id: fixture.sessionId },
    });
    expect(afterWrong.storageCleanupClaimToken).toBe(token);

    await imports.releaseFileRetentionClaim(fixture.sessionId, token);
    const afterRelease = await prisma.importSession.findUniqueOrThrow({
      where: { id: fixture.sessionId },
    });
    expect(afterRelease.storageCleanupClaimToken).toBeNull();
    expect(afterRelease.storageCleanupClaimedAt).toBeNull();
    expect(afterRelease.storageObjectKey).toBe(fixture.storageObjectKey);

    const listed = await imports.listFileRetentionCandidates(listParams());
    expect(
      listed
        .filter((row) => row.organizationId === tenant.organizationId)
        .map((row) => row.id),
    ).toContain(fixture.sessionId);
  });

  it('blocks reclaim after a logical crash until the lease expires, then completes', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.organizationId);
    const fixture = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'ready',
      executionStatus: 'ready',
      finishedAt: expiredFinishedAt,
    });

    const crashToken = randomUUID();
    const claimedAt = now;
    const first = await imports.claimFileRetentionCandidate(
      fixture.sessionId,
      crashToken,
      claimedAt,
      CLAIM_TTL_MS,
    );
    expect(first.claimed).toBe(true);
    // Simulate successful S3 delete without complete CAS (process crash).

    const midLease = new Date(claimedAt.getTime() + CLAIM_TTL_MS / 2);
    const mid = await imports.claimFileRetentionCandidate(
      fixture.sessionId,
      randomUUID(),
      midLease,
      CLAIM_TTL_MS,
    );
    expect(mid.claimed).toBe(false);

    const whileHeld = await imports.listFileRetentionCandidates(
      listParams({ now: midLease }),
    );
    expect(whileHeld.map((row) => row.id)).not.toContain(fixture.sessionId);

    const afterLease = new Date(claimedAt.getTime() + CLAIM_TTL_MS + 1);
    const recoveryToken = randomUUID();
    const recovered = await imports.claimFileRetentionCandidate(
      fixture.sessionId,
      recoveryToken,
      afterLease,
      CLAIM_TTL_MS,
    );
    expect(recovered.claimed).toBe(true);
    expect(recovered.storageObjectKey).toBe(fixture.storageObjectKey);

    const staleComplete = await imports.completeFileRetentionCleanup(
      fixture.sessionId,
      {
        expectedKey: fixture.storageObjectKey!,
        claimToken: crashToken,
        deletedAt: afterLease,
      },
    );
    expect(staleComplete).toBe(false);

    const completed = await imports.completeFileRetentionCleanup(
      fixture.sessionId,
      {
        expectedKey: fixture.storageObjectKey!,
        claimToken: recoveryToken,
        deletedAt: afterLease,
      },
    );
    expect(completed).toBe(true);

    const session = await prisma.importSession.findUniqueOrThrow({
      where: { id: fixture.sessionId },
    });
    expect(session.storageObjectKey).toBeNull();
    expect(session.storageDeletedAt).toEqual(afterLease);

    const execution = await prisma.importExecution.findUniqueOrThrow({
      where: { id: fixture.executionId },
    });
    expect(execution.status).toBe('ready');
  });

  it('pages by finishedAt cursor without duplicating session ids', async () => {
    const tenant = await trackTenant();
    const templateId = await createTemplate(tenant.organizationId);
    // Isolate from other tenants by using a controlled clock far in the past.
    const pageNow = new Date('1990-01-10T00:00:00.000Z');
    const baseFinished = new Date('1990-01-01T00:00:00.000Z');

    const a = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'ready',
      executionStatus: 'ready',
      finishedAt: baseFinished,
      finishedAtOffsetMs: 0,
    });
    const b = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'ready',
      executionStatus: 'ready',
      finishedAt: baseFinished,
      finishedAtOffsetMs: 1000,
    });
    const c = await seedTerminalFixture({
      organizationId: tenant.organizationId,
      templateId,
      sessionStatus: 'ready',
      executionStatus: 'ready',
      finishedAt: baseFinished,
      finishedAtOffsetMs: 2000,
    });

    const page1 = await imports.listFileRetentionCandidates(
      listParams({ limit: 2, now: pageNow }),
    );
    expect(page1).toHaveLength(2);
    expect(page1.map((row) => row.id)).toEqual([a.sessionId, b.sessionId]);

    const page2 = await imports.listFileRetentionCandidates(
      listParams({
        limit: 2,
        now: pageNow,
        after: { finishedAt: page1[1]!.finishedAt, id: page1[1]!.id },
      }),
    );
    expect(page2.map((row) => row.id)).toEqual([c.sessionId]);

    const allIds = [...page1, ...page2].map((row) => row.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('exposes idx_import_executions_file_retention in pg_indexes', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'import_executions'
        AND indexname = 'idx_import_executions_file_retention'
    `;
    expect(rows).toEqual([
      { indexname: 'idx_import_executions_file_retention' },
    ]);
  });
});
