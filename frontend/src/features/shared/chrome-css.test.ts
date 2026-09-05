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

  it('treats the lab as a flush instrument grid with canvas before side panels', () => {
    expect(css).toMatch(
      /\.oi-lab-layout\s*\{[^}]*grid-template-areas:\s*"actions"\s*"main"\s*"creds"\s*"fixtures"\s*"log"/s,
    )
    expect(css).toMatch(/@media \(min-width: 768px\)[\s\S]*\.oi-lab-layout/)
    expect(css).toMatch(
      /"actions main"\s*"creds main"\s*"fixtures log"/s,
    )
    expect(css).toMatch(
      /"actions main log"\s*"creds main log"\s*"fixtures main log"/s,
    )
    expect(css).not.toMatch(/\.oi-lab-panel\s*\{[^}]*margin-bottom/s)
  })

  it('styles the public /docs guide layout, TOC and terminal code blocks', () => {
    expect(css).toMatch(/\.oi-docs\s*\{/)
    expect(css).toMatch(/\.oi-docs-toc\s*\{/)
    expect(css).toMatch(/\.oi-docs-section\s*\{/)
    expect(css).toMatch(/\.oi-docs-terminal\s*\{/)
    expect(css).toMatch(/\.oi-syn-keyword\s*\{/)
  })
})
