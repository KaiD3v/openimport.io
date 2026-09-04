import { z } from 'zod'
import { assertImportAccessToken } from './import-token.ts'

const initializeSchema = z.object({
  type: z.literal('openimport.initialize'),
  version: z.number(),
  importId: z.string(),
  accessToken: z.string(),
})

export type InspectInitializeResult =
  | { status: 'ignored' }
  | { status: 'accepted'; importId: string; accessToken: string }
  | {
      status: 'rejected'
      code: string
      importId: string
      notifyParent: true
    }

export function inspectInitializeEvent(input: {
  data: unknown
  origin: string
  source: MessageEventSource | null
  expectedImportId: string
  allowedOrigins: readonly string[]
  parent: Window
}): InspectInitializeResult {
  if (input.source !== input.parent) {
    return { status: 'ignored' }
  }

  if (!input.allowedOrigins.includes(input.origin)) {
    return { status: 'ignored' }
  }

  const parsed = initializeSchema.safeParse(input.data)
  if (!parsed.success) {
    if (isUnknownMessage(input.data)) {
      return { status: 'ignored' }
    }

    return {
      status: 'rejected',
      code: 'OPENIMPORT.INVALID_INITIALIZE',
      importId: input.expectedImportId,
      notifyParent: true,
    }
  }

  const message = parsed.data

  if (message.version !== 1) {
    return {
      status: 'rejected',
      code: 'OPENIMPORT.UNSUPPORTED_VERSION',
      importId: input.expectedImportId,
      notifyParent: true,
    }
  }

  if (message.importId !== input.expectedImportId) {
    return {
      status: 'rejected',
      code: 'OPENIMPORT.IMPORT_ID_MISMATCH',
      importId: input.expectedImportId,
      notifyParent: true,
    }
  }

  const token = assertImportAccessToken(message.accessToken)
  if (!token.ok) {
    return {
      status: 'rejected',
      code: token.code,
      importId: input.expectedImportId,
      notifyParent: true,
    }
  }

  return {
    status: 'accepted',
    importId: message.importId,
    accessToken: token.accessToken,
  }
}

function isUnknownMessage(data: unknown) {
  if (!data || typeof data !== 'object' || !('type' in data)) {
    return true
  }

  return data.type !== 'openimport.initialize'
}

export function postToParent(
  parent: Window,
  origin: string,
  message: {
    type: 'openimport.ready' | 'openimport.loaded' | 'openimport.error'
    version: 1
    importId: string
    code?: string
    traceId?: string
  },
) {
  parent.postMessage(message, origin)
}
