import { z } from 'zod'

const uuid = z.uuid()

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  traceId: z.string().optional(),
})

const importSessionObject = z.object({
  id: uuid,
  templateId: uuid,
  status: z.enum(['created', 'uploaded', 'upload_failed']),
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
  uploadedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const importContextShape = z.object({
  import: importSessionObject,
  template: z.object({
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
  }),
  mapping: z.object({
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
  }),
})

export const importContextSchema = importContextShape
  .refine((data) => data.mapping.importId === data.import.id, {
    message: 'mapping.importId must match import.id',
    path: ['mapping', 'importId'],
  })
  .refine((data) => data.template.id === data.import.templateId, {
    message: 'template.id must match import.templateId',
    path: ['template', 'id'],
  })

export const importSessionSchema = importSessionObject

export type ImportContext = z.infer<typeof importContextSchema>
export type ImportSession = z.infer<typeof importSessionSchema>
