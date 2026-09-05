import { describe, expect, it } from 'vitest'
import { readRuntimeConfig } from './runtime.ts'

function env(overrides: Partial<ImportMetaEnv> = {}): ImportMetaEnv {
  return {
    VITE_OPENIMPORT_API_BASE_URL: 'http://localhost:3000/api/v1',
    VITE_OPENIMPORT_PARENT_ORIGINS: 'http://localhost:4173',
    DEV: true,
    PROD: false,
    MODE: 'test',
    SSR: false,
    BASE_URL: '/',
    ...overrides,
  } as ImportMetaEnv
}

describe('readRuntimeConfig', () => {
  it('accepts an absolute API base URL', () => {
    const result = readRuntimeConfig(env())
    expect(result).toEqual({
      ok: true,
      config: {
        apiBaseUrl: 'http://localhost:3000/api/v1',
        parentOrigins: ['http://localhost:4173'],
        isProduction: false,
      },
    })
  })

  it('accepts a same-origin path for self-hosted nginx proxy', () => {
    const result = readRuntimeConfig(
      env({
        VITE_OPENIMPORT_API_BASE_URL: '/api/v1',
        PROD: true,
      } as Partial<ImportMetaEnv>),
    )
    expect(result).toMatchObject({
      ok: true,
      config: {
        apiBaseUrl: '/api/v1',
      },
    })
  })

  it('rejects protocol-relative and empty API bases', () => {
    expect(
      readRuntimeConfig(env({ VITE_OPENIMPORT_API_BASE_URL: '//evil.example/api' })),
    ).toMatchObject({ ok: false, code: 'OPENIMPORT.INVALID_API_BASE_URL' })
    expect(
      readRuntimeConfig(env({ VITE_OPENIMPORT_API_BASE_URL: '' })),
    ).toMatchObject({ ok: false, code: 'OPENIMPORT.MISSING_API_BASE_URL' })
  })
})
