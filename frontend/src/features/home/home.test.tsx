import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HomePage } from './HomePage.tsx'
import { NotFoundPage } from './NotFoundPage.tsx'
import { InvalidImportPage } from './InvalidImportPage.tsx'

describe('public pages without embed config', () => {
  it('renders homepage content without API or origin env', () => {
    render(<HomePage />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'OpenImport' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/transformação visual/i)).toBeInTheDocument()
    expect(screen.getAllByText(/priceInCents/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/termina no preview/i)).toBeInTheDocument()
  })

  it('renders a dedicated 404 page', () => {
    render(<NotFoundPage />)
    expect(
      screen.getByRole('heading', { name: /não encontrad/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('ROUTE.NOT_FOUND')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /página inicial/i })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('renders invalid import composition', () => {
    render(<InvalidImportPage />)
    expect(
      screen.getByRole('heading', { name: /identificador inválido/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('IMPORT.INVALID_ID')).toBeInTheDocument()
  })
})
