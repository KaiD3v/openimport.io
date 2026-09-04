export const IMPORT_PROCESSING_QUEUE = 'import-processing';

export type ImportProcessingJobData = {
  organizationId: string;
  importSessionId: string;
  executionId: string;
  traceId?: string;
};
