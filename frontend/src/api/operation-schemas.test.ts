import { describe, expect, it } from 'vitest'
import { assertSingleCsvFile, buildUploadFormData } from './upload-form.ts'
import {
  confirmImportResponseSchema,
  importMappingSchema,
  importPreviewSchema,
  putMappingBodySchema,
  rejectedRowsResponseSchema,
} from './operation-schemas.ts'
import { IMPORT_ID } from '../test/fixtures.ts'

describe('upload form helpers', () => {
  it('builds FormData with a single file field named file', () => {
    const file = new File(['sku\n1'], 'products.csv', { type: 'text/csv' })
    const form = buildUploadFormData(file)

    expect(form.get('file')).toBe(file)
    expect([...form.keys()]).toEqual(['file'])
  })

  it('rejects multiple files', () => {
    const files = [
      new File(['a'], 'a.csv', { type: 'text/csv' }),
      new File(['b'], 'b.csv', { type: 'text/csv' }),
    ]

    expect(() => assertSingleCsvFile(files)).toThrow(/somente um arquivo/i)
  })

  it('accepts a single csv file', () => {
    const file = new File(['sku\n1'], 'products.csv', { type: 'text/csv' })
    expect(assertSingleCsvFile([file])).toBe(file)
  })
})

describe('operation schemas', () => {
  it('accepts a mapping response', () => {
    const parsed = importMappingSchema.parse({
      importId: IMPORT_ID,
      revision: 1,
      mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      isComplete: false,
      missingRequiredFields: ['priceInCents'],
    })
    expect(parsed.revision).toBe(1)
  })

  it('serializes put mapping body by columnPosition', () => {
    const body = putMappingBodySchema.parse({
      expectedRevision: 0,
      mappings: [
        { columnPosition: 2, fieldKey: 'priceInCents' },
        { columnPosition: 0, fieldKey: 'sku' },
      ],
    })
    expect(body.mappings).toHaveLength(2)
  })

  it('accepts preview with invalid rows and null data', () => {
    const parsed = importPreviewSchema.parse({
      importId: IMPORT_ID,
      mappingRevision: 1,
      contentSha256: 'a'.repeat(64),
      normalizationProfile: 'pt-BR-v1',
      summary: { totalRows: 2, validRows: 1, invalidRows: 1 },
      limit: 20,
      sampleTruncated: true,
      rows: [
        {
          recordNumber: 1,
          valid: true,
          data: { sku: 'A', priceInCents: 29990 },
          errors: [],
        },
        {
          recordNumber: 2,
          valid: false,
          data: null,
          errors: [
            {
              fieldKey: 'priceInCents',
              code: 'FIELD.INVALID_CURRENCY',
              message: 'invalid',
            },
          ],
        },
      ],
    })

    expect(parsed.sampleTruncated).toBe(true)
    expect(parsed.rows[1]?.data).toBeNull()
  })

  it('accepts confirm response and rejected rows page', () => {
    const confirm = confirmImportResponseSchema.parse({
      importId: IMPORT_ID,
      executionId: '44444444-4444-4444-8444-444444444444',
      status: 'queued',
      expectedMappingRevision: 1,
      expectedContentSha256: 'a'.repeat(64),
      progress: {
        processedRows: 0,
        totalRows: null,
        validRows: 0,
        invalidRows: 0,
      },
      failure: null,
      replayed: false,
    })
    expect(confirm.status).toBe('queued')

    const rejected = rejectedRowsResponseSchema.parse({
      data: [
        {
          recordNumber: 3,
          errors: [
            {
              fieldKey: 'sku',
              code: 'FIELD.REQUIRED',
              message: 'missing',
            },
          ],
        },
      ],
      nextCursor: 'next',
    })
    expect(rejected.nextCursor).toBe('next')
  })

  it('rejects confirm processing_failed without failure', () => {
    const result = confirmImportResponseSchema.safeParse({
      importId: IMPORT_ID,
      executionId: '44444444-4444-4444-8444-444444444444',
      status: 'processing_failed',
      expectedMappingRevision: 1,
      expectedContentSha256: 'a'.repeat(64),
      progress: {
        processedRows: 1,
        totalRows: 10,
        validRows: 0,
        invalidRows: 0,
      },
      failure: null,
      replayed: false,
    })
    expect(result.success).toBe(false)
  })
})
