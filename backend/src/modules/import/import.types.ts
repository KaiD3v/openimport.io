import type { ImportSessionStatus } from '../../generated/prisma/client.js';

export type ImportColumnRecord = {
  id: string;
  name: string;
  position: number;
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
  uploadedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  columns: ImportColumnRecord[];
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
