import type { Prisma } from '../../generated/prisma/client.js';
import type { ImportReadyPayload } from './delivery/import-ready-payload.js';

export type WebhookEndpointRecord = {
  id: string;
  organizationId: string;
  url: string;
  secretCiphertext: string;
  secretPrefix: string;
  eventType: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type WebhookDeliveryRecord = {
  id: string;
  organizationId: string;
  endpointId: string;
  executionId: string;
  importSessionId: string;
  eventType: string;
  status: 'pending' | 'delivered' | 'failed';
  destinationUrl: string;
  secretCiphertext: string;
  payload: ImportReadyPayload;
  jobId: string;
  attemptCount: number;
  lastError: string | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type InsertImportReadyInput = {
  organizationId: string;
  importSessionId: string;
  executionId: string;
  counts: {
    totalRows: number | null;
    validRows: number;
    invalidRows: number;
    processedRows: number;
  };
};

export type WebhookReadyOutbox = {
  insertImportReadyInTransaction(
    tx: Prisma.TransactionClient,
    input: InsertImportReadyInput,
  ): Promise<string | null>;
};

export const WEBHOOK_READY_OUTBOX = Symbol('WEBHOOK_READY_OUTBOX');
