import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocsPage } from './DocsPage.tsx'
import { DOCS_TOC } from './docs-toc.ts'

describe('DocsPage', () => {
  afterEach(() => {
    window.location.hash = ''
    vi.restoreAllMocks()
  })
  it('exposes landmarks, one h1 and a page TOC', () => {
    render(<DocsPage />)

    expect(
      screen.getByRole('link', { name: /ir para o conteúdo principal/i }),
    ).toHaveAttribute('href', '#conteudo-principal')
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(
      screen.getByRole('navigation', { name: /principal/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /documentação de integração/i,
      }),
    ).toBeInTheDocument()

    const toc = screen.getByRole('navigation', { name: /nesta página/i })
    for (const item of DOCS_TOC) {
      expect(
        toc.querySelector(`a[href="#${item.id}"]`),
      ).toBeInTheDocument()
    }
  })

  it('documents credentials, embed protocol and valid-rows delivery', () => {
    render(<DocsPage />)
    expect(screen.getAllByText(/oi_live_/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/oi_import_/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/openimport\.initialize/).length).toBeGreaterThan(
      0,
    )
    expect(screen.getAllByText(/valid-rows/).length).toBeGreaterThan(0)
    expect(document.body.textContent).toMatch(/nunca \*/)
  })

  it('links Documentação in the site nav and shows the published GitHub remote', () => {
    render(<DocsPage />)
    expect(
      screen.getByRole('link', { name: /^documentação$/i }),
    ).toHaveAttribute('href', '/docs')
    const repos = screen.getAllByRole('link', {
      name: /github/i,
    })
    expect(
      repos.some(
        (el) =>
          el.getAttribute('href') === 'https://github.com/KaiD3v/openimport.io',
      ),
    ).toBe(true)
  })

  it('renders Typescript terminals with copy actions on code samples', () => {
    render(<DocsPage />)
    expect(screen.getAllByText('Typescript').length).toBeGreaterThan(0)
    expect(
      screen.getAllByRole('button', {
        name: /copiar para a área de transferência/i,
      }).length,
    ).toBeGreaterThan(0)
    expect(document.querySelectorAll('.oi-syn-keyword').length).toBeGreaterThan(
      0,
    )
    expect(
      screen.getByRole('link', { name: /voltar à página inicial/i }),
    ).toHaveAttribute('href', '/')
  })

  it('keeps the skip link keyboard reachable', async () => {
    const user = userEvent.setup()
    render(<DocsPage />)
    await user.tab()
    expect(
      screen.getByRole('link', { name: /ir para o conteúdo principal/i }),
    ).toHaveFocus()
  })

  it('scrolls to the hash target after mount for deep links like /docs#passo-4-iframe', async () => {
    window.location.hash = '#passo-4-iframe'
    const scrollIntoView = vi.fn()
    const getElementById = Document.prototype.getElementById
    vi.spyOn(document, 'getElementById').mockImplementation((id) => {
      const el = getElementById.call(document, id)
      if (el && id === 'passo-4-iframe') {
        Object.defineProperty(el, 'scrollIntoView', {
          configurable: true,
          value: scrollIntoView,
        })
      }
      return el
    })

    render(<DocsPage />)
    expect(
      screen.getByRole('heading', {
        name: /passo 4 — iframe e postmessage/i,
      }),
    ).toBeInTheDocument()

    await vi.waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled()
    })
  })
})
