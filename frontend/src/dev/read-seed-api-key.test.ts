import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseSeedApiKey,
  readSeedApiKey,
} from '../../scripts/read-seed-api-key.mjs'
import { LIVE_API_KEY } from '../test/fixtures.ts'

describe('readSeedApiKey', () => {
  it('parses a quoted oi_live_ key and trims whitespace', () => {
    expect(parseSeedApiKey(`SEED_API_KEY=" ${LIVE_API_KEY} "\n`)).toBe(
      LIVE_API_KEY,
    )
  })

  it('rejects a missing or non-live key', () => {
    expect(() => parseSeedApiKey('PORT=3000\n')).toThrow(/SEED_API_KEY missing/)
    expect(() => parseSeedApiKey('SEED_API_KEY=oi_import_nope\n')).toThrow(
      /must be oi_live_/,
    )
  })

  it('reads SEED_API_KEY from an env file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openimport-seed-'))
    const envPath = join(dir, '.env')
    writeFileSync(envPath, `SEED_API_KEY=${LIVE_API_KEY}\n`)
    expect(readSeedApiKey(envPath)).toBe(LIVE_API_KEY)
  })
})
