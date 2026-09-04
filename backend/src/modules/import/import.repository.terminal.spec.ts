import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../core/database/prisma.service.js';
import { ImportRepository } from './import.repository.js';

describe('ImportRepository terminal transitions', () => {
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
  };
  let outbox: {
    insertImportReadyInTransaction: ReturnType<typeof vi.fn>;
  };
  let repo: ImportRepository;

  const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const execId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  beforeEach(() => {
    prisma = {
      $transaction: vi.fn(),
    };
    outbox = {
      insertImportReadyInTransaction: vi.fn().mockResolvedValue(null),
    };
    repo = new ImportRepository(
      prisma as unknown as PrismaService,
      outbox as never,
    );
  });

  it('failExecutionAndDiscardRecords does not delete when execution CAS loses', async () => {
    const tx = {
      importExecution: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue({
          id: execId,
          status: 'ready',
        }),
      },
      importRecord: {
        deleteMany: vi.fn(),
        count: vi.fn(),
      },
      importSession: {
        updateMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));

    const ok = await repo.failExecutionAndDiscardRecords(
      orgId,
      execId,
      sessionId,
      { code: 'IMPORT.PROCESSING_FAILED', message: 'boom' },
    );

    expect(ok).toBe(false);
    expect(tx.importExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['queued', 'processing'] },
        }),
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(tx.importRecord.deleteMany).not.toHaveBeenCalled();
    expect(tx.importSession.updateMany).not.toHaveBeenCalled();
  });

  it('failExecutionAndDiscardRecords CAS session miss throws so the transaction rolls back', async () => {
    const tx = {
      importExecution: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      importRecord: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      importSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));

    await expect(
      repo.failExecutionAndDiscardRecords(orgId, execId, sessionId, {
        code: 'IMPORT.PROCESSING_FAILED',
        message: 'boom',
      }),
    ).rejects.toThrow(/session/i);

    expect(tx.importRecord.deleteMany).toHaveBeenCalled();
  });

  it('markExecutionReady inserts a webhook delivery in the same transaction after a won CAS', async () => {
    const tx = {
      importExecution: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      importSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    outbox.insertImportReadyInTransaction.mockResolvedValue('delivery-1');

    const result = await repo.markExecutionReady(orgId, execId, sessionId, {
      processedRows: 2,
      validRows: 1,
      invalidRows: 1,
      totalRows: 2,
    });

    expect(result).toEqual({
      published: true,
      webhookDeliveryId: 'delivery-1',
    });
    expect(outbox.insertImportReadyInTransaction).toHaveBeenCalledWith(tx, {
      organizationId: orgId,
      importSessionId: sessionId,
      executionId: execId,
      counts: {
        processedRows: 2,
        validRows: 1,
        invalidRows: 1,
        totalRows: 2,
      },
    });
  });

  it('markExecutionReady is a no-op for webhooks when CAS loses', async () => {
    const tx = {
      importExecution: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      importSession: {
        updateMany: vi.fn(),
      },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));

    const result = await repo.markExecutionReady(orgId, execId, sessionId, {
      processedRows: 2,
      validRows: 1,
      invalidRows: 1,
      totalRows: 2,
    });

    expect(result).toEqual({ published: false, webhookDeliveryId: null });
    expect(tx.importSession.updateMany).not.toHaveBeenCalled();
    expect(outbox.insertImportReadyInTransaction).not.toHaveBeenCalled();
  });

  it('markExecutionReady does not insert a delivery when the session CAS rolls back', async () => {
    const tx = {
      importExecution: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      importSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));

    await expect(
      repo.markExecutionReady(orgId, execId, sessionId, {
        processedRows: 2,
        validRows: 1,
        invalidRows: 1,
        totalRows: 2,
      }),
    ).rejects.toThrow(/session/i);
    expect(outbox.insertImportReadyInTransaction).not.toHaveBeenCalled();
  });

  it('failExecutionAndDiscardRecords returns true for already-failed coherent state without mutating session again', async () => {
    const tx = {
      importExecution: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue({
          id: execId,
          status: 'failed',
        }),
      },
      importRecord: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        count: vi.fn().mockResolvedValue(0),
      },
      importSession: {
        findFirst: vi.fn().mockResolvedValue({
          id: sessionId,
          status: 'processing_failed',
        }),
        updateMany: vi.fn(),
      },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));

    const ok = await repo.failExecutionAndDiscardRecords(
      orgId,
      execId,
      sessionId,
      { code: 'IMPORT.PROCESSING_FAILED', message: 'boom' },
    );

    expect(ok).toBe(true);
    expect(tx.importSession.updateMany).not.toHaveBeenCalled();
  });
});
