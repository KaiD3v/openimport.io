import { OpenImportApiError } from './errors.ts'
import { apiErrorSchema } from './import-context.schema.ts'
import { assertImportAccessToken } from '../embed/import-token.ts'

export function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

export function requireImportAccessToken(accessToken: string) {
  const token = assertImportAccessToken(accessToken)
  if (!token.ok) {
    throw new OpenImportApiError({
      status: 0,
      code: token.code,
      message: 'A credencial recebida não pode ser usada nesta interface.',
    })
  }
  return token.accessToken
}

export async function openImportFetch(input: {
  url: string
  accessToken: string
  method: string
  signal?: AbortSignal
  headers?: HeadersInit
  body?: BodyInit | null
}): Promise<Response> {
  const accessToken = requireImportAccessToken(input.accessToken)

  try {
    return await fetch(input.url, {
      method: input.method,
      cache: 'no-store',
      signal: input.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...input.headers,
      },
      body: input.body,
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    throw new OpenImportApiError({
      status: 0,
      code: 'OPENIMPORT.NETWORK_FAILURE',
      message: 'Não foi possível conectar ao OpenImport.',
    })
  }
}

export async function throwIfNotOk(response: Response): Promise<void> {
  if (response.ok) {
    return
  }

  const traceHeader = response.headers.get('X-Request-ID') ?? undefined
  const body = await readJson(response)
  const parsed = apiErrorSchema.safeParse(body)
  throw new OpenImportApiError({
    status: response.status,
    code: parsed.success ? parsed.data.code : 'OPENIMPORT.INCOMPATIBLE_RESPONSE',
    message: parsed.success
      ? parsed.data.message
      : 'A resposta de erro do servidor é incompatível.',
    traceId: parsed.success
      ? (parsed.data.traceId ?? traceHeader)
      : traceHeader,
  })
}

export function incompatibleResponse(traceId?: string) {
  return new OpenImportApiError({
    status: 200,
    code: 'OPENIMPORT.INCOMPATIBLE_RESPONSE',
    message: 'A resposta do servidor é incompatível com esta versão da interface.',
    traceId,
  })
}
