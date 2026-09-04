import {
  incompatibleResponse,
  openImportFetch,
  readJson,
  throwIfNotOk,
  trimTrailingSlash,
} from './http.ts'
import { importSessionSchema, type ImportSession } from './operation-schemas.ts'
import { buildUploadFormData } from './upload-form.ts'

export async function uploadImportFile(input: {
  apiBaseUrl: string
  importId: string
  accessToken: string
  file: File
  signal?: AbortSignal
}): Promise<ImportSession> {
  const url = `${trimTrailingSlash(input.apiBaseUrl)}/imports/${input.importId}/file`
  const body = buildUploadFormData(input.file)

  const response = await openImportFetch({
    url,
    accessToken: input.accessToken,
    method: 'POST',
    signal: input.signal,
    body,
  })

  await throwIfNotOk(response)

  const json = await readJson(response)
  const parsed = importSessionSchema.safeParse(json)
  if (!parsed.success) {
    throw incompatibleResponse(response.headers.get('X-Request-ID') ?? undefined)
  }

  return parsed.data
}
