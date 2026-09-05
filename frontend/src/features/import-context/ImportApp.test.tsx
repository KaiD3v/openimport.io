import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenImportApiError } from '../../api/errors.ts'
import {
  ALLOWED_ORIGIN,
  API_BASE_URL,
  IMPORT_ID,
  IMPORT_TOKEN,
  LIVE_API_KEY,
  OTHER_IMPORT_ID,
  createdContext,
  initializeMessage,
  processingContext,
  uploadFailedContext,
  uploadedContext,
} from '../../test/fixtures.ts'
import { server } from '../../test/setup.ts'
import { clearSessionCredential } from '../../embed/session-credential.ts'
import { ImportApp } from './ImportApp.tsx'

const contextUrl = `${API_BASE_URL}/imports/${IMPORT_ID}/context`

function renderApp(pathname = `/imports/${IMPORT_ID}`) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={client}>
      <ImportApp
        pathname={pathname}
        config={{
          apiBaseUrl: API_BASE_URL,
          parentOrigins: [ALLOWED_ORIGIN],
          isProduction: false,
        }}
      />
    </QueryClientProvider>,
  )
}

function postFromParent(data: unknown, origin = ALLOWED_ORIGIN, source: MessageEventSource | null = window) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data,
      origin,
      source,
    }),
  )
}

describe('ImportApp', () => {
  afterEach(() => {
    clearSessionCredential()
    vi.restoreAllMocks()
  })

  it('shows a waiting state until the host initializes the session', () => {
    renderApp()

    expect(
      screen.getByRole('status', { name: /aguardando o sistema de origem/i }),
    ).toBeInTheDocument()
  })

  it('announces loading while the context request is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    server.use(
      http.get(contextUrl, async () => {
        await gate
        return HttpResponse.json(createdContext)
      }),
    )

    renderApp()
    postFromParent(initializeMessage())

    expect(
      await screen.findByRole('status', {
        name: /carregando o contexto da importação/i,
      }),
    ).toBeInTheDocument()

    release()

    expect(await screen.findByText('Produtos')).toBeInTheDocument()
  })

  it('renders a created session without upload metadata', async () => {
    server.use(http.get(contextUrl, () => HttpResponse.json(createdContext)))
    renderApp()
    postFromParent(initializeMessage())

    expect(await screen.findByText('Produtos')).toBeInTheDocument()
    expect(screen.getByText(/criada/i)).toBeInTheDocument()
    expect(
      screen.getAllByText(/arquivo ainda não enviado/i).length,
    ).toBeGreaterThan(0)
    expect(screen.getByLabelText(/etapa atual: upload/i)).toBeInTheDocument()
  })

  it('renders uploaded session columns and mapping completeness', async () => {
    server.use(http.get(contextUrl, () => HttpResponse.json(uploadedContext)))
    renderApp()
    postFromParent(initializeMessage())

    expect(await screen.findByText('produtos-calcados.csv')).toBeInTheDocument()
    expect(screen.getAllByText('128').length).toBeGreaterThan(0)
    expect(screen.getAllByText('SKU').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/mapping completo/i).length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/etapa atual: revisar/i)).toBeInTheDocument()
  })

  it('renders upload_failed as a terminal interrupted session', async () => {
    server.use(
      http.get(contextUrl, () => HttpResponse.json(uploadFailedContext)),
    )
    renderApp()
    postFromParent(initializeMessage())

    const notice = await screen.findByRole('status', {
      name: /falha no envio/i,
    })
    expect(notice).toHaveTextContent(/não aceita novo arquivo|nova sessão/i)
    expect(
      screen.queryByRole('button', { name: /tentar novamente/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('navigation', { name: /falha no envio/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: /^Etapa atual: Upload$/i }),
    ).not.toBeInTheDocument()
  })

  it('does not request context for a disallowed origin', async () => {
    let requested = false
    server.use(
      http.get(contextUrl, () => {
        requested = true
        return HttpResponse.json(createdContext)
      }),
    )

    renderApp()
    postFromParent(initializeMessage(), 'https://evil.example')

    await waitFor(() => {
      expect(
        screen.getByRole('status', { name: /aguardando o sistema de origem/i }),
      ).toBeInTheDocument()
    })
    expect(requested).toBe(false)
  })

  it('does not request context when event.source is not the parent', async () => {
    let requested = false
    server.use(
      http.get(contextUrl, () => {
        requested = true
        return HttpResponse.json(createdContext)
      }),
    )

    renderApp()
    postFromParent(initializeMessage(), ALLOWED_ORIGIN, null)

    await waitFor(() => {
      expect(requested).toBe(false)
    })
  })

  it('explains an expired import token', async () => {
    server.use(
      http.get(contextUrl, () =>
        HttpResponse.json(
          {
            code: 'AUTH.INVALID_IMPORT_TOKEN',
            message: 'Import token is not valid.',
            traceId: 'req_expired',
          },
          { status: 401 },
        ),
      ),
    )

    renderApp()
    postFromParent(initializeMessage())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/expirou/i)
    expect(alert).toHaveTextContent('req_expired')
    expect(alert).not.toHaveTextContent(IMPORT_TOKEN)
  })

  it('explains insufficient permission', async () => {
    server.use(
      http.get(contextUrl, () =>
        HttpResponse.json(
          {
            code: 'AUTH.INSUFFICIENT_SCOPE',
            message: 'no',
            traceId: 'req_403',
          },
          { status: 403 },
        ),
      ),
    )
    renderApp()
    postFromParent(initializeMessage())
    expect(await screen.findByRole('alert')).toHaveTextContent(/permissão/i)
  })

  it('shows a 404 after a dedicated request', async () => {
    server.use(
      http.get(contextUrl, () =>
        HttpResponse.json(
          {
            code: 'IMPORT.NOT_FOUND',
            message: 'missing',
            traceId: 'req_404',
          },
          { status: 404 },
        ),
      ),
    )
    renderApp()
    postFromParent(initializeMessage())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/não encontrada|indisponível/i)
    expect(alert).toHaveTextContent('req_404')
  })

  it('allows a manual retry after a network failure', async () => {
    const user = userEvent.setup()
    let attempts = 0
    server.use(
      http.get(contextUrl, () => {
        attempts += 1
        if (attempts === 1) {
          return HttpResponse.error()
        }
        return HttpResponse.json(createdContext)
      }),
    )

    renderApp()
    postFromParent(initializeMessage())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/não foi possível conectar|rede/i)

    await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(await screen.findByText('Produtos')).toBeInTheDocument()
  })

  it('rejects an API key without calling the backend', async () => {
    let requested = false
    server.use(
      http.get(contextUrl, () => {
        requested = true
        return HttpResponse.json(createdContext)
      }),
    )

    renderApp()
    postFromParent(initializeMessage({ accessToken: LIVE_API_KEY }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/temporário|credencial|token/i)
    expect(requested).toBe(false)
    expect(document.body.textContent).not.toContain(LIVE_API_KEY)
  })

  it('does not expose the token in the document after a successful load', async () => {
    server.use(http.get(contextUrl, () => HttpResponse.json(createdContext)))
    renderApp()
    postFromParent(initializeMessage())

    expect(await screen.findByText('Produtos')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(IMPORT_TOKEN)
    expect(window.location.search).not.toContain('oi_import_')
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('posts ready and loaded to the parent with a specific origin', async () => {
    const parentPost = vi.spyOn(window, 'postMessage')
    server.use(http.get(contextUrl, () => HttpResponse.json(createdContext)))
    renderApp()
    postFromParent(initializeMessage())

    await screen.findByText('Produtos')

    const posted = parentPost.mock.calls.map((call) => {
      const target = call[1]
      const origin = typeof target === 'string' ? target : undefined
      return { message: call[0], origin }
    })
    expect(posted.some((entry) => entry.origin === '*')).toBe(false)
    expect(posted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: ALLOWED_ORIGIN,
          message: expect.objectContaining({
            type: 'openimport.ready',
            version: 1,
            importId: IMPORT_ID,
          }),
        }),
        expect.objectContaining({
          origin: ALLOWED_ORIGIN,
          message: expect.objectContaining({
            type: 'openimport.loaded',
            version: 1,
            importId: IMPORT_ID,
          }),
        }),
      ]),
    )
  })

  it('reloads context when the same import is reinitialized with a new token', async () => {
    const nextToken = `oi_import_${'99'.repeat(32)}`
    const seen = new Array<string>()

    server.use(
      http.get(contextUrl, ({ request }) => {
        seen.push(request.headers.get('authorization') ?? '')
        if (seen.length === 1) {
          return HttpResponse.json(createdContext)
        }
        return HttpResponse.json(uploadedContext)
      }),
    )

    renderApp()
    postFromParent(initializeMessage())
    expect(
      (await screen.findAllByText(/arquivo ainda não enviado/i)).length,
    ).toBeGreaterThan(0)

    postFromParent(initializeMessage({ accessToken: nextToken }))
    expect(await screen.findByText('produtos-calcados.csv')).toBeInTheDocument()
    expect(seen).toEqual([
      `Bearer ${IMPORT_TOKEN}`,
      `Bearer ${nextToken}`,
    ])
  })

  it('does not switch to another importId without navigation', async () => {
    let requestedPath = ''
    server.use(
      http.get(`${API_BASE_URL}/imports/:importId/context`, ({ request }) => {
        requestedPath = new URL(request.url).pathname
        return HttpResponse.json(createdContext)
      }),
    )

    renderApp()
    postFromParent(initializeMessage())
    await screen.findByText('Produtos')

    postFromParent(initializeMessage({ importId: OTHER_IMPORT_ID }))
    await waitFor(() => {
      expect(requestedPath).toContain(IMPORT_ID)
      expect(requestedPath).not.toContain(OTHER_IMPORT_ID)
    })
  })

  it('shows a configuration error for an invalid URL', () => {
    renderApp('/imports/not-a-uuid')

    expect(screen.getByRole('alert')).toHaveTextContent(/endereço|url|identificador/i)
  })

  it('keeps the flow landmark accessible', async () => {
    server.use(http.get(contextUrl, () => HttpResponse.json(uploadedContext)))
    renderApp()
    postFromParent(initializeMessage())

    expect(await screen.findByText('produtos-calcados.csv')).toBeInTheDocument()
    const main = screen.getByRole('main')
    expect(within(main).getAllByRole('list').length).toBeGreaterThan(0)
    expect(screen.getByRole('banner')).toHaveTextContent(/openimport/i)
  })

  it('shows terminal session expired when polling returns 401 with cached processing data', async () => {
    let polls = 0
    server.use(
      http.get(contextUrl, () => {
        polls += 1
        if (polls === 1) {
          return HttpResponse.json(processingContext)
        }
        return HttpResponse.json(
          {
            code: 'AUTH.INVALID_IMPORT_TOKEN',
            message: 'Import token is not valid.',
            traceId: 'req_poll_401',
          },
          { status: 401 },
        )
      }),
    )

    renderApp()
    postFromParent(initializeMessage())

    expect(await screen.findByTestId('processing-panel')).toBeInTheDocument()
    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toHaveTextContent(/expirou/i)
      },
      { timeout: 10000 },
    )
    expect(screen.queryByTestId('processing-panel')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /tentar atualizar/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /tentar novamente/i }),
    ).not.toBeInTheDocument()

    const pollsAtTerminal = polls
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(polls).toBe(pollsAtTerminal)
  })

  it('keeps recoverable poll errors with stale progress and manual retry', async () => {
    let polls = 0
    server.use(
      http.get(contextUrl, () => {
        polls += 1
        if (polls === 1) {
          return HttpResponse.json(processingContext)
        }
        return HttpResponse.json(
          { code: 'OPENIMPORT.NETWORK', message: 'offline' },
          { status: 503 },
        )
      }),
    )

    renderApp()
    postFromParent(initializeMessage())

    expect(await screen.findByTestId('processing-panel')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: /tentar atualizar/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/40/)).toBeInTheDocument()
  })
})

describe('OpenImportApiError retry surface', () => {
  it('is identifiable for 503 manual retry copy', () => {
    const error = new OpenImportApiError({
      status: 503,
      code: 'HEALTH.NOT_READY',
      message: 'down',
      traceId: 'req_503',
    })
    expect(error.traceId).toBe('req_503')
  })
})
