import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmService } from './confirm.service.js';
import {
  confirmationFingerprint,
  confirmationJobId,
} from './confirmation-fingerprint.js';
import type { ImportRepository } from '../import.repository.js';
import type { TemplateRepository } from '../../template/template.repository.js';
import type {
  ImportExecutionRecord,
  ImportSessionRecord,
} from '../import.types.js';
import type { ImportTemplateRecord } from '../../template/template.types.js';
import type { ImportProcessingJobPublisher } from '../processing/ensure-processable-job.js';
import { ImportProcessingEnqueueError } from '../processing/ensure-processable-job.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const importId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sha = 'b'.repeat(64);

function uploadedSession(
  overrides: Partial<ImportSessionRecord> = {},
): ImportSessionRecord {
  const now = new Date('2026-09-03T12:00:00.000Z');
  return {
    id: importId,
    organizationId,
    templateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    status: 'uploaded',
    idempotencyKeyHash: 'aa',
    requestFingerprint: 'bb',
    originalFilename: 'products.csv',
    byteSize: 32,
    contentSha256: sha,
    encoding: 'utf-8',
    delimiter: ',',
    dataRowCount: 2,
    storageObjectKey: `org/${organizationId}/imports/${importId}.csv`,
    storageDeletedAt: null,
    storageCleanupClaimedAt: null,
    storageCleanupClaimToken: null,
    mapping: [
      { columnPosition: 0, fieldKey: 'sku' },
      { columnPosition: 1, fieldKey: 'priceInCents' },
    ],
    mappingRevision: 1,
    uploadedAt: now,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
    columns: [
      { id: 'c0', name: 'sku', position: 0 },
      { id: 'c1', name: 'price', position: 1 },
    ],
    ...overrides,
  };
}

function template(): ImportTemplateRecord {
  const now = new Date();
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    organizationId,
    name: 'products',
    createdAt: now,
    updatedAt: now,
    fields: [
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
  };
}

function execution(
  overrides: Partial<ImportExecutionRecord> = {},
): ImportExecutionRecord {
  const fingerprint = confirmationFingerprint({
    expectedMappingRevision: 1,
    expectedContentSha256: sha,
  });
  const now = new Date();
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    organizationId,
    importSessionId: importId,
    status: 'queued',
    confirmationFingerprint: fingerprint,
    expectedMappingRevision: 1,
    expectedContentSha256: sha,
    jobId: confirmationJobId(importId, fingerprint),
    attempt: 0,
    processedRows: 0,
    totalRows: 2,
    validRows: 0,
    invalidRows: 0,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ConfirmService', () => {
  let imports: {
    findByIdForOrganization: ReturnType<typeof vi.fn>;
    confirmSession: ReturnType<typeof vi.fn>;
    findLatestExecution: ReturnType<typeof vi.fn>;
  };
  let templates: { findByIdForOrganization: ReturnType<typeof vi.fn> };
  let jobs: { ensureProcessable: ReturnType<typeof vi.fn> };
  let service: ConfirmService;

  beforeEach(() => {
    imports = {
      findByIdForOrganization: vi.fn(),
      confirmSession: vi.fn(),
      findLatestExecution: vi.fn(),
    };
    templates = {
      findByIdForOrganization: vi.fn().mockResolvedValue(template()),
    };
    jobs = {
      ensureProcessable: vi.fn().mockResolvedValue({ outcome: 'missing_published' }),
    };
    service = new ConfirmService(
      imports as unknown as ImportRepository,
      templates as unknown as TemplateRepository,
      jobs as unknown as ImportProcessingJobPublisher,
    );
  });

  it('confirms an uploaded session and enqueues without processing CSV', async () => {
    const session = uploadedSession();
    const created = execution();
    imports.findByIdForOrganization.mockResolvedValue(session);
    imports.confirmSession.mockResolvedValue({
      session: { ...session, status: 'queued', confirmedAt: new Date() },
      execution: created,
    });

    const result = await service.confirm(organizationId, importId, {
      expectedMappingRevision: 1,
      expectedContentSha256: sha,
    });

    expect(result.status).toBe('queued');
    expect(result.replayed).toBe(false);
    expect(result.executionId).toBe(created.id);
    expect(jobs.ensureProcessable).toHaveBeenCalledOnce();
    expect(imports.confirmSession).toHaveBeenCalledOnce();
  });

  it('replays the same snapshot idempotently and ensures a processable job', async () => {
    const session = uploadedSession({ status: 'queued' });
    const existing = execution();
    imports.findByIdForOrganization.mockResolvedValue(session);
    imports.findLatestExecution.mockResolvedValue(existing);

    const result = await service.confirm(organizationId, importId, {
      expectedMappingRevision: 1,
      expectedContentSha256: sha,
    });

    expect(result.replayed).toBe(true);
    expect(result.executionId).toBe(existing.id);
    expect(imports.confirmSession).not.toHaveBeenCalled();
    expect(jobs.ensureProcessable).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: existing.id,
        jobId: existing.jobId,
        executionStatus: 'queued',
      }),
    );
  });

  it('on replay recovers when ensureProcessable republishes a failed job', async () => {
    const session = uploadedSession({ status: 'processing' });
    const existing = execution({ status: 'processing' });
    imports.findByIdForOrganization.mockResolvedValue(session);
    imports.findLatestExecution.mockResolvedValue(existing);
    jobs.ensureProcessable.mockResolvedValue({
      outcome: 'terminal_republished',
      previousState: 'failed',
    });

    const result = await service.confirm(organizationId, importId, {
      expectedMappingRevision: 1,
      expectedContentSha256: sha,
    });

    expect(result.replayed).toBe(true);
    expect(jobs.ensureProcessable).toHaveBeenCalledOnce();
  });

  it('returns 503 when replay cannot ensure a processable job', async () => {
    const session = uploadedSession({ status: 'processing' });
    const existing = execution({ status: 'processing' });
    imports.findByIdForOrganization.mockResolvedValue(session);
    imports.findLatestExecution.mockResolvedValue(existing);
    jobs.ensureProcessable.mockRejectedValue(
      new Error('IMPORT_PROCESSING_ENQUEUE_FAILED'),
    );

    await expect(
      service.confirm(organizationId, importId, {
        expectedMappingRevision: 1,
        expectedContentSha256: sha,
      }),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.PROCESSING_UNAVAILABLE' },
    });
  });

  it('returns 503 when ensureProcessable rejects persistent unknown', async () => {
    const session = uploadedSession({ status: 'queued' });
    const existing = execution({ status: 'queued' });
    imports.findByIdForOrganization.mockResolvedValue(session);
    imports.findLatestExecution.mockResolvedValue(existing);
    jobs.ensureProcessable.mockRejectedValue(
      new ImportProcessingEnqueueError(),
    );

    await expect(
      service.confirm(organizationId, importId, {
        expectedMappingRevision: 1,
        expectedContentSha256: sha,
      }),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.PROCESSING_UNAVAILABLE' },
    });
  });

  it('rejects incomplete mapping', async () => {
    imports.findByIdForOrganization.mockResolvedValue(
      uploadedSession({ mapping: [{ columnPosition: 0, fieldKey: 'sku' }] }),
    );

    await expect(
      service.confirm(organizationId, importId, {
        expectedMappingRevision: 1,
        expectedContentSha256: sha,
      }),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.MAPPING_INCOMPLETE' },
    });
  });

  it('rejects divergent revision', async () => {
    imports.findByIdForOrganization.mockResolvedValue(uploadedSession());

    await expect(
      service.confirm(organizationId, importId, {
        expectedMappingRevision: 9,
        expectedContentSha256: sha,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects divergent hash', async () => {
    imports.findByIdForOrganization.mockResolvedValue(uploadedSession());

    await expect(
      service.confirm(organizationId, importId, {
        expectedMappingRevision: 1,
        expectedContentSha256: 'c'.repeat(64),
      }),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.FILE_CHANGED' },
    });
  });

  it('treats concurrent CAS loss as replay when fingerprint matches', async () => {
    const session = uploadedSession();
    const existing = execution();
    imports.findByIdForOrganization
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ ...session, status: 'queued' });
    imports.confirmSession.mockResolvedValue(null);
    imports.findLatestExecution.mockResolvedValue(existing);

    const result = await service.confirm(organizationId, importId, {
      expectedMappingRevision: 1,
      expectedContentSha256: sha,
    });

    expect(result.replayed).toBe(true);
    expect(result.executionId).toBe(existing.id);
  });
});
