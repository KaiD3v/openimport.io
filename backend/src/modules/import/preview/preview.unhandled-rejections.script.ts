import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { PreviewService } from './preview.service.js';
import type { Env } from '../../../core/config/env.js';
import type { ObjectStorage } from '../../../integrations/object-storage/object-storage.port.js';
import type { ImportRepository } from '../import.repository.js';
import type { ImportSessionRecord } from '../import.types.js';
import type { TemplateRepository } from '../../template/template.repository.js';

const organizationId = '11111111-1111-1111-1111-111111111111';
const importId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const templateId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function envFixture(maxBytes = 1_000_000): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'postgresql://openimport:openimport@localhost:5434/openimport',
    ALLOWED_ORIGINS: ['http://localhost:5173'],
    LOG_LEVEL: 'silent',
    ENABLE_DOCS: false,
    IMPORT_MAX_FILE_BYTES: maxBytes,
    IMPORT_MAX_DATA_ROWS: 10_000,
    IMPORT_MAX_COLUMNS: 50,
    IMPORT_MAX_FIELD_BYTES: 65_536,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'openimport',
    S3_SECRET_ACCESS_KEY: 'openimportsecret',
    S3_BUCKET: 'openimport',
    S3_FORCE_PATH_STYLE: true,
  } as Env;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function session(csv: Buffer, dataRowCount: number): ImportSessionRecord {
  const now = new Date('2026-09-03T12:00:00.000Z');
  return {
    id: importId,
    organizationId,
    templateId,
    status: 'uploaded',
    idempotencyKeyHash: 'aa',
    requestFingerprint: 'bb',
    originalFilename: 'products.csv',
    byteSize: csv.length,
    contentSha256: sha256(csv),
    encoding: 'utf-8',
    delimiter: ',',
    dataRowCount,
    storageObjectKey: `org/${organizationId}/imports/${importId}.csv`,
    mapping: [
      { columnPosition: 0, fieldKey: 'sku' },
      { columnPosition: 2, fieldKey: 'priceInCents' },
    ],
    mappingRevision: 1,
    uploadedAt: now,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
    columns: [
      { id: 'c0', name: 'sku', position: 0 },
      { id: 'c1', name: 'name', position: 1 },
      { id: 'c2', name: 'price', position: 2 },
    ],
  };
}

const template = {
  id: templateId,
  organizationId,
  name: 'products',
  createdAt: new Date(),
  updatedAt: new Date(),
  fields: [
    { key: 'sku', label: 'SKU', type: 'string' as const, required: true, position: 0 },
    {
      key: 'priceInCents',
      label: 'Preço',
      type: 'currency' as const,
      required: true,
      position: 1,
    },
  ],
};

function codeOf(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'getResponse' in error) {
    const response = (error as { getResponse: () => unknown }).getResponse();
    if (response && typeof response === 'object' && 'code' in response) {
      return String((response as { code: unknown }).code);
    }
  }
  return undefined;
}

function createService(
  openObject: () => Promise<Readable>,
  csv: Buffer,
  dataRowCount: number,
  overrides: Partial<Env> = {},
): PreviewService {
  const record = session(csv, dataRowCount);
  return new PreviewService(
    {
      findByIdForOrganization: async () => record,
    } as unknown as ImportRepository,
    {
      findByIdForOrganization: async () => template,
    } as unknown as TemplateRepository,
    {
      putObject: async () => undefined,
      openObject,
      deleteObject: async () => undefined,
    } as unknown as ObjectStorage,
    { ...envFixture(), ...overrides },
  );
}

async function expectCode(
  run: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    if (error instanceof Error && error.message === `expected ${code}`) {
      throw error;
    }
    if (codeOf(error) !== code) {
      throw error;
    }
  }
}

const csv = Buffer.from('sku,name,price\nA1,x,10\n', 'utf8');

let prematurePushed = false;
const premature = new Readable({
  read() {
    if (prematurePushed) {
      return;
    }
    prematurePushed = true;
    this.push(csv);
    queueMicrotask(() => {
      this.destroy();
    });
  },
});

await expectCode(
  () =>
    createService(async () => premature, csv, 1).preview(organizationId, importId, {
      expectedMappingRevision: 1,
    }),
  'IMPORT.PREVIEW_UNAVAILABLE',
);

let invalidSent = false;
const invalidUtf8 = new Readable({
  read() {
    if (invalidSent) {
      return;
    }
    invalidSent = true;
    this.push(csv);
    this.push(Buffer.from([0xff, 0x0a]));
  },
});

await expectCode(
  () =>
    createService(async () => invalidUtf8, csv, 1).preview(
      organizationId,
      importId,
      { expectedMappingRevision: 1 },
    ),
  'IMPORT.INVALID_CSV',
);
if (!invalidUtf8.destroyed) {
  throw new Error('invalid UTF-8 source was left open');
}

const oversized = Buffer.from('sku,name,price\nA1,Widget,10\nB2,Gadget,20\n', 'utf8');
let tooLargeSent = false;
const tooLarge = new Readable({
  read() {
    if (tooLargeSent) {
      return;
    }
    tooLargeSent = true;
    this.push(oversized);
  },
});

await expectCode(
  () =>
    createService(async () => tooLarge, oversized, 2, {
      IMPORT_MAX_FILE_BYTES: 20,
    }).preview(organizationId, importId, { expectedMappingRevision: 1 }),
  'IMPORT.FILE_TOO_LARGE',
);
if (!tooLarge.destroyed) {
  throw new Error('oversized source was left open');
}

let fieldPushed = false;
const fieldTooLarge = new Readable({
  read() {
    if (fieldPushed) {
      return;
    }
    fieldPushed = true;
    this.push(Buffer.from('sku\nABCDEFGHIJK\n', 'utf8'));
  },
});

await expectCode(
  () =>
    createService(async () => fieldTooLarge, csv, 1, {
      IMPORT_MAX_FIELD_BYTES: 8,
    }).preview(organizationId, importId, { expectedMappingRevision: 1 }),
  'IMPORT.INVALID_CSV',
);
if (!fieldTooLarge.destroyed) {
  throw new Error('field-limit source was left open');
}

await new Promise<void>((resolve) => {
  setImmediate(resolve);
});
