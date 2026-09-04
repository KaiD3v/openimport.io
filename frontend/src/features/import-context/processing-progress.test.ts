import { describe, expect, it } from 'vitest'
import { isPreviewFresh, progressPercent } from './processing-progress.ts'

describe('progressPercent', () => {
  it('returns null when totalRows is null', () => {
    expect(
      progressPercent({
        processedRows: 10,
        totalRows: null,
        validRows: 8,
        invalidRows: 2,
      }),
    ).toBeNull()
  })

  it('returns a capped percentage when totalRows is positive', () => {
    expect(
      progressPercent({
        processedRows: 50,
        totalRows: 100,
        validRows: 40,
        invalidRows: 10,
      }),
    ).toBe(50)
  })
})

describe('isPreviewFresh', () => {
  it('requires matching revision and content hash', () => {
    expect(
      isPreviewFresh({
        previewMappingRevision: 1,
        previewContentSha256: 'a'.repeat(64),
        mappingRevision: 1,
        contentSha256: 'a'.repeat(64),
      }),
    ).toBe(true)
    expect(
      isPreviewFresh({
        previewMappingRevision: 1,
        previewContentSha256: 'a'.repeat(64),
        mappingRevision: 2,
        contentSha256: 'a'.repeat(64),
      }),
    ).toBe(false)
  })
})
