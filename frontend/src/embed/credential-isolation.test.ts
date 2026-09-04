import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importContextQueryKey } from '../api/query-key.ts'
import { IMPORT_ID, IMPORT_TOKEN } from '../test/fixtures.ts'

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('credential isolation', () => {
  it('does not put the access token in the query key', () => {
    const key = importContextQueryKey(IMPORT_ID)

    expect(key).toEqual(['import-context', IMPORT_ID])
    expect(JSON.stringify(key)).not.toContain(IMPORT_TOKEN)
    expect(JSON.stringify(key)).not.toContain('oi_import_')
    expect(JSON.stringify(key)).not.toContain('oi_live_')
  })

  it('does not log initialize payloads from production source files', () => {
    const protocol = readFileSync(
      join(srcRoot, 'embed', 'use-host-session.ts'),
      'utf8',
    )

    expect(protocol).not.toMatch(/console\.(log|info|debug|warn|error)\(/)
  })
})
