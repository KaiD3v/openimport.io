import {
  incompatibleResponse,
  openImportFetch,
  readJson,
  throwIfNotOk,
  trimTrailingSlash,
} from './http.ts'
import {
  importPreviewSchema,
  postPreviewBodySchema,
  type ImportPreview,
} from './operation-schemas.ts'

export async function postImportPreview(input: {
  apiBaseUrl: string
  importId: string
  accessToken: string
  expectedMappingRevision: number
  limit?: number
  signal?: AbortSignal
}): Promise<ImportPreview> {
  const payload = postPreviewBodySchema.parse({
    expectedMappingRevision: input.expectedMappingRevision,
    limit: input.limit ?? 20,
  })
  const url = `${trimTrailingSlash(input.apiBaseUrl)}/imports/${input.importId}/preview`

  const response = await openImportFetch({
    url,
    accessToken: input.accessToken,
    method: 'POST',
    signal: input.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  await throwIfNotOk(response)

  const json = await readJson(response)
  const parsed = importPreviewSchema.safeParse(json)
  if (!parsed.success) {
    throw incompatibleResponse(response.headers.get('X-Request-ID') ?? undefined)
  }

  return parsed.data
}
