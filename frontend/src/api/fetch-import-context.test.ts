import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  API_BASE_URL,
  IMPORT_ID,
  IMPORT_TOKEN,
  LIVE_API_KEY,
  createdContext,
} from '../test/fixtures.ts'
import { server } from '../test/setup.ts'
import { OpenImportApiError } from './errors.ts'
import { fetchImportContext } from './fetch-import-context.ts'

function contextUrl() {
  return `${API_BASE_URL}/imports/${IMPORT_ID}/context`
}

describe('fetchImportContext', () => {
  it('loads a valid context with a bearer import token and cache no-store', async () => {
    let seenAuthorization = ''
    let seenCache: RequestCache | undefined

    server.use(
      http.get(contextUrl(), ({ request }) => {
        seenAuthorization = request.headers.get('authorization') ?? ''
        seenCache = request.cache
        return HttpResponse.json(createdContext)
      }),
    )

    const context = await fetchImportContext({
      apiBaseUrl: API_BASE_URL,
      importId: IMPORT_ID,
      accessToken: IMPORT_TOKEN,
    })

    expect(context.template.name).toBe('Produtos')
    expect(seenAuthorization).toBe(`Bearer ${IMPORT_TOKEN}`)
    expect(seenCache).toBe('no-store')
  })

  it('does not send an organizational API key', async () => {
    await expect(
      fetchImportContext({
        apiBaseUrl: API_BASE_URL,
        importId: IMPORT_ID,
        accessToken: LIVE_API_KEY,
      }),
    ).rejects.toMatchObject({
      code: 'OPENIMPORT.LIVE_API_KEY_REJECTED',
    })
  })

  it('maps 401, 403, 404 and 503 to typed errors with traceId', async () => {
    const cases = [
      {
        status: 401,
        code: 'AUTH.INVALID_IMPORT_TOKEN',
        message: 'Import token is not valid.',
      },
      {
        status: 403,
        code: 'AUTH.INSUFFICIENT_SCOPE',
        message: 'This credential cannot access this resource.',
      },
      {
        status: 404,
        code: 'IMPORT.NOT_FOUND',
        message: 'Import not found.',
      },
      {
        status: 503,
        code: 'HEALTH.NOT_READY',
        message: 'Service unavailable.',
      },
    ] as const

    for (const errorCase of cases) {
      server.use(
        http.get(contextUrl(), () =>
          HttpResponse.json(
            {
              code: errorCase.code,
              message: errorCase.message,
              traceId: `req_${errorCase.status}`,
            },
            {
              status: errorCase.status,
              headers: { 'X-Request-ID': `req_${errorCase.status}` },
            },
          ),
        ),
      )

      await expect(
        fetchImportContext({
          apiBaseUrl: API_BASE_URL,
          importId: IMPORT_ID,
          accessToken: IMPORT_TOKEN,
        }),
      ).rejects.toEqual(
        expect.objectContaining({
          status: errorCase.status,
          code: errorCase.code,
          traceId: `req_${errorCase.status}`,
        }),
      )
    }
  })

  it('treats an incompatible 200 payload as a schema failure', async () => {
    server.use(http.get(contextUrl(), () => HttpResponse.json({ ok: true })))

    await expect(
      fetchImportContext({
        apiBaseUrl: API_BASE_URL,
        importId: IMPORT_ID,
        accessToken: IMPORT_TOKEN,
      }),
    ).rejects.toMatchObject({
      code: 'OPENIMPORT.INCOMPATIBLE_RESPONSE',
    })
  })

  it('rejects relationally inconsistent context payloads', async () => {
    server.use(
      http.get(contextUrl(), () =>
        HttpResponse.json({
          ...createdContext,
          mapping: {
            ...createdContext.mapping,
            importId: '22222222-2222-4222-8222-222222222222',
          },
        }),
      ),
    )

    await expect(
      fetchImportContext({
        apiBaseUrl: API_BASE_URL,
        importId: IMPORT_ID,
        accessToken: IMPORT_TOKEN,
      }),
    ).rejects.toMatchObject({
      code: 'OPENIMPORT.INCOMPATIBLE_RESPONSE',
    })
  })

  it('wraps a network failure', async () => {
    server.use(
      http.get(contextUrl(), () => HttpResponse.error()),
    )

    await expect(
      fetchImportContext({
        apiBaseUrl: API_BASE_URL,
        importId: IMPORT_ID,
        accessToken: IMPORT_TOKEN,
      }),
    ).rejects.toBeInstanceOf(OpenImportApiError)
  })

  it('forwards an abort signal to fetch', async () => {
    const controller = new AbortController()
    controller.abort()

    server.use(
      http.get(contextUrl(), () => HttpResponse.json(createdContext)),
    )

    await expect(
      fetchImportContext({
        apiBaseUrl: API_BASE_URL,
        importId: IMPORT_ID,
        accessToken: IMPORT_TOKEN,
        signal: controller.signal,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof DOMException || error instanceof OpenImportApiError
    })
  })
})
