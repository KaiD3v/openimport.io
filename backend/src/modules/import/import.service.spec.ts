import { UnprocessableEntityException } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../core/config/env.js';
import type { ObjectStorage } from '../../integrations/object-storage/object-storage.port.js';
import { ImportRepository } from './import.repository.js';
import { ImportService } from './import.service.js';
import { TemplateRepository } from '../template/template.repository.js';
import { ImportAccessTokenService } from '../../core/auth/import-access-token.service.js';
import type { ImportSessionRecord } from './import.types.js';

const organizationId = '11111111-1111-1111-1111-111111111111';
const importId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BOUNDARY = '----OpenImportServiceBoundary';

function envFixture(): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'postgresql://openimport:openimport@localhost:5434/openimport',
    ALLOWED_ORIGINS: ['http://localhost:5173'],
    LOG_LEVEL: 'silent',
    ENABLE_DOCS: false,
    IMPORT_MAX_FILE_BYTES: 1024,
    IMPORT_MAX_DATA_ROWS: 10,
    IMPORT_MAX_COLUMNS: 10,
    IMPORT_MAX_FIELD_BYTES: 64,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'openimport',
    S3_SECRET_ACCESS_KEY: 'openimportsecret',
    S3_BUCKET: 'openimport',
    S3_FORCE_PATH_STYLE: true,
  } as Env;
}

function createdSession(): ImportSessionRecord {
  const now = new Date('2026-09-02T12:00:00.000Z');
  return {
    id: importId,
    organizationId,
    templateId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    status: 'created',
    idempotencyKeyHash: 'aa',
    requestFingerprint: 'bb',
    originalFilename: null,
    byteSize: null,
    contentSha256: null,
    encoding: null,
    delimiter: null,
    dataRowCount: null,
    storageObjectKey: null,
    mapping: [],
    mappingRevision: 0,
    uploadedAt: null,
    createdAt: now,
    updatedAt: now,
    columns: [],
  };
}

describe('ImportService.uploadFile stream cleanup', () => {
  let service: ImportService;
  let imports: {
    findByIdForOrganization: ReturnType<typeof vi.fn>;
    markUploaded: ReturnType<typeof vi.fn>;
    markUploadFailed: ReturnType<typeof vi.fn>;
  };
  let storage: {
    putObject: ReturnType<typeof vi.fn>;
    openObject: ReturnType<typeof vi.fn>;
    deleteObject: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    imports = {
      findByIdForOrganization: vi.fn().mockResolvedValue(createdSession()),
      markUploaded: vi.fn(),
      markUploadFailed: vi.fn(),
    };
    storage = {
      putObject: vi.fn(),
      openObject: vi.fn(),
      deleteObject: vi.fn(),
    };
    service = new ImportService(
      imports as unknown as ImportRepository,
      {} as TemplateRepository,
      {} as ImportAccessTokenService,
      storage as unknown as ObjectStorage,
      envFixture(),
    );
  });

  it('discards the file stream and request when filename and MIME are incompatible', async () => {
    const req = new Readable({
      read() {
        // pushed below
      },
    }) as IncomingMessage;
    req.headers = {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
    };
    const prelude = Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="workbook.xlsx"\r\nContent-Type: application/pdf\r\n\r\npartial-body`,
      'utf8',
    );
    queueMicrotask(() => {
      req.push(prelude);
    });

    await expect(
      service.uploadFile(organizationId, importId, req as Request),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    req.push(null);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('request was not drained'));
      }, 500);
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      if (req.readableEnded || req.destroyed) {
        done();
        return;
      }
      req.once('end', done);
      req.once('close', done);
    });
    expect(req.readableEnded || req.destroyed).toBe(true);
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(imports.markUploadFailed).not.toHaveBeenCalled();
  });
});
