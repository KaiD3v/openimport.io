import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../index.css'),
  'utf8',
)

describe('global chrome CSS', () => {
  it('paints a fixed 44px grid on body::before, not only on an opaque body fill', () => {
    expect(css).toMatch(/body::before\s*\{/)
    expect(css).toMatch(/background-size:\s*44px 44px/)
    expect(css).toMatch(/pointer-events:\s*none/)
    expect(css).toMatch(/body::after\s*\{/)
  })

  it('lets the grid show through empty shell areas', () => {
    expect(css).toMatch(/\.oi-site\s*\{[^}]*background:\s*transparent/s)
    expect(css).toMatch(/\.oi-app\s*\{[^}]*background:\s*transparent/s)
    expect(css).toMatch(/\.oi-lab\s*\{[^}]*background:\s*transparent/s)
  })

  it('keeps the workbench footer as a full-width third grid row', () => {
    expect(css).toMatch(
      /\.oi-app\s*\{[^}]*grid-template-rows:\s*auto 1fr auto/s,
    )
  })

  it('composes the public navbar as an intentional two-row mobile layout', () => {
    expect(css).toMatch(/\.oi-chrome-header-inner/)
    expect(css).toMatch(/grid-template-areas:/)
    expect(css).not.toMatch(/hamburger/i)
  })
})
