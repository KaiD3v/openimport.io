import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'
import { IMPORT_ID } from './test/fixtures.ts'



function renderAt(pathname: string) {
  window.history.pushState({}, '', pathname)
  return render(<App />)
}

describe('App routing', () => {
  it('renders homepage at / without requiring embed config', () => {
    renderAt('/')
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /transforme csv em payloads confiáveis de api/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: /abrir laboratório/i })[0],
    ).toHaveAttribute('href', '/dev')
  })

  it('renders a dedicated 404 for unknown routes', () => {
    renderAt('/does-not-exist')
    expect(
      screen.getByRole('heading', { name: /não encontrada/i }),
    ).toBeInTheDocument()
  })

  it('renders invalid import page for bad UUID', () => {
    renderAt('/imports/not-a-uuid')
    expect(
      screen.getByRole('heading', { name: /identificador inválido/i }),
    ).toBeInTheDocument()
  })

  it('enters the import shell for a valid import path', () => {
    renderAt(`/imports/${IMPORT_ID}`)
    expect(screen.getByText(/csv → mapping → json/i)).toBeInTheDocument()
  })
})
