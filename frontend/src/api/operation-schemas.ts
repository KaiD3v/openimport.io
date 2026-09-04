import { z } from 'zod'
import {
  importFailureSchema,
  importProgressSchema,
  importSessionSchema,
} from './import-context.schema.ts'

export { importSessionSchema, importProgressSchema, importFailureSchema }

export const importMappingSchema = z.object({
  importId: z.uuid(),
  revision: z.number().int().nonnegative(),
  mappings: z.array(
    z.object({
      columnPosition: z.number().int().nonnegative(),
      fieldKey: z.string(),
    }),
  ),
  isComplete: z.boolean(),
  missingRequiredFields: z.array(z.string()),
})

export const putMappingBodySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  mappings: z.array(
    z.object({
      columnPosition: z.number().int().nonnegative(),
      fieldKey: z.string().min(1),
    }),
  ),
})

export const importPreviewSchema = z.object({
  importId: z.uuid(),
  mappingRevision: z.number().int().nonnegative(),
  contentSha256: z.string(),
  normalizationProfile: z.string(),
  summary: z.object({
    totalRows: z.number().int().nonnegative(),
    validRows: z.number().int().nonnegative(),
    invalidRows: z.number().int().nonnegative(),
  }),
  limit: z.number().int().positive(),
  sampleTruncated: z.boolean(),
  rows: z.array(
    z.object({
      recordNumber: z.number().int().positive(),
      valid: z.boolean(),
      data: z.record(z.string(), z.union([z.string(), z.number()])).nullable(),
      errors: z.array(
        z.object({
          fieldKey: z.string(),
          code: z.string(),
          message: z.string(),
        }),
      ),
    }),
  ),
})

export const postPreviewBodySchema = z.object({
  expectedMappingRevision: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100).optional(),
})

export const confirmImportBodySchema = z.object({
  expectedMappingRevision: z.number().int().nonnegative(),
  expectedContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
})

export const confirmImportResponseSchema = z.object({
  importId: z.uuid(),
  executionId: z.uuid(),
  status: z.enum(['queued', 'processing', 'ready', 'processing_failed']),
  expectedMappingRevision: z.number().int().nonnegative(),
  expectedContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  progress: importProgressSchema,
  failure: importFailureSchema.nullable(),
  replayed: z.boolean(),
}).superRefine((data, ctx) => {
  if (data.status === 'processing_failed' && data.failure === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['failure'],
      message: 'failure is required when status is processing_failed',
    })
  }
  if (data.status !== 'processing_failed' && data.failure !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['failure'],
      message: 'failure must be null unless status is processing_failed',
    })
  }
})

export const rejectedRowsResponseSchema = z.object({
  data: z.array(
    z.object({
      recordNumber: z.number().int().positive(),
      errors: z.array(
        z.object({
          fieldKey: z.string(),
          code: z.string(),
          message: z.string(),
        }),
      ),
    }),
  ),
  nextCursor: z.string().nullable(),
})

export type ImportSession = z.infer<typeof importSessionSchema>
export type ImportMapping = z.infer<typeof importMappingSchema>
export type ImportPreview = z.infer<typeof importPreviewSchema>
export type PutMappingBody = z.infer<typeof putMappingBodySchema>
export type ConfirmImportBody = z.infer<typeof confirmImportBodySchema>
export type ConfirmImportResponse = z.infer<typeof confirmImportResponseSchema>
export type RejectedRowsResponse = z.infer<typeof rejectedRowsResponseSchema>
