import { OpenImportApiError } from './errors.ts'
import {
  incompatibleResponse,
  isAbortError,
  openImportFetch,
  readJson,
  throwIfNotOk,
  trimTrailingSlash,
} from './http.ts'
import { importContextSchema, type ImportContext } from './import-context.schema.ts'
import { requireImportAccessToken } from './http.ts'

export async function fetchImportContext(input: {
  apiBaseUrl: string
  importId: string
  accessToken: string
  signal?: AbortSignal
}): Promise<ImportContext> {
  requireImportAccessToken(input.accessToken)
  const url = `${trimTrailingSlash(input.apiBaseUrl)}/imports/${input.importId}/context`

  const response = await openImportFetch({
    url,
    accessToken: input.accessToken,
    method: 'GET',
    signal: input.signal,
  })

  await throwIfNotOk(response)

  const body = await readJson(response)
  const parsed = importContextSchema.safeParse(body)
  if (!parsed.success) {
    throw incompatibleResponse(response.headers.get('X-Request-ID') ?? undefined)
  }

  return parsed.data
}

export { isAbortError, OpenImportApiError }
