export class LabSessionError extends Error {
  code: 'seed' | 'network' | 'upstream' | 'invalid_token'
  constructor(
    code: LabSessionError['code'],
    message: string,
    cause?: unknown,
  )
}

export type LabSessionFetch = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
  },
) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
}>

export function resolveLabApiBaseUrl(options?: {
  apiBaseUrl?: string
  env?: NodeJS.ProcessEnv
}): string

export function createLabSession(options?: {
  apiBaseUrl?: string
  apiKey?: string
  envPath?: string
  templateBody?: { name: string; fields: unknown }
  fetchImpl?: LabSessionFetch
  now?: () => number
  randomUUID?: () => string
  env?: NodeJS.ProcessEnv
}): Promise<{
  importId: string
  accessToken: string
  expiresAt: string
  templateId: string
}>
