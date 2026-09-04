import {
  incompatibleResponse,
  openImportFetch,
  readJson,
  throwIfNotOk,
  trimTrailingSlash,
} from './http.ts'
import {
  rejectedRowsResponseSchema,
  type RejectedRowsResponse,
} from './operation-schemas.ts'

export async function fetchRejectedRows(input: {
  apiBaseUrl: string
  importId: string
  accessToken: string
  limit?: number
  after?: string | null
  signal?: AbortSignal
}): Promise<RejectedRowsResponse> {
  const params = new URLSearchParams()
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit))
  }
  if (input.after) {
    params.set('after', input.after)
  }
  const query = params.toString()
  const url = `${trimTrailingSlash(input.apiBaseUrl)}/imports/${input.importId}/rejected-rows${
    query ? `?${query}` : ''
  }`

  const response = await openImportFetch({
    url,
    accessToken: input.accessToken,
    method: 'GET',
    signal: input.signal,
  })

  await throwIfNotOk(response)

  const json = await readJson(response)
  const parsed = rejectedRowsResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw incompatibleResponse(response.headers.get('X-Request-ID') ?? undefined)
  }

  return parsed.data
}
