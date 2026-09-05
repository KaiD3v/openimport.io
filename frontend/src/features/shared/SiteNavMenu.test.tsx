import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SiteNavMenu } from './SiteNavMenu.tsx'

function mockCompactViewport(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width: 767px') ? matches : !matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

describe('SiteNavMenu', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('opens an in-flow site index tray on compact viewports', async () => {
    mockCompactViewport(true)
    const user = userEvent.setup()
    render(<SiteNavMenu />)

    const toggle = screen.getByRole('button', { name: /abrir índice do site/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('ÍNDICE')).toBeInTheDocument()
    const closedNav = document.querySelector('.oi-site-nav')
    expect(closedNav).toHaveAttribute('aria-hidden', 'true')
    expect(closedNav).not.toHaveClass('is-open')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('navigation', { name: /principal/i })).toHaveClass(
      'is-open',
    )
    expect(
      screen.getByRole('link', { name: /^como funciona$/i }),
    ).toHaveAttribute('href', '/#pipeline')
    expect(
      screen.getByRole('link', { name: /^documentação$/i }),
    ).toHaveAttribute('href', '/docs')
    expect(screen.getByRole('link', { name: /^como funciona$/i })).toHaveFocus()
  })

  it('closes on Escape and returns focus to the toggle', async () => {
    mockCompactViewport(true)
    const user = userEvent.setup()
    render(<SiteNavMenu />)

    await user.click(screen.getByRole('button', { name: /abrir índice do site/i }))
    await user.keyboard('{Escape}')

    const toggle = screen.getByRole('button', { name: /abrir índice do site/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })

  it('keeps the lab CTA beside the index toggle when requested', () => {
    mockCompactViewport(true)
    render(<SiteNavMenu showLabCta />)
    expect(
      screen.getByRole('link', { name: /abrir laboratório/i }),
    ).toHaveAttribute('href', '/dev')
  })
})
