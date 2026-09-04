import { describe, expect, it } from 'vitest'
import {
  IMPORT_ID,
  OTHER_IMPORT_ID,
  createdContext,
  processingFailedContext,
  queuedContext,
  readyContext,
  uploadedContext,
  uploadFailedContext,
} from '../test/fixtures.ts'
import { importContextSchema } from './import-context.schema.ts'

describe('importContextSchema', () => {
  it('accepts a valid created-session context', () => {
    const parsed = importContextSchema.parse(createdContext)

    expect(parsed.import.status).toBe('created')
    expect(parsed.import.columns).toEqual([])
    expect(parsed.mapping.isComplete).toBe(false)
    expect(parsed.import.progress).toBeNull()
    expect(parsed.import.failure).toBeNull()
  })

  it('accepts a valid uploaded-session context', () => {
    const parsed = importContextSchema.parse(uploadedContext)

    expect(parsed.import.dataRowCount).toBe(128)
    expect(parsed.import.columns).toHaveLength(3)
    expect(parsed.mapping.revision).toBe(1)
  })

  it('accepts queued, ready, and processing_failed sessions', () => {
    expect(importContextSchema.safeParse(queuedContext).success).toBe(true)
    expect(importContextSchema.safeParse(readyContext).success).toBe(true)
    expect(importContextSchema.safeParse(processingFailedContext).success).toBe(
      true,
    )
  })

  it('rejects processing_failed without failure', () => {
    const result = importContextSchema.safeParse({
      ...processingFailedContext,
      import: {
        ...processingFailedContext.import,
        failure: null,
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects ready with a non-null failure', () => {
    const result = importContextSchema.safeParse({
      ...readyContext,
      import: {
        ...readyContext.import,
        failure: {
          code: 'IMPORT.PROCESSING_FAILED',
          message: 'should not appear',
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects queued without progress', () => {
    const result = importContextSchema.safeParse({
      ...queuedContext,
      import: {
        ...queuedContext.import,
        progress: null,
      },
    })
    expect(result.success).toBe(false)
  })

  it('accepts consistent relational ids', () => {
    const result = importContextSchema.safeParse(createdContext)

    expect(result.success).toBe(true)
  })

  it('rejects when mapping.importId diverges from import.id', () => {
    const result = importContextSchema.safeParse({
      ...createdContext,
      mapping: {
        ...createdContext.mapping,
        importId: OTHER_IMPORT_ID,
      },
    })

    expect(result.success).toBe(false)
  })

  it('rejects when template.id diverges from import.templateId', () => {
    const result = importContextSchema.safeParse({
      ...createdContext,
      template: {
        ...createdContext.template,
        id: OTHER_IMPORT_ID,
      },
    })

    expect(result.success).toBe(false)
  })

  it('rejects a response that does not match the contract', () => {
    const result = importContextSchema.safeParse({
      import: { id: 'not-a-session' },
    })

    expect(result.success).toBe(false)
  })

  it('still accepts upload_failed when relational ids match', () => {
    expect(importContextSchema.safeParse(uploadFailedContext).success).toBe(
      true,
    )
    expect(uploadFailedContext.import.id).toBe(IMPORT_ID)
  })
})
