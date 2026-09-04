import { IMPORT_READY_EVENT_TYPE } from '../webhook.constants.js';

export type ImportReadyCounts = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  processedRows: number;
};

export type ImportReadyPayload = {
  id: string;
  type: typeof IMPORT_READY_EVENT_TYPE;
  createdAt: string;
  data: {
    organizationId: string;
    importId: string;
    executionId: string;
    status: 'ready';
    counts: ImportReadyCounts;
  };
};

export function buildImportReadyPayload(input: {
  id: string;
  createdAt: Date;
  organizationId: string;
  importId: string;
  executionId: string;
  counts: ImportReadyCounts;
}): ImportReadyPayload {
  return {
    id: input.id,
    type: IMPORT_READY_EVENT_TYPE,
    createdAt: input.createdAt.toISOString(),
    data: {
      organizationId: input.organizationId,
      importId: input.importId,
      executionId: input.executionId,
      status: 'ready',
      counts: {
        totalRows: input.counts.totalRows,
        validRows: input.counts.validRows,
        invalidRows: input.counts.invalidRows,
        processedRows: input.counts.processedRows,
      },
    },
  };
}

export function serializeWebhookPayload(payload: ImportReadyPayload): string {
  return JSON.stringify(payload);
}
