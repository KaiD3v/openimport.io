import { z } from 'zod'

const uuid = z.uuid()

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  traceId: z.string().optional(),
})

export const importProgressSchema = z.object({
  processedRows: z.number().int().nonnegative(),
  totalRows: z.number().int().nonnegative().nullable(),
  validRows: z.number().int().nonnegative(),
  invalidRows: z.number().int().nonnegative(),
})

export const importFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
})

export const importSessionStatusSchema = z.enum([
  'created',
  'uploaded',
  'upload_failed',
  'queued',
  'processing',
  'ready',
  'processing_failed',
])

const postConfirmStatuses = new Set([
  'queued',
  'processing',
  'ready',
  'processing_failed',
])

const importSessionBase = z.object({
  id: uuid,
  templateId: uuid,
  status: importSessionStatusSchema,
  originalFilename: z.string().nullable(),
  byteSize: z.number().int().nullable(),
  contentSha256: z.string().nullable(),
  encoding: z.string().nullable(),
  delimiter: z.string().nullable(),
  dataRowCount: z.number().int().nullable(),
  columns: z.array(
    z.object({
      name: z.string(),
      position: z.number().int().nonnegative(),
    }),
  ),
  progress: importProgressSchema.nullable(),
  executionId: uuid.nullable(),
  failure: importFailureSchema.nullable(),
  uploadedAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const importSessionObject = importSessionBase.superRefine((session, ctx) => {
  const afterConfirm = postConfirmStatuses.has(session.status)

  if (afterConfirm && session.progress === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['progress'],
      message: 'progress is required after confirmation',
    })
  }

  if (afterConfirm && session.executionId === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['executionId'],
      message: 'executionId is required after confirmation',
    })
  }

  if (session.status === 'processing_failed') {
    if (session.failure === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'failure is required when status is processing_failed',
      })
    }
  } else if (session.failure !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['failure'],
      message: 'failure must be null unless status is processing_failed',
    })
  }
})

const importTemplateSchema = z.object({
  id: uuid,
  name: z.string(),
  fields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(['string', 'integer', 'currency']),
      required: z.boolean(),
      position: z.number().int().nonnegative(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const importMappingSchema = z.object({
  importId: uuid,
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

const importContextBase = z.object({
  import: importSessionBase,
  template: importTemplateSchema,
  mapping: importMappingSchema,
})

export type ImportContext = z.infer<typeof importContextBase>

export const importContextSchema = z
  .object({
    import: importSessionObject,
    template: importTemplateSchema,
    mapping: importMappingSchema,
  })
  .refine((data) => data.mapping.importId === data.import.id, {
    message: 'mapping.importId must match import.id',
    path: ['mapping', 'importId'],
  })
  .refine((data) => data.template.id === data.import.templateId, {
    message: 'template.id must match import.templateId',
    path: ['template', 'id'],
  })

// Keep the base schema referenced so ESLint treats the type source as used.
void importContextBase

export const importSessionSchema = importSessionObject

export type ImportSession = z.infer<typeof importSessionBase>
export type ImportProgress = z.infer<typeof importProgressSchema>
export type ImportFailure = z.infer<typeof importFailureSchema>
export type ImportSessionStatus = z.infer<typeof importSessionStatusSchema>
