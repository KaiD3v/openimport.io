import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { IMPORT_ID, IMPORT_TOKEN } from '../test/fixtures.ts'
import { DevHarness } from './DevHarness.tsx'

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

  it('marks the selected fixture visually', async () => {
    const user = userEvent.setup()
    render(<DevHarness />)
    const fixtureButton = screen.getByRole('button', {
      name: /created — pronta para upload/i,
    })
    await user.click(fixtureButton)
    expect(fixtureButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('openimport-visual-fixture')).toHaveAttribute(
      'data-fixture-id',
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
})
