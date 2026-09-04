import type {
  ImportExecutionStatus,
  ImportRecordClassification,
  ImportSessionStatus,
} from '../../generated/prisma/client.js';
import type { FieldError } from './normalize/normalize.js';

export type ImportColumnRecord = {
  id: string;
  name: string;
  position: number;
};

export type ImportMappingPairRecord = {
  columnPosition: number;
  fieldKey: string;
};

export type ImportSessionRecord = {
  id: string;
  organizationId: string;
  templateId: string;
  status: ImportSessionStatus;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  originalFilename: string | null;
  byteSize: number | null;
  contentSha256: string | null;
  encoding: string | null;
  delimiter: string | null;
  dataRowCount: number | null;
  storageObjectKey: string | null;
  storageDeletedAt: Date | null;
  storageCleanupClaimedAt: Date | null;
  storageCleanupClaimToken: string | null;
  mapping: ImportMappingPairRecord[] | unknown;
  mappingRevision: number;
  uploadedAt: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  columns: ImportColumnRecord[];
};

export type FileRetentionCandidate = {
  id: string;
  organizationId: string;
  status: ImportSessionStatus;
  storageObjectKey: string;
  finishedAt: Date;
};

export type CreateImportSessionData = {
  templateId: string;
  idempotencyKeyHash: string;
  requestFingerprint: string;
};

export type MarkUploadedData = {
  originalFilename: string;
  byteSize: number;
  contentSha256: string;
  encoding: string;
  delimiter: string;
  dataRowCount: number;
  storageObjectKey: string;
  columns: Array<{ name: string; position: number }>;
};

export type ImportExecutionRecord = {
  id: string;
  organizationId: string;
  importSessionId: string;
  status: ImportExecutionStatus;
  confirmationFingerprint: string;
  expectedMappingRevision: number;
  expectedContentSha256: string;
  jobId: string;
  attempt: number;
  processedRows: number;
  totalRows: number | null;
  validRows: number;
  invalidRows: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateExecutionData = {
  confirmationFingerprint: string;
  expectedMappingRevision: number;
  expectedContentSha256: string;
  jobId: string;
  totalRows: number | null;
};

export type ImportRecordWrite = {
  recordNumber: number;
  classification: ImportRecordClassification;
  payload: Record<string, string | number> | null;
  errors: FieldError[] | null;
};

export type ImportRejectedRecord = {
  recordNumber: number;
  errors: FieldError[];
};

export type ImportValidRecord = {
  recordNumber: number;
  payload: unknown;
};

export type ImportClientResultOutcome = 'accepted' | 'rejected';

export type ImportResultBatchRecord = {
  id: string;
  organizationId: string;
  importSessionId: string;
  executionId: string;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  itemCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ImportRecordResultWrite = {
  recordNumber: number;
  outcome: ImportClientResultOutcome;
  clientRecordId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type ImportResultsSummaryCounts = {
  totalValid: number;
  reported: number;
  accepted: number;
  rejected: number;
  pending: number;
  isComplete: boolean;
};
