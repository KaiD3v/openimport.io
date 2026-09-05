import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { KAIDEV_URL } from '../../config/public-links.ts'
import { HomePage } from './HomePage.tsx'
import { NotFoundPage } from './NotFoundPage.tsx'
import { InvalidImportPage } from './InvalidImportPage.tsx'

describe('public pages without embed config', () => {
  it('renders homepage content without API or origin env', () => {
    render(<HomePage />)
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /transforme csv em payloads confiáveis de api/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText(/composição csv para mapping e json/i),
    ).toBeInTheDocument()
    expect(screen.getAllByText(/priceInCents/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/29990/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/registros válidos/i).length).toBeGreaterThan(0)
  })

  it('links to the integration documentation', () => {
    render(<HomePage />)
    const docs = screen.getAllByRole('link', {
      name: /documentação|ler documentação/i,
    })
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.some((el) => el.getAttribute('href') === '/docs')).toBe(true)
  })

  it('exposes the production embed path for external host systems', () => {
    render(<HomePage />)
    const embed = screen.getAllByRole('link', {
      name: /rota de produção para sistemas externos: \/imports\/:importId/i,
    })
    expect(embed.length).toBeGreaterThan(0)
    expect(
      embed.every((el) => el.getAttribute('href')?.startsWith('/docs')),
    ).toBe(true)
    expect(embed[0]).toHaveTextContent('/imports/:importId')
  })

  it('exposes a laboratory CTA in development', () => {
    render(<HomePage />)
    const lab = screen.getAllByRole('link', { name: /abrir laboratório/i })
    expect(lab.length).toBeGreaterThan(0)
    expect(lab[0]).toHaveAttribute('href', '/dev')
    expect(
      screen.getByText(/laboratório em/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/sistemas externos usam/i),
    ).toBeInTheDocument()
  })

  it('has skip link, landmarks, one h1 and a keyboard-reachable GitHub name', async () => {
    const user = userEvent.setup()
    render(<HomePage />)

    expect(
      screen.getByRole('link', { name: /ir para o conteúdo principal/i }),
    ).toHaveAttribute('href', '#conteudo-principal')
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /principal/i })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    await user.tab()
    expect(
      screen.getByRole('link', { name: /ir para o conteúdo principal/i }),
    ).toHaveFocus()

    expect(
      screen.queryByRole('link', { name: /^repositório$/i }),
    ).not.toBeInTheDocument()
  })

  it('renders footer attribution and external repository links', () => {
    render(<HomePage />)
    const author = screen.getByRole('link', { name: /desenvolvido por kaid3v/i })
    expect(author).toHaveAttribute('href', KAIDEV_URL)
    expect(author).toHaveAttribute('target', '_blank')
    expect(author).toHaveAttribute('rel', 'noopener noreferrer')
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
    expect(screen.getByText(/\/docs/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /desenvolvido por kaid3v/i }),
    ).toBeInTheDocument()
  })

  it('renders invalid import composition', () => {
    render(<InvalidImportPage />)
    expect(
      screen.getByRole('heading', { name: /identificador inválido/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('IMPORT.INVALID_ID')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /desenvolvido por kaid3v/i }),
    ).toBeInTheDocument()
  })
})
