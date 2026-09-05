import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { IMPORT_ID, IMPORT_TOKEN } from '../test/fixtures.ts'
import { server } from '../test/setup.ts'
import { DevHarness } from './DevHarness.tsx'

function labSessionHandler(
  body: Record<string, string>,
  status = 200,
) {
  return http.post('*/__openimport/lab-session', () =>
    HttpResponse.json(body, { status }),
  )
}

describe('DevHarness console', () => {
  it('keeps the temporary token hidden by default', () => {
    render(<DevHarness />)
    const token = screen.getByLabelText(/token temporário/i)
    expect(token).toHaveAttribute('type', 'password')
  })

  it('toggles token visibility without persisting it', async () => {
    const user = userEvent.setup()
    render(<DevHarness />)
    const token = screen.getByLabelText(/token temporário/i)
    await user.type(token, IMPORT_TOKEN)
    await user.click(screen.getByRole('button', { name: /mostrar token/i }))
    expect(token).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: /ocultar token/i }))
    expect(token).toHaveAttribute('type', 'password')
    expect(window.location.href).not.toContain(IMPORT_TOKEN)
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('disables initialize until iframe path and credentials are valid', async () => {
    const user = userEvent.setup()
    render(<DevHarness />)

    const initialize = screen.getByRole('button', { name: /inicializar sessão/i })
    expect(initialize).toBeDisabled()

    await user.type(screen.getByLabelText(/^importId$/i), IMPORT_ID)
    await user.type(screen.getByLabelText(/token temporário/i), IMPORT_TOKEN)
    expect(initialize).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /carregar iframe/i }))
    const iframe = await screen.findByTitle('OpenImport')
    fireEvent.load(iframe)
    await waitFor(() => {
      expect(initialize).toBeEnabled()
    })
  })

  it('places the QA canvas after create-session and before the fixture wall', () => {
    render(<DevHarness />)

    const create = screen.getByRole('button', {
      name: /criar sessão de laboratório/i,
    })
    const canvas = screen.getByLabelText(/canvas de qa/i)
    const fixtures = screen.getByTestId('openimport-lab-fixtures-advanced')

    expect(
      create.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(
      canvas.compareDocumentPosition(fixtures) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('keeps complete fixture groups collapsed until opened', () => {
    render(<DevHarness />)

    const fixtures = screen.getByTestId('openimport-lab-fixtures-advanced')
    const groups = fixtures.querySelectorAll<HTMLDetailsElement>(
      'details.oi-lab-fixture-group',
    )
    expect(groups.length).toBeGreaterThan(1)
    for (const group of groups) {
      expect(group.open).toBe(false)
    }
  })

  it('marks the selected fixture visually from the compact picker', async () => {
    const user = userEvent.setup()
    render(<DevHarness />)
    await user.selectOptions(
      screen.getByLabelText(/seletor rápido de fixture/i),
      'created',
    )
    expect(screen.getByTestId('openimport-visual-fixture')).toHaveAttribute(
      'data-fixture-id',
      'created',
    )
    expect(screen.getByLabelText(/seletor rápido de fixture/i)).toHaveValue(
      'created',
    )
  })

  it('records harness events without credential values', async () => {
    const user = userEvent.setup()
    render(<DevHarness />)
    await user.type(screen.getByLabelText(/^importId$/i), IMPORT_ID)
    await user.type(screen.getByLabelText(/token temporário/i), IMPORT_TOKEN)
    await user.click(screen.getByRole('button', { name: /carregar iframe/i }))
    fireEvent.load(await screen.findByTitle('OpenImport'))

    const log = await screen.findByTestId('openimport-harness-log')
    await waitFor(() => {
      expect(log.textContent).toMatch(/iframe \/imports\//i)
    })
    expect(log.textContent).not.toContain(IMPORT_TOKEN)
    expect(log.textContent).not.toContain('oi_import_')
  })

  it('fills credentials from the lab session endpoint and auto-initializes', async () => {
    const user = userEvent.setup()
    const postMessage = vi.fn()
    server.use(
      labSessionHandler({
        importId: IMPORT_ID,
        accessToken: IMPORT_TOKEN,
        expiresAt: '2026-09-05T16:00:00.000Z',
        templateId: '33333333-3333-4333-8333-333333333333',
      }),
    )

    render(<DevHarness />)
    await user.click(
      screen.getByRole('button', { name: /criar sessão de laboratório/i }),
    )

    await waitFor(() => {
      expect(screen.getByLabelText(/^importId$/i)).toHaveValue(IMPORT_ID)
      expect(screen.getByLabelText(/token temporário/i)).toHaveValue(
        IMPORT_TOKEN,
      )
    })

    const iframe = await screen.findByTitle('OpenImport')
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage },
      configurable: true,
    })
    fireEvent.load(iframe)

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'openimport.initialize',
          importId: IMPORT_ID,
          accessToken: IMPORT_TOKEN,
        }),
        window.location.origin,
      )
    })

    const log = screen.getByTestId('openimport-harness-log')
    expect(log.textContent).toMatch(/lab-session criada/)
    expect(log.textContent).not.toContain(IMPORT_TOKEN)
    expect(log.textContent).not.toContain('oi_live_')
    expect(window.location.href).not.toContain(IMPORT_TOKEN)
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('shows a lab session error without filling credentials', async () => {
    const user = userEvent.setup()
    server.use(
      labSessionHandler(
        { message: 'Backend indisponível em localhost:3000.' },
        503,
      ),
    )

    render(<DevHarness />)
    await user.click(
      screen.getByRole('button', { name: /criar sessão de laboratório/i }),
    )

    expect(
      await screen.findByText(/backend indisponível em localhost:3000/i),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/^importId$/i)).toHaveValue('')
    expect(screen.getByLabelText(/token temporário/i)).toHaveValue('')
  })

  it('disables the lab session button while the request is pending', async () => {
    const user = userEvent.setup()
    let release: ((value?: unknown) => void) | undefined
    const gate = new Promise((resolve) => {
      release = resolve
    })
    server.use(
      http.post('*/__openimport/lab-session', async () => {
        await gate
        return HttpResponse.json({
          importId: IMPORT_ID,
          accessToken: IMPORT_TOKEN,
          expiresAt: '2026-09-05T16:00:00.000Z',
          templateId: '33333333-3333-4333-8333-333333333333',
        })
      }),
    )

    render(<DevHarness />)
    const button = screen.getByRole('button', {
      name: /criar sessão de laboratório/i,
    })
    await user.click(button)

    expect(button).toBeDisabled()
    expect(screen.getByText(/a criar sessão/i)).toBeInTheDocument()

    release?.()
    await waitFor(() => {
      expect(button).toBeEnabled()
    })
  })

  it('invites creating a session from the empty canvas and keeps a single primary action', () => {
    render(<DevHarness />)

    expect(
      screen.getByText(/crie uma sessão para ver o importador neste canvas/i),
    ).toBeInTheDocument()

    const primaries = screen
      .getByTestId('openimport-dev-harness')
      .querySelectorAll('.oi-lab-actions-bar .oi-primary')
    expect(primaries).toHaveLength(1)
    expect(primaries[0]).toHaveAccessibleName(/criar sessão de laboratório/i)
  })
})
