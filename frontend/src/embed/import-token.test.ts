import { describe, expect, it } from 'vitest'
import { IMPORT_TOKEN, LIVE_API_KEY } from '../test/fixtures.ts'
import { assertImportAccessToken, isImportAccessToken } from './import-token.ts'

describe('import access token', () => {
  it('accepts oi_import_ followed by 64 lowercase hex characters', () => {
    expect(isImportAccessToken(IMPORT_TOKEN)).toBe(true)
    expect(assertImportAccessToken(IMPORT_TOKEN)).toEqual({
      ok: true,
      accessToken: IMPORT_TOKEN,
    })
  })

  it('rejects a malformed token', () => {
    expect(isImportAccessToken('oi_import_short')).toBe(false)
    expect(isImportAccessToken(`oi_import_${'AB'.repeat(32)}`)).toBe(false)
    expect(isImportAccessToken(`oi_import_${'ab'.repeat(31)}zz`)).toBe(false)
  })

  it('rejects an organizational API key', () => {
    expect(isImportAccessToken(LIVE_API_KEY)).toBe(false)
    expect(assertImportAccessToken(LIVE_API_KEY)).toEqual({
      ok: false,
      code: 'OPENIMPORT.LIVE_API_KEY_REJECTED',
    })
  })
})
