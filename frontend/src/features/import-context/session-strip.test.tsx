import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { uploadedContext } from '../../test/fixtures.ts'
import { SessionStrip } from './SessionStrip.tsx'

describe('SessionStrip', () => {
  it('collapses session, template and file behind a summary', () => {
    render(<SessionStrip context={uploadedContext} />)

    const disclosure = screen.getByRole('group')
    expect(disclosure.tagName).toBe('DETAILS')
    const summary = screen.getByText(/resumo da sessão/i)
    expect(summary.closest('summary')).not.toBeNull()
    expect(screen.getAllByText('Produtos').length).toBeGreaterThan(0)
    expect(screen.getAllByText('produtos-calcados.csv').length).toBeGreaterThan(0)
  })

  it('reveals session details from the keyboard-operable summary', async () => {
    const user = userEvent.setup()
    render(<SessionStrip context={uploadedContext} />)

    const summary = screen.getByText(/resumo da sessão/i)
    await user.click(summary)
    expect(screen.getByText('Mapping completo')).toBeInTheDocument()
    expect(screen.getByText('SKU')).toBeInTheDocument()
  })
})
