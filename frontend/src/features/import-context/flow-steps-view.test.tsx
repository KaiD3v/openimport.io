import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createdContext, uploadedContext } from '../../test/fixtures.ts'
import { FlowSteps } from './FlowSteps.tsx'

describe('FlowSteps compact presentation', () => {
  it('exposes a compact current-step summary while keeping the full list', () => {
    render(<FlowSteps context={createdContext} />)

    expect(screen.getByText(/etapa 1 de 5/i)).toBeInTheDocument()
    expect(screen.getAllByText(/^Upload$/).length).toBeGreaterThan(0)
    const more = screen.getByText(/ver todas as etapas/i)
    expect(more.closest('summary')).not.toBeNull()
    expect(
      screen.getAllByRole('listitem', { hidden: true }).length,
    ).toBeGreaterThanOrEqual(5)
  })

  it('keeps the full step list operable from the disclosure', async () => {
    const user = userEvent.setup()
    render(<FlowSteps context={uploadedContext} />)

    const toggle = screen.getByText(/ver todas as etapas/i)
    const details = toggle.closest('details')
    expect(details).not.toBeNull()
    if (details && !details.open) {
      await user.click(toggle)
    }

    expect(screen.getByText(/etapa 3 de 5/i)).toBeInTheDocument()
    expect(screen.getAllByText('Revisar').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Mapear').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Resultado').length).toBeGreaterThan(0)
  })
})
