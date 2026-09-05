import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('env file protection', () => {
  it('keeps .env.example available for local setup', () => {
    const example = readFileSync(join(frontendRoot, '.env.example'), 'utf8')

    expect(example).toContain('VITE_OPENIMPORT_API_BASE_URL=')
    expect(example).toContain('VITE_OPENIMPORT_PARENT_ORIGINS=')
    expect(example).toContain('VITE_OPENIMPORT_REPOSITORY_URL=')
    expect(example).not.toMatch(/oi_live_|oi_import_/)
  })

  it('ignores .env and variants while allowing .env.example', () => {
    const gitignore = readFileSync(join(frontendRoot, '.gitignore'), 'utf8')

    expect(gitignore).toMatch(/^\.env$/m)
    expect(gitignore).toMatch(/^\.env\.\*$/m)
    expect(gitignore).toMatch(/^!\.env\.example$/m)
  })
})
