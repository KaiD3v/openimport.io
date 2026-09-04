import { z } from 'zod'
import { importSessionSchema } from './import-context.schema.ts'

export { importSessionSchema }

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

export type ImportSession = z.infer<typeof importSessionSchema>
export type ImportMapping = z.infer<typeof importMappingSchema>
export type ImportPreview = z.infer<typeof importPreviewSchema>
export type PutMappingBody = z.infer<typeof putMappingBodySchema>
