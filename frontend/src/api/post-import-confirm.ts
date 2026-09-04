import {
  incompatibleResponse,
  openImportFetch,
  readJson,
  throwIfNotOk,
  trimTrailingSlash,
} from './http.ts'
import {
  confirmImportBodySchema,
  confirmImportResponseSchema,
  type ConfirmImportResponse,
} from './operation-schemas.ts'

export async function postImportConfirm(input: {
  apiBaseUrl: string
  importId: string
  accessToken: string
  expectedMappingRevision: number
  expectedContentSha256: string
  signal?: AbortSignal
}): Promise<ConfirmImportResponse> {
  const payload = confirmImportBodySchema.parse({
    expectedMappingRevision: input.expectedMappingRevision,
    expectedContentSha256: input.expectedContentSha256,
  })
  const url = `${trimTrailingSlash(input.apiBaseUrl)}/imports/${input.importId}/confirm`

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
  const parsed = confirmImportResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw incompatibleResponse(response.headers.get('X-Request-ID') ?? undefined)
  }

  if (
    parsed.data.importId !== input.importId ||
    parsed.data.expectedMappingRevision !== input.expectedMappingRevision ||
    parsed.data.expectedContentSha256 !== input.expectedContentSha256
  ) {
    throw incompatibleResponse(response.headers.get('X-Request-ID') ?? undefined)
  }

  return parsed.data
}
