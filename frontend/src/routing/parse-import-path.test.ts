import { describe, expect, it } from 'vitest'
import { IMPORT_ID } from '../test/fixtures.ts'
import { parseImportIdFromPath } from './parse-import-path.ts'

describe('parseImportIdFromPath', () => {
  it('extracts a valid UUID from /imports/:importId', () => {
    const result = parseImportIdFromPath(`/imports/${IMPORT_ID}`)

    expect(result).toEqual({ ok: true, importId: IMPORT_ID })
  })

  it('accepts a trailing slash', () => {
    const result = parseImportIdFromPath(`/imports/${IMPORT_ID}/`)

    expect(result).toEqual({ ok: true, importId: IMPORT_ID })
  })

  it('rejects a missing import id', () => {
    expect(parseImportIdFromPath('/imports')).toEqual({
      ok: false,
      reason: 'missing',
    })
    expect(parseImportIdFromPath('/imports/')).toEqual({
      ok: false,
      reason: 'missing',
    })
    expect(parseImportIdFromPath('/')).toEqual({
      ok: false,
      reason: 'missing',
    })
  })

  it('rejects a path that is not an import route', () => {
    expect(parseImportIdFromPath('/dev')).toEqual({
      ok: false,
      reason: 'missing',
    })
  })

  it('rejects an invalid UUID', () => {
    expect(parseImportIdFromPath('/imports/not-a-uuid')).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(
      parseImportIdFromPath('/imports/11111111-1111-1111-1111-11111111111z'),
    ).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })
})
