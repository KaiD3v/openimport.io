import { describe, expect, it } from 'vitest'
import {
  EXECUTION_ID,
  queuedContext,
  uploadedContext,
} from '../../test/fixtures.ts'
import { applyConfirmToContext } from './apply-confirm-to-context.ts'

describe('applyConfirmToContext', () => {
  it('patches only confirm response fields and preserves the rest', () => {
    const next = applyConfirmToContext(uploadedContext, {
      importId: uploadedContext.import.id,
      executionId: EXECUTION_ID,
      status: 'queued',
      expectedMappingRevision: 1,
      expectedContentSha256: 'a'.repeat(64),
      progress: {
        processedRows: 0,
        totalRows: 128,
        validRows: 0,
        invalidRows: 0,
      },
      failure: null,
      replayed: false,
    })

    expect(next.import.status).toBe('queued')
    expect(next.import.executionId).toBe(EXECUTION_ID)
    expect(next.import.progress?.totalRows).toBe(128)
    expect(next.import.confirmedAt).toBe(uploadedContext.import.confirmedAt)
    expect(next.import.updatedAt).toBe(uploadedContext.import.updatedAt)
    expect(next.template).toEqual(uploadedContext.template)
    expect(next.mapping).toEqual(uploadedContext.mapping)
    expect(next.import.columns).toEqual(uploadedContext.import.columns)
    expect(queuedContext.import.status).toBe('queued')
  })
})
