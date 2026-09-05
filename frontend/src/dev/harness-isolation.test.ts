import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('development harness isolation', () => {
  it('loads the harness only behind a DEV-only dynamic import', () => {
    const main = readFileSync(join(frontendRoot, 'src/main.tsx'), 'utf8')

    expect(main).toContain('import.meta.env.DEV')
    expect(main).toMatch(/import\(['"]\.\/dev\/DevHarness/)
  })

  it('keeps unique harness copy out of the production entry', () => {
    const main = readFileSync(join(frontendRoot, 'src/main.tsx'), 'utf8')

    expect(main).not.toContain('openimport-dev-harness')
    expect(main).not.toContain('OpenImport Lab')
    expect(main).not.toContain('Laboratório OpenImport')
    expect(main).not.toContain('Harness de desenvolvimento')
  })

  it('keeps visual fixtures behind the dynamic harness import', () => {
    const harness = readFileSync(
      join(frontendRoot, 'src/dev/DevHarness.tsx'),
      'utf8',
    )

    expect(harness).toMatch(/visual-fixtures|Fixtures/)
  })
})
