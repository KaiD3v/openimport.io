import {
  incompatibleResponse,
  openImportFetch,
  readJson,
  throwIfNotOk,
  trimTrailingSlash,
} from './http.ts'
import {
  importMappingSchema,
  putMappingBodySchema,
  type ImportMapping,
  type PutMappingBody,
} from './operation-schemas.ts'

export async function putImportMapping(input: {
  apiBaseUrl: string
  importId: string
  accessToken: string
  body: PutMappingBody
  signal?: AbortSignal
}): Promise<ImportMapping> {
  const payload = putMappingBodySchema.parse(input.body)
  const url = `${trimTrailingSlash(input.apiBaseUrl)}/imports/${input.importId}/mapping`

  const response = await openImportFetch({
    url,
    accessToken: input.accessToken,
    method: 'PUT',
    signal: input.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  await throwIfNotOk(response)

  const json = await readJson(response)
  const parsed = importMappingSchema.safeParse(json)
  if (!parsed.success) {
    throw incompatibleResponse(response.headers.get('X-Request-ID') ?? undefined)
  }

  return parsed.data
}
