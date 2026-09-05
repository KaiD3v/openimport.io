import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveLabCta } from './lab-cta.ts'

const homeHero = join(
  dirname(fileURLToPath(import.meta.url)),
  'HomeHero.tsx',
)

describe('resolveLabCta', () => {
  it('exposes a clear laboratory CTA in development', () => {
    expect(resolveLabCta(true, null)).toEqual({
      kind: 'lab',
      href: '/dev',
      label: 'Abrir laboratório',
    })
  })

  it('does not create a dead /dev link in production', () => {
    const cta = resolveLabCta(false, null)
    expect(cta).toEqual({
      kind: 'pipeline',
      href: '#pipeline',
      label: 'Como funciona',
    })
    expect(cta.href).not.toBe('/dev')
    expect(cta.href).not.toContain('/dev')
  })

  it('uses the configured repository URL in production when present', () => {
    expect(
      resolveLabCta(false, 'https://github.com/acme/openimport'),
    ).toEqual({
      kind: 'github',
      href: 'https://github.com/acme/openimport',
      label: 'Ver no GitHub',
    })
  })

  it('gates the homepage laboratory href behind import.meta.env.DEV', () => {
    const source = readFileSync(homeHero, 'utf8')
    expect(source).toContain('import.meta.env.DEV')
    expect(source).toMatch(/href=["']\/dev["']/)
  })
})
