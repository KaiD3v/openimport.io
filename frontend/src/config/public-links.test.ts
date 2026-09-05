import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXTERNAL_LINK_REL,
  KAIDEV_URL,
  readRepositoryUrl,
  repositoryConfigHint,
} from './public-links.ts'

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const repoRoot = join(frontendRoot, '..')

describe('public links', () => {
  it('centralizes the KaiD3v portfolio URL', () => {
    expect(KAIDEV_URL).toBe('https://kaidev.com.br/')
  })

  it('reads the repository URL only from the provided value', () => {
    expect(
      readRepositoryUrl('https://github.com/example-org/openimport.io'),
    ).toBe('https://github.com/example-org/openimport.io')
    expect(readRepositoryUrl('  https://gitlab.com/acme/openimport  ')).toBe(
      'https://gitlab.com/acme/openimport',
    )
  })

  it('returns null when the repository URL is missing or invalid', () => {
    expect(readRepositoryUrl(undefined)).toBeNull()
    expect(readRepositoryUrl('')).toBeNull()
    expect(readRepositoryUrl('   ')).toBeNull()
    expect(readRepositoryUrl('not-a-url')).toBeNull()
    expect(readRepositoryUrl('javascript:alert(1)')).toBeNull()
  })

  it('does not invent a GitHub fallback in source or env examples', () => {
    const moduleSource = readFileSync(
      join(frontendRoot, 'src/config/public-links.ts'),
      'utf8',
    )
    const envExample = readFileSync(join(frontendRoot, '.env.example'), 'utf8')
    const productionExample = readFileSync(
      join(repoRoot, '.env.production.example'),
      'utf8',
    )

    expect(moduleSource).not.toContain('github.com/KaiD3v/openimport.io')
    expect(envExample).not.toContain('github.com/KaiD3v/openimport.io')
    expect(envExample).toContain('VITE_OPENIMPORT_REPOSITORY_URL=')
    expect(productionExample).toContain('VITE_OPENIMPORT_REPOSITORY_URL')
  })

  it('uses a safe rel for external targets', () => {
    expect(EXTERNAL_LINK_REL).toBe('noopener noreferrer')
  })

  it('keeps the repository URL defined in one module', () => {
    const source = readFileSync(
      join(frontendRoot, 'src/config/public-links.ts'),
      'utf8',
    )
    expect(source).toContain('readRepositoryUrl')
    expect(source).toContain('VITE_OPENIMPORT_REPOSITORY_URL')
  })

  it('hints in development when the repository URL is absent, without echoing env values', () => {
    expect(repositoryConfigHint(null, true)).toMatch(
      /VITE_OPENIMPORT_REPOSITORY_URL/,
    )
    expect(repositoryConfigHint(null, true)).not.toMatch(/oi_import_|oi_live_/)
    expect(repositoryConfigHint(null, false)).toBeNull()
    expect(
      repositoryConfigHint('https://github.com/acme/openimport', true),
    ).toBeNull()
  })
})
