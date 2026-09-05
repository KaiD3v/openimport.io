import { describe, expect, it } from 'vitest'
import { IMPORT_ID } from '../test/fixtures.ts'
import { parseAppRoute } from './parse-app-route.ts'

describe('parseAppRoute', () => {
  it('routes / to home', () => {
    expect(parseAppRoute('/')).toEqual({ kind: 'home' })
    expect(parseAppRoute('')).toEqual({ kind: 'home' })
  })

  it('routes a valid import path', () => {
    expect(parseAppRoute(`/imports/${IMPORT_ID}`)).toEqual({
      kind: 'import',
      importId: IMPORT_ID,
    })
  })

  it('routes invalid UUID under /imports to invalid-import', () => {
    expect(parseAppRoute('/imports/not-a-uuid')).toEqual({
      kind: 'invalid-import',
    })
  })

  it('routes /docs to docs', () => {
    expect(parseAppRoute('/docs')).toEqual({ kind: 'docs' })
    expect(parseAppRoute('/docs/')).toEqual({ kind: 'docs' })
  })

  it('routes unknown paths to not-found', () => {
    expect(parseAppRoute('/docs/extra')).toEqual({ kind: 'not-found' })
    expect(parseAppRoute('/imports')).toEqual({ kind: 'not-found' })
  })
})
