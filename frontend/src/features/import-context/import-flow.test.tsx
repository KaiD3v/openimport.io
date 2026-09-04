import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import type { ImportContext } from '../../api/import-context.schema.ts'
import {
  API_BASE_URL,
  IMPORT_ID,
  IMPORT_TOKEN,
  createdContext,
  uploadedContext,
  uploadFailedContext,
} from '../../test/fixtures.ts'
import { server } from '../../test/setup.ts'
import {
  clearSessionCredential,
  replaceSessionCredential,
} from '../../embed/session-credential.ts'
import { LoadedImportView } from './LoadedImportView.tsx'
import { useImportContextQuery } from './use-import-context-query.ts'

const contextUrl = `${API_BASE_URL}/imports/${IMPORT_ID}/context`
const fileUrl = `${API_BASE_URL}/imports/${IMPORT_ID}/file`
const mappingUrl = `${API_BASE_URL}/imports/${IMPORT_ID}/mapping`
const previewUrl = `${API_BASE_URL}/imports/${IMPORT_ID}/preview`

function renderLoaded(context: ImportContext = createdContext) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  client.setQueryData(['import-context', IMPORT_ID, 1], context)

  return render(
    <QueryClientProvider client={client}>
      <LoadedImportView
        context={context}
        apiBaseUrl={API_BASE_URL}
        generation={1}
      />
    </QueryClientProvider>,
  )
}

function ConnectedFlow() {
  const query = useImportContextQuery({
    apiBaseUrl: API_BASE_URL,
    importId: IMPORT_ID,
    generation: 1,
  })

  if (!query.data) {
    return <p>loading</p>
  }

  return (
    <LoadedImportView
      context={query.data}
      apiBaseUrl={API_BASE_URL}
      generation={1}
    />
  )
}

function renderConnected(initial: ImportContext) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  client.setQueryData(['import-context', IMPORT_ID, 1], initial)

  return render(
    <QueryClientProvider client={client}>
      <ConnectedFlow />
    </QueryClientProvider>,
  )
}

describe('import flow mutations', () => {
  afterEach(() => {
    clearSessionCredential()
  })

  it('uploads a csv and refreshes context without automatic retry', async () => {
    const user = userEvent.setup()
    replaceSessionCredential(IMPORT_ID, IMPORT_TOKEN)
    let uploads = 0

    server.use(
      http.post(fileUrl, async ({ request }) => {
        uploads += 1
        const form = await request.formData()
        expect(form.get('file')).toBeInstanceOf(File)
        expect(request.headers.get('authorization')).toBe(
          `Bearer ${IMPORT_TOKEN}`,
        )
        return HttpResponse.json(uploadedContext.import, { status: 201 })
      }),
      http.get(contextUrl, () => HttpResponse.json(uploadedContext)),
    )

    renderLoaded(createdContext)

    const file = new File(['sku;stock;price\nA;1;10'], 'produtos.csv', {
      type: 'text/csv',
    })
    await user.upload(screen.getByLabelText(/escolher arquivo csv/i), file)
    await user.click(screen.getByRole('button', { name: /enviar arquivo/i }))

    await waitFor(() => {
      expect(uploads).toBe(1)
    })
  })

  it('saves mapping using column positions and expected revision', async () => {
    const user = userEvent.setup()
    replaceSessionCredential(IMPORT_ID, IMPORT_TOKEN)
    let putBody: unknown

    const incomplete = {
      ...uploadedContext,
      mapping: {
        ...uploadedContext.mapping,
        isComplete: false,
        missingRequiredFields: ['priceInCents'],
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
        revision: 0,
      },
    }

    server.use(
      http.put(mappingUrl, async ({ request }) => {
        putBody = await request.json()
        return HttpResponse.json({
          ...incomplete.mapping,
          revision: 1,
          isComplete: true,
          missingRequiredFields: [],
          mappings: [
            { columnPosition: 0, fieldKey: 'sku' },
            { columnPosition: 2, fieldKey: 'priceInCents' },
          ],
        })
      }),
      http.get(contextUrl, () =>
        HttpResponse.json({
          ...incomplete,
          mapping: {
            ...incomplete.mapping,
            revision: 1,
            isComplete: true,
            missingRequiredFields: [],
            mappings: [
              { columnPosition: 0, fieldKey: 'sku' },
              { columnPosition: 2, fieldKey: 'priceInCents' },
            ],
          },
        }),
      ),
    )

    renderLoaded(incomplete)

    const selects = screen.getAllByLabelText(/destino da coluna/i)
    await user.selectOptions(selects[2]!, 'priceInCents')
    await user.click(screen.getByRole('button', { name: /salvar mapping/i }))

    await waitFor(() => {
      expect(putBody).toEqual({
        expectedRevision: 0,
        mappings: [
          { columnPosition: 0, fieldKey: 'sku' },
          { columnPosition: 2, fieldKey: 'priceInCents' },
        ],
      })
    })
  })

  it('does not overwrite on mapping revision conflict', async () => {
    const user = userEvent.setup()
    replaceSessionCredential(IMPORT_ID, IMPORT_TOKEN)

    const incomplete = {
      ...uploadedContext,
      mapping: {
        ...uploadedContext.mapping,
        revision: 1,
        isComplete: false,
        missingRequiredFields: ['priceInCents'],
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      },
    }

    const serverMapping = {
      ...incomplete.mapping,
      revision: 4,
      mappings: [{ columnPosition: 1, fieldKey: 'stock' }],
    }

    server.use(
      http.put(mappingUrl, () =>
        HttpResponse.json(
          {
            code: 'IMPORT.MAPPING_REVISION_CONFLICT',
            message: 'conflict',
            traceId: 'req_conflict',
          },
          { status: 409 },
        ),
      ),
      http.get(contextUrl, () =>
        HttpResponse.json({
          ...incomplete,
          mapping: serverMapping,
        }),
      ),
    )

    renderLoaded(incomplete)
    const selects = screen.getAllByLabelText(/destino da coluna/i)
    await user.selectOptions(selects[2]!, 'priceInCents')
    await user.click(screen.getByRole('button', { name: /salvar mapping/i }))

    expect(
      await screen.findByText(/outra alteração do mapping foi salva/i),
    ).toBeInTheDocument()
    expect(selects[2]).toHaveValue('priceInCents')
    expect(
      screen.getByRole('button', { name: /descartar alterações locais/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /reaplicar associações locais/i }),
    ).toBeInTheDocument()
  })

  it('keeps local selection until conflict decision and rebases without saving', async () => {
    const user = userEvent.setup()
    replaceSessionCredential(IMPORT_ID, IMPORT_TOKEN)
    let putCalls = 0

    const incomplete = {
      ...uploadedContext,
      mapping: {
        ...uploadedContext.mapping,
        revision: 1,
        isComplete: false,
        missingRequiredFields: ['priceInCents'],
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      },
    }

    server.use(
      http.put(mappingUrl, async () => {
        putCalls += 1
        return HttpResponse.json(
          {
            code: 'IMPORT.MAPPING_REVISION_CONFLICT',
            message: 'conflict',
            traceId: 'req_conflict_2',
          },
          { status: 409 },
        )
      }),
      http.get(contextUrl, () =>
        HttpResponse.json({
          ...incomplete,
          mapping: {
            ...incomplete.mapping,
            revision: 7,
            mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
          },
        }),
      ),
    )

    renderLoaded(incomplete)
    const selects = screen.getAllByLabelText(/destino da coluna/i)
    await user.selectOptions(selects[2]!, 'priceInCents')
    await user.click(screen.getByRole('button', { name: /salvar mapping/i }))
    expect(await screen.findByText(/revisão atual no servidor: 7/i)).toBeInTheDocument()
    expect(selects[2]).toHaveValue('priceInCents')

    await user.click(
      screen.getByRole('button', { name: /reaplicar associações locais/i }),
    )

    expect(selects[2]).toHaveValue('priceInCents')
    expect(screen.getByText(/revisão local esperada: 7/i)).toBeInTheDocument()
    expect(putCalls).toBe(1)
    expect(
      screen.getByRole('button', { name: /salvar mapping/i }),
    ).toBeEnabled()
  })

  it('runs preview and shows invalid rows without treating them as request failure', async () => {
    const user = userEvent.setup()
    replaceSessionCredential(IMPORT_ID, IMPORT_TOKEN)

    server.use(
      http.post(previewUrl, async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({
          expectedMappingRevision: 1,
          limit: 20,
        })
        return HttpResponse.json({
          importId: IMPORT_ID,
          mappingRevision: 1,
          contentSha256: 'b'.repeat(64),
          normalizationProfile: 'pt-BR-v1',
          summary: { totalRows: 2, validRows: 1, invalidRows: 1 },
          limit: 20,
          sampleTruncated: true,
          rows: [
            {
              recordNumber: 1,
              valid: true,
              data: { sku: 'A', priceInCents: 29990 },
              errors: [],
            },
            {
              recordNumber: 2,
              valid: false,
              data: null,
              errors: [
                {
                  fieldKey: 'priceInCents',
                  code: 'FIELD.INVALID_CURRENCY',
                  message: 'Value must be a currency amount in pt-BR format.',
                },
              ],
            },
          ],
        })
      }),
    )

    renderLoaded(uploadedContext)
    await user.click(screen.getByRole('button', { name: /gerar preview/i }))

    expect((await screen.findAllByText(/29990/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/inválido/i).length).toBeGreaterThan(0)
    expect(
      screen.getByText(/estatísticas cobrem o arquivo inteiro/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/confirmação e o processamento definitivo ainda não/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /resumo/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /amostra/i })).toBeInTheDocument()
    expect(
      document.querySelector('[data-preview-layout="cards"]'),
    ).not.toBeNull()
    expect(
      document.querySelector('[data-preview-layout="table"]'),
    ).not.toBeNull()
    expect(screen.getAllByText('FIELD.INVALID_CURRENCY').length).toBeGreaterThan(
      0,
    )
  })

  it('offers manual retry for preview 503', async () => {
    const user = userEvent.setup()
    replaceSessionCredential(IMPORT_ID, IMPORT_TOKEN)
    let calls = 0

    server.use(
      http.post(previewUrl, () => {
        calls += 1
        if (calls === 1) {
          return HttpResponse.json(
            {
              code: 'IMPORT.PREVIEW_UNAVAILABLE',
              message: 'down',
              traceId: 'req_503',
            },
            { status: 503 },
          )
        }
        return HttpResponse.json({
          importId: IMPORT_ID,
          mappingRevision: 1,
          contentSha256: 'c'.repeat(64),
          normalizationProfile: 'pt-BR-v1',
          summary: { totalRows: 1, validRows: 1, invalidRows: 0 },
          limit: 20,
          sampleTruncated: false,
          rows: [
            {
              recordNumber: 1,
              valid: true,
              data: { sku: 'OK', priceInCents: 100 },
              errors: [],
            },
          ],
        })
      }),
    )

    renderLoaded(uploadedContext)
    await user.click(screen.getByRole('button', { name: /gerar preview/i }))
    expect(
      await screen.findByText(/temporariamente indisponível/i),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(await screen.findAllByText('OK')).not.toHaveLength(0)
    expect(calls).toBe(2)
  })

  it('keeps created session recoverable after upload 413', async () => {
    const user = userEvent.setup()
    replaceSessionCredential(IMPORT_ID, IMPORT_TOKEN)
    let uploads = 0

    server.use(
      http.post(fileUrl, () => {
        uploads += 1
        return HttpResponse.json(
          {
            code: 'IMPORT.FILE_TOO_LARGE',
            message: 'too large',
            traceId: 'req_413',
          },
          { status: 413 },
        )
      }),
      http.get(contextUrl, () => HttpResponse.json(createdContext)),
    )

    renderLoaded(createdContext)
    const file = new File(['x'], 'grande.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText(/escolher arquivo csv/i), file)
    await user.click(screen.getByRole('button', { name: /enviar arquivo/i }))

    expect(await screen.findByText(/excede o limite/i)).toBeInTheDocument()
    expect(uploads).toBe(1)
    expect(screen.getByLabelText(/escolher arquivo csv/i)).toBeInTheDocument()
  })

  it('shows terminal state after upload 422 when context becomes upload_failed', async () => {
    const user = userEvent.setup()
    replaceSessionCredential(IMPORT_ID, IMPORT_TOKEN)
    let uploadedAttempt = false

    server.use(
      http.post(fileUrl, () => {
        uploadedAttempt = true
        return HttpResponse.json(
          {
            code: 'IMPORT.INVALID_CSV',
            message: 'invalid',
            traceId: 'req_422',
          },
          { status: 422 },
        )
      }),
      http.get(contextUrl, () =>
        HttpResponse.json(
          uploadedAttempt ? uploadFailedContext : createdContext,
        ),
      ),
    )

    renderConnected(createdContext)

    expect(
      await screen.findByLabelText(/escolher arquivo csv/i),
    ).toBeInTheDocument()

    const file = new File(['bad'], 'bad.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText(/escolher arquivo csv/i), file)
    await user.click(screen.getByRole('button', { name: /enviar arquivo/i }))

    expect(
      await screen.findByRole('status', { name: /falha no envio/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText(/escolher arquivo csv/i),
    ).not.toBeInTheDocument()
  })

  it('keeps preview stage closed while mapping is incomplete', () => {
    const incomplete = {
      ...uploadedContext,
      mapping: {
        ...uploadedContext.mapping,
        isComplete: false,
        missingRequiredFields: ['priceInCents'],
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      },
    }

    renderLoaded(incomplete)
    expect(screen.getByRole('button', { name: /salvar mapping/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /gerar preview/i }),
    ).not.toBeInTheDocument()
  })

  it('surfaces incompatible zod response without retrying mutation', async () => {
    const user = userEvent.setup()
    replaceSessionCredential(IMPORT_ID, IMPORT_TOKEN)
    let calls = 0

    server.use(
      http.post(previewUrl, () => {
        calls += 1
        return HttpResponse.json({ not: 'a preview' })
      }),
    )

    renderLoaded(uploadedContext)
    await user.click(screen.getByRole('button', { name: /gerar preview/i }))
    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent(/incompatível/i)
    expect(calls).toBe(1)
    expect(
      screen.queryByRole('button', { name: /tentar novamente/i }),
    ).not.toBeInTheDocument()
  })

  it('ends interaction messaging for expired token during mapping save', async () => {
    const user = userEvent.setup()
    replaceSessionCredential(IMPORT_ID, IMPORT_TOKEN)
    const incomplete = {
      ...uploadedContext,
      mapping: {
        ...uploadedContext.mapping,
        isComplete: false,
        missingRequiredFields: ['priceInCents'],
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
        revision: 0,
      },
    }

    server.use(
      http.put(mappingUrl, () =>
        HttpResponse.json(
          {
            code: 'AUTH.INVALID_IMPORT_TOKEN',
            message: 'expired',
            traceId: 'req_401',
          },
          { status: 401 },
        ),
      ),
    )

    renderLoaded(incomplete)
    const selects = screen.getAllByLabelText(/destino da coluna/i)
    await user.selectOptions(selects[2]!, 'priceInCents')
    await user.click(screen.getByRole('button', { name: /salvar mapping/i }))

    expect(await screen.findByText(/sessão expirou/i)).toBeInTheDocument()
  })
})
