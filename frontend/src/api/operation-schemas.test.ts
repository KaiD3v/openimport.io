import { describe, expect, it } from 'vitest'
import { assertSingleCsvFile, buildUploadFormData } from './upload-form.ts'
import {
  importMappingSchema,
  importPreviewSchema,
  putMappingBodySchema,
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
})
