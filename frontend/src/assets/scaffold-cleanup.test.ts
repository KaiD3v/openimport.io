import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const srcRoot = join(frontendRoot, 'src')

describe('removed scaffold assets', () => {
  it('does not keep an unused hero.png', () => {
    expect(() =>
      readFileSync(join(srcRoot, 'assets', 'hero.png')),
    ).toThrow()
  })

  it('does not reference hero.png from source files', () => {
    const app = readFileSync(join(srcRoot, 'App.tsx'), 'utf8')
    const main = readFileSync(join(srcRoot, 'main.tsx'), 'utf8')

    expect(app).not.toContain('hero.png')
    expect(main).not.toContain('hero.png')
  })
})
