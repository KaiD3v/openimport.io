import { describe, expect, it } from 'vitest'
import {
  IMPORT_ID,
  OTHER_IMPORT_ID,
  createdContext,
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
  })

  it('accepts a valid uploaded-session context', () => {
    const parsed = importContextSchema.parse(uploadedContext)

    expect(parsed.import.dataRowCount).toBe(128)
    expect(parsed.import.columns).toHaveLength(3)
    expect(parsed.mapping.revision).toBe(1)
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
