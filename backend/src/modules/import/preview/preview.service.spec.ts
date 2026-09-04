import { ConflictException, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../core/config/env.js';
import type { ObjectStorage } from '../../../integrations/object-storage/object-storage.port.js';
import { ImportRepository } from '../import.repository.js';
import type { ImportSessionRecord } from '../import.types.js';
import { TemplateRepository } from '../../template/template.repository.js';
import { PreviewService } from './preview.service.js';

const execFileAsync = promisify(execFile);

const organizationId = '11111111-1111-1111-1111-111111111111';
const importId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const templateId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function envFixture(): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'postgresql://openimport:openimport@localhost:5434/openimport',
    ALLOWED_ORIGINS: ['http://localhost:5173'],
    LOG_LEVEL: 'silent',
    ENABLE_DOCS: false,
    IMPORT_MAX_FILE_BYTES: 1_000_000,
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

function csvBuffer(csv: string, withBom = false): Buffer {
  const body = Buffer.from(csv, 'utf8');
  if (!withBom) {
    return body;
  }
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]);
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function uploadedSession(
  csv: Buffer,
  overrides: Partial<ImportSessionRecord> = {},
): ImportSessionRecord {
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
    dataRowCount: 2,
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
    ...overrides,
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

async function expectNoProcessLeaks(run: () => Promise<void>): Promise<void> {
  const leaks: string[] = [];
  const onRejection = (reason: unknown) => {
    leaks.push(`unhandledRejection:${String(reason)}`);
  };
  const onException = (error: Error) => {
    leaks.push(`uncaughtException:${error.message}`);
  };
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  try {
    await run();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(leaks).toEqual([]);
  } finally {
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onException);
  }
}

describe('PreviewService', () => {
  let service: PreviewService;
  let imports: {
    findByIdForOrganization: ReturnType<typeof vi.fn>;
  };
  let templates: {
    findByIdForOrganization: ReturnType<typeof vi.fn>;
  };
  let storage: {
    putObject: ReturnType<typeof vi.fn>;
    openObject: ReturnType<typeof vi.fn>;
    deleteObject: ReturnType<typeof vi.fn>;
  };

  const productCsv = csvBuffer(
    'sku,name,price\nTEN-001,Tênis Runner,"299,90"\nTEN-002,Bad,299.90\n',
  );

  beforeEach(() => {
    imports = {
      findByIdForOrganization: vi.fn().mockResolvedValue(uploadedSession(productCsv)),
    };
    templates = {
      findByIdForOrganization: vi.fn().mockResolvedValue(template),
    };
    storage = {
      putObject: vi.fn(),
      openObject: vi.fn().mockResolvedValue(Readable.from([productCsv])),
      deleteObject: vi.fn(),
    };
    service = new PreviewService(
      imports as unknown as ImportRepository,
      templates as unknown as TemplateRepository,
      storage as unknown as ObjectStorage,
      envFixture(),
    );
  });

  it('returns exact normalized values and collects invalid rows', async () => {
    const result = await service.preview(organizationId, importId, {
      expectedMappingRevision: 1,
    });

    expect(result.normalizationProfile).toBe('pt-BR-v1');
    expect(result.mappingRevision).toBe(1);
    expect(result.contentSha256).toBe(sha256(productCsv));
    expect(result.summary).toEqual({
      totalRows: 2,
      validRows: 1,
      invalidRows: 1,
    });
    expect(result.rows[0]).toEqual({
      recordNumber: 1,
      valid: true,
      data: { sku: 'TEN-001', priceInCents: 29990 },
      errors: [],
    });
    expect(result.rows[1]).toMatchObject({
      recordNumber: 2,
      valid: false,
      data: null,
    });
    expect(result.rows[1]?.errors[0]?.code).toBe('FIELD.INVALID_CURRENCY');
    expect(JSON.stringify(result.rows[1]?.errors)).not.toContain('299.90');
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('keeps full-file stats when the sample is limited', async () => {
    const many = csvBuffer(
      `sku,name,price\n${'A1,x,10\n'.repeat(5)}`,
    );
    imports.findByIdForOrganization.mockResolvedValue(
      uploadedSession(many, { dataRowCount: 5 }),
    );
    storage.openObject.mockResolvedValue(Readable.from([many]));

    const result = await service.preview(organizationId, importId, {
      expectedMappingRevision: 1,
      limit: 2,
    });

    expect(result.limit).toBe(2);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.recordNumber)).toEqual([1, 2]);
    expect(result.summary.totalRows).toBe(5);
    expect(result.summary.validRows).toBe(5);
    expect(result.sampleTruncated).toBe(true);
  });

  it('stops sampling after the first rejected append and still counts later rows', async () => {
    const budget = await import('./sample-budget.js');
    const spy = vi.spyOn(budget, 'canAppendPreviewRow').mockImplementation(
      (envelope) => envelope.rows.length === 0,
    );

    const many = csvBuffer(`sku,name,price\n${'A1,x,10\n'.repeat(4)}`);
    imports.findByIdForOrganization.mockResolvedValue(
      uploadedSession(many, { dataRowCount: 4 }),
    );
    storage.openObject.mockResolvedValue(Readable.from([many]));

    try {
      const result = await service.preview(organizationId, importId, {
        expectedMappingRevision: 1,
        limit: 20,
      });
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.recordNumber).toBe(1);
      expect(result.summary).toEqual({
        totalRows: 4,
        validRows: 4,
        invalidRows: 0,
      });
      expect(result.sampleTruncated).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects incomplete mapping and stale revision before opening storage', async () => {
    imports.findByIdForOrganization.mockResolvedValue(
      uploadedSession(productCsv, {
        mapping: [{ columnPosition: 0, fieldKey: 'sku' }],
        mappingRevision: 1,
      }),
    );

    await expect(
      service.preview(organizationId, importId, { expectedMappingRevision: 1 }),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.MAPPING_INCOMPLETE' },
    });
    expect(storage.openObject).not.toHaveBeenCalled();

    imports.findByIdForOrganization.mockResolvedValue(uploadedSession(productCsv));
    await expect(
      service.preview(organizationId, importId, { expectedMappingRevision: 0 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.openObject).not.toHaveBeenCalled();
  });

  it('returns 404 without opening storage for a missing session', async () => {
    imports.findByIdForOrganization.mockResolvedValue(null);
    await expect(
      service.preview(organizationId, importId, { expectedMappingRevision: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.openObject).not.toHaveBeenCalled();
  });

  it('rejects created sessions before opening storage', async () => {
    imports.findByIdForOrganization.mockResolvedValue(
      uploadedSession(productCsv, { status: 'created', mappingRevision: 0, mapping: [] }),
    );
    await expect(
      service.preview(organizationId, importId, { expectedMappingRevision: 0 }),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.PREVIEW_NOT_ALLOWED' },
    });
    expect(storage.openObject).not.toHaveBeenCalled();
  });

  it('detects a replaced object as FILE_CHANGED', async () => {
    const other = csvBuffer('sku,name,price\nZ9,Other,20\nY8,Else,30\n');
    storage.openObject.mockResolvedValue(Readable.from([other]));

    await expect(
      service.preview(organizationId, importId, { expectedMappingRevision: 1 }),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.FILE_CHANGED' },
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('discards the computed preview when mapping revision changes during the read', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = uploadedSession(productCsv);

    storage.openObject.mockImplementation(async () =>
      Readable.from(
        (async function* () {
          const headerEnd = productCsv.indexOf(0x0a) + 1;
          yield productCsv.subarray(0, headerEnd);
          await gate;
          yield productCsv.subarray(headerEnd);
        })(),
      ),
    );

    imports.findByIdForOrganization
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ ...session, mappingRevision: 2 });

    const pending = service.preview(organizationId, importId, {
      expectedMappingRevision: 1,
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    release();

    await expect(pending).rejects.toMatchObject({
      response: { code: 'IMPORT.MAPPING_REVISION_CONFLICT' },
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('maps a late storage read failure to PREVIEW_UNAVAILABLE without deleting the object', async () => {
    await expectNoProcessLeaks(async () => {
      storage.openObject.mockImplementation(async () =>
        Readable.from(
          (async function* () {
            yield Buffer.from('sku,name,price\nTEN-001,x,10\n', 'utf8');
            await new Promise((resolve) => {
              setTimeout(resolve, 10);
            });
            throw new Error('storage read failed');
          })(),
        ),
      );

      await expect(
        service.preview(organizationId, importId, { expectedMappingRevision: 1 }),
      ).rejects.toMatchObject({
        response: { code: 'IMPORT.PREVIEW_UNAVAILABLE' },
      });
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
  });

  it('maps invalid UTF-8 during preview to INVALID_CSV without deleting the object', async () => {
    const invalid = Buffer.concat([
      Buffer.from('sku,name,price\nA1,x,10\n', 'utf8'),
      Buffer.from([0xff]),
    ]);
    imports.findByIdForOrganization.mockResolvedValue(
      uploadedSession(invalid, { dataRowCount: 1, contentSha256: sha256(invalid) }),
    );
    storage.openObject.mockResolvedValue(Readable.from([invalid]));

    await expect(
      service.preview(organizationId, importId, { expectedMappingRevision: 1 }),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT.INVALID_CSV' },
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('rejects with 503 in bounded time when the source closes without EOF', async () => {
    await expectNoProcessLeaks(async () => {
      let closed!: () => void;
      const sawClose = new Promise<void>((resolve) => {
        closed = resolve;
      });
      let pushed = false;
      const source = new Readable({
        read() {
          if (pushed) {
            return;
          }
          pushed = true;
          this.push(Buffer.from('sku,name,price\nA1,x,10\n', 'utf8'));
          queueMicrotask(() => {
            this.destroy();
          });
        },
      });
      source.once('close', () => {
        closed();
      });

      storage.openObject.mockResolvedValue(source);
      imports.findByIdForOrganization.mockResolvedValue(
        uploadedSession(productCsv, { dataRowCount: 1 }),
      );

      const pending = service.preview(organizationId, importId, {
        expectedMappingRevision: 1,
      });
      await sawClose;

      const hung = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('preview hung after premature close')),
          1000,
        );
      });

      await expect(Promise.race([pending, hung])).rejects.toMatchObject({
        response: { code: 'IMPORT.PREVIEW_UNAVAILABLE' },
      });
      expect(source.destroyed).toBe(true);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
  });

  it('returns 422 for invalid UTF-8 and destroys a source that is still open', async () => {
    await expectNoProcessLeaks(async () => {
      let sent = false;
      const source = new Readable({
        read() {
          if (sent) {
            return;
          }
          sent = true;
          this.push(Buffer.from('sku,name,price\nA1,x,10\n', 'utf8'));
          this.push(Buffer.from([0xff, 0x0a]));
        },
      });

      storage.openObject.mockResolvedValue(source);
      imports.findByIdForOrganization.mockResolvedValue(
        uploadedSession(productCsv, { dataRowCount: 1 }),
      );

      await expect(
        service.preview(organizationId, importId, { expectedMappingRevision: 1 }),
      ).rejects.toMatchObject({
        response: { code: 'IMPORT.INVALID_CSV' },
      });
      expect(source.destroyed).toBe(true);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
  });

  it('returns 422 for structural CSV errors without waiting for source EOF', async () => {
    const cases: Array<{
      csv: string;
      env?: Partial<Env>;
      label: string;
    }> = [
      {
        csv: 'sku\nABCDEFGHIJK\n',
        env: { IMPORT_MAX_FIELD_BYTES: 8 },
        label: 'field size',
      },
      {
        csv: 'sku\nA\nB\n',
        env: { IMPORT_MAX_DATA_ROWS: 1 },
        label: 'row limit',
      },
      { csv: 'sku\nA,B\n', label: 'inconsistent columns' },
      { csv: 'sku,sku\nA,B\n', label: 'duplicate header' },
    ];

    for (const { csv, env, label } of cases) {
      await expectNoProcessLeaks(async () => {
        let pushed = false;
        const source = new Readable({
          read() {
            if (pushed) {
              return;
            }
            pushed = true;
            this.push(Buffer.from(csv, 'utf8'));
          },
        });
        const previewEnv = envFixture();
        Object.assign(previewEnv, env);
        service = new PreviewService(
          imports as unknown as ImportRepository,
          templates as unknown as TemplateRepository,
          storage as unknown as ObjectStorage,
          previewEnv,
        );
        storage.openObject.mockResolvedValue(source);
        imports.findByIdForOrganization.mockResolvedValue(
          uploadedSession(productCsv, { dataRowCount: 1 }),
        );

        const hung = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`preview hung on ${label}`)),
            1000,
          );
        });

        await expect(
          Promise.race([
            service.preview(organizationId, importId, {
              expectedMappingRevision: 1,
            }),
            hung,
          ]),
        ).rejects.toMatchObject({
          response: { code: 'IMPORT.INVALID_CSV' },
        });
        expect(source.destroyed).toBe(true);
        expect(storage.deleteObject).not.toHaveBeenCalled();
      });
    }
  });

  it('returns 413 when the byte limit is exceeded and destroys the source', async () => {
    await expectNoProcessLeaks(async () => {
      const csv = csvBuffer('sku,name,price\nA1,Widget,10\nB2,Gadget,20\n');
      const tinyEnv = envFixture();
      tinyEnv.IMPORT_MAX_FILE_BYTES = 20;
      service = new PreviewService(
        imports as unknown as ImportRepository,
        templates as unknown as TemplateRepository,
        storage as unknown as ObjectStorage,
        tinyEnv,
      );

      let sent = false;
      const source = new Readable({
        read() {
          if (sent) {
            return;
          }
          sent = true;
          this.push(csv);
        },
      });

      storage.openObject.mockResolvedValue(source);
      imports.findByIdForOrganization.mockResolvedValue(
        uploadedSession(csv, { dataRowCount: 2 }),
      );

      await expect(
        service.preview(organizationId, importId, { expectedMappingRevision: 1 }),
      ).rejects.toMatchObject({
        response: { code: 'IMPORT.FILE_TOO_LARGE' },
      });
      expect(source.destroyed).toBe(true);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
  });

  it('does not leak unhandled rejections under --unhandled-rejections=strict', async () => {
    const script = fileURLToPath(
      new URL('./preview.unhandled-rejections.script.ts', import.meta.url),
    );
    await execFileAsync(
      process.execPath,
      ['--unhandled-rejections=strict', '--import', 'tsx', script],
      { cwd: process.cwd(), timeout: 20_000 },
    );
  });

  it('keeps the final JSON at or under 1 MiB while preserving full-file stats and prefix order', async () => {
    const largeSku = 's'.repeat(60_000);
    const rows = 20;
    const csv = csvBuffer(
      `sku,name,price\n${`${largeSku},x,10\n`.repeat(rows)}`,
    );
    const roomyEnv = envFixture();
    roomyEnv.IMPORT_MAX_FILE_BYTES = 5_242_880;
    service = new PreviewService(
      imports as unknown as ImportRepository,
      templates as unknown as TemplateRepository,
      storage as unknown as ObjectStorage,
      roomyEnv,
    );
    imports.findByIdForOrganization.mockResolvedValue(
      uploadedSession(csv, { dataRowCount: rows }),
    );
    storage.openObject.mockResolvedValue(Readable.from([csv]));

    const { PREVIEW_MAX_RESPONSE_BYTES: maxBytes } = await import(
      './sample-budget.js'
    );
    const { jsonUtf8Bytes } = await import('./sample-budget.js');

    const result = await service.preview(organizationId, importId, {
      expectedMappingRevision: 1,
      limit: 20,
    });

    expect(jsonUtf8Bytes(result)).toBeLessThanOrEqual(maxBytes);
    expect(result.summary.totalRows).toBe(rows);
    expect(result.summary.validRows).toBe(rows);
    expect(result.sampleTruncated).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0]?.recordNumber).toBe(1);
    expect(result.rows.map((row) => row.recordNumber)).toEqual(
      Array.from({ length: result.rows.length }, (_, index) => index + 1),
    );
  });
});
