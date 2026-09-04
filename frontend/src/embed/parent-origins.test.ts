import { describe, expect, it } from 'vitest'
import { parseParentOrigins } from './parent-origins.ts'

describe('parseParentOrigins', () => {
  it('parses a comma-separated allowlist of absolute origins', () => {
    const result = parseParentOrigins(
      'http://localhost:5173, https://app.example.com',
      { isProduction: false },
    )

    expect(result).toEqual({
      ok: true,
      origins: ['http://localhost:5173', 'https://app.example.com'],
    })
  })

  it('rejects a wildcard in any environment', () => {
    const result = parseParentOrigins('https://app.example.com, *', {
      isProduction: false,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('OPENIMPORT.INVALID_PARENT_ORIGINS')
  })

  it('requires an allowlist in production', () => {
    const result = parseParentOrigins('', { isProduction: true })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('OPENIMPORT.MISSING_PARENT_ORIGINS')
  })

  it('rejects a relative origin', () => {
    const result = parseParentOrigins('localhost:5173', {
      isProduction: false,
    })

    expect(result.ok).toBe(false)
  })
})
