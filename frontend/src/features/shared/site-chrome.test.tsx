import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { KAIDEV_URL } from '../../config/public-links.ts'
import { IMPORT_ID } from '../../test/fixtures.ts'
import { compactSessionId } from './session-id.ts'
import { SiteChrome } from './SiteChrome.tsx'

function renderChrome(
  variant: 'site' | 'workbench' | 'lab' = 'site',
  importId: string | null = null,
) {
  return render(
    <SiteChrome variant={variant} importId={importId}>
      <main id="conteudo-principal">
        <h1>Título da página</h1>
      </main>
    </SiteChrome>,
  )
}

describe('SiteChrome', () => {
  it('exposes skip link, landmarks and a single primary heading slot', () => {
    renderChrome()

    expect(
      screen.getByRole('link', { name: /ir para o conteúdo principal/i }),
    ).toHaveAttribute('href', '#conteudo-principal')
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /principal/i })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('marks public, lab and workbench context without a hamburger control', () => {
    const { unmount } = renderChrome('site')
    expect(screen.getByRole('banner')).toHaveAttribute(
      'data-chrome-context',
      'site',
    )
    expect(screen.getByText(/^site$/i)).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /principal/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /abrir índice do site/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /hamburger/i })).not.toBeInTheDocument()
    unmount()

    const lab = renderChrome('lab')
    expect(lab.getByRole('banner')).toHaveAttribute(
      'data-chrome-context',
      'lab',
    )
    expect(
      lab.getByRole('banner').querySelector('.oi-chrome-context'),
    ).toHaveTextContent(/^laboratório$/i)
    expect(
      lab.queryByRole('button', { name: /abrir índice do site/i }),
    ).not.toBeInTheDocument()
    lab.unmount()

    renderChrome('workbench', IMPORT_ID)
    expect(screen.getByRole('banner')).toHaveAttribute(
      'data-chrome-context',
      'workbench',
    )
    expect(screen.getByText(/importador/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /abrir índice do site/i }),
    ).not.toBeInTheDocument()
  })

  it('truncates the workbench session id visually while keeping the full value', () => {
    renderChrome('workbench', IMPORT_ID)

    const compact = screen.getByText(compactSessionId(IMPORT_ID))
    expect(compact).toHaveAttribute('title', IMPORT_ID)
    expect(screen.queryByText(IMPORT_ID)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^openimport$/i })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('keeps the footer attribution, license and protocol line', () => {
    renderChrome()

    expect(screen.getByText(/OPENIMPORT:\/\/SELF-HOSTED/i)).toBeInTheDocument()
    expect(screen.getByText('Apache-2.0')).toBeInTheDocument()

    const author = screen.getByRole('link', { name: /desenvolvido por kaid3v/i })
    expect(author).toHaveAttribute('href', KAIDEV_URL)
    expect(author).toHaveAttribute('target', '_blank')
    expect(author).toHaveAttribute('rel', 'noopener noreferrer')
    expect(author).toHaveTextContent('Desenvolvido por KaiD3v')
  })

  it('keeps lab chrome free of marketing nav and uses a lab protocol footer', () => {
    renderChrome('lab')

    expect(
      screen.queryByRole('link', { name: /abrir laboratório/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: /principal/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /^documentação$/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/OPENIMPORT:\/\/LAB/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/OPENIMPORT:\/\/SELF-HOSTED/i),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /desenvolvido por kaid3v/i }),
    ).not.toBeInTheDocument()
  })

  it('exposes Documentação in the public site nav', () => {
    renderChrome('site')
    expect(
      screen.getByRole('link', { name: /^documentação$/i }),
    ).toHaveAttribute('href', '/docs')
  })

  it('does not render a broken repository label when no GitHub URL is passed through', () => {
    renderChrome()

    expect(
      screen.queryByRole('link', { name: /^repositório$/i }),
    ).not.toBeInTheDocument()
  })

  it('keeps GitHub controls keyboard reachable when they exist', async () => {
    const user = userEvent.setup()
    renderChrome()

    await user.tab()
    expect(
      screen.getByRole('link', { name: /ir para o conteúdo principal/i }),
    ).toHaveFocus()
  })
})

describe('compactSessionId', () => {
  it('shortens a UUID without dropping the original value from title usage', () => {
    expect(compactSessionId(IMPORT_ID)).toBe('11111111…1111')
    expect(compactSessionId('short')).toBe('short')
  })
})
