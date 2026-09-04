import { afterEach, describe, expect, it } from 'vitest'
import { IMPORT_ID, IMPORT_TOKEN } from '../test/fixtures.ts'
import {
  clearSessionCredential,
  readSessionCredential,
  replaceSessionCredential,
} from './session-credential.ts'

describe('session credential store', () => {
  afterEach(() => {
    clearSessionCredential()
  })

  it('keeps the token in memory for a single importId', () => {
    replaceSessionCredential(IMPORT_ID, IMPORT_TOKEN)

    expect(readSessionCredential(IMPORT_ID)).toBe(IMPORT_TOKEN)
  })

  it('replaces the credential when the same importId is reinitialized', () => {
    const nextToken = `oi_import_${'ef'.repeat(32)}`
    replaceSessionCredential(IMPORT_ID, IMPORT_TOKEN)
    replaceSessionCredential(IMPORT_ID, nextToken)

    expect(readSessionCredential(IMPORT_ID)).toBe(nextToken)
  })

  it('refuses to store a credential for a different importId', () => {
    replaceSessionCredential(IMPORT_ID, IMPORT_TOKEN)

    expect(() =>
      replaceSessionCredential(
        '22222222-2222-4222-8222-222222222222',
        `oi_import_${'11'.repeat(32)}`,
      ),
    ).toThrow(/importId/)

    expect(readSessionCredential(IMPORT_ID)).toBe(IMPORT_TOKEN)
  })
})
