import { describe, expect, it } from 'vitest'
import { OpenImportApiError } from '../../api/errors.ts'
import { isTerminalCredentialError } from './terminal-credential-error.ts'

describe('isTerminalCredentialError', () => {
  it('treats 401 and auth codes as terminal', () => {
    expect(
      isTerminalCredentialError(
        new OpenImportApiError({
          status: 401,
          code: 'AUTH.INVALID_IMPORT_TOKEN',
          message: 'expired',
        }),
      ),
    ).toBe(true)
    expect(
      isTerminalCredentialError(
        new OpenImportApiError({
          status: 401,
          code: 'AUTH.MISSING_BEARER',
          message: 'missing',
        }),
      ),
    ).toBe(true)
  })

  it('does not treat recoverable network or 503 as terminal', () => {
    expect(
      isTerminalCredentialError(
        new OpenImportApiError({
          status: 0,
          code: 'OPENIMPORT.NETWORK',
          message: 'offline',
        }),
      ),
    ).toBe(false)
    expect(
      isTerminalCredentialError(
        new OpenImportApiError({
          status: 503,
          code: 'IMPORT.PROCESSING_UNAVAILABLE',
          message: 'busy',
        }),
      ),
    ).toBe(false)
  })
})
