import { describe, expect, it } from 'vitest'
import {
  ALLOWED_ORIGIN,
  IMPORT_ID,
  IMPORT_TOKEN,
  LIVE_API_KEY,
  OTHER_IMPORT_ID,
  initializeMessage,
} from '../test/fixtures.ts'
import { inspectInitializeEvent } from './initialize-message.ts'

const allowedOrigins = [ALLOWED_ORIGIN]

function inspect(
  data: unknown,
  overrides: {
    origin?: string
    source?: MessageEventSource | null
    expectedImportId?: string
    parent?: Window
  } = {},
) {
  return inspectInitializeEvent({
    data,
    origin: overrides.origin ?? ALLOWED_ORIGIN,
    source: overrides.source === undefined ? window : overrides.source,
    expectedImportId: overrides.expectedImportId ?? IMPORT_ID,
    allowedOrigins,
    parent: overrides.parent ?? window,
  })
}

describe('inspectInitializeEvent', () => {
  it('accepts a valid initialize message from the parent', () => {
    const result = inspect(initializeMessage())

    expect(result).toEqual({
      status: 'accepted',
      importId: IMPORT_ID,
      accessToken: IMPORT_TOKEN,
    })
  })

  it('ignores a message from a disallowed origin without accepting it', () => {
    const result = inspect(initializeMessage(), {
      origin: 'https://evil.example',
    })

    expect(result).toEqual({ status: 'ignored' })
  })

  it('ignores a message whose source is not the parent window', () => {
    const result = inspect(initializeMessage(), {
      source: null,
    })

    expect(result).toEqual({ status: 'ignored' })
  })

  it('rejects an unsupported protocol version', () => {
    const result = inspect(initializeMessage({ version: 2 }))

    expect(result).toMatchObject({
      status: 'rejected',
      code: 'OPENIMPORT.UNSUPPORTED_VERSION',
      importId: IMPORT_ID,
      notifyParent: true,
    })
  })

  it('rejects a malformed token', () => {
    const result = inspect(initializeMessage({ accessToken: 'oi_import_nope' }))

    expect(result).toMatchObject({
      status: 'rejected',
      code: 'OPENIMPORT.INVALID_IMPORT_TOKEN',
      notifyParent: true,
    })
  })

  it('rejects an organizational API key', () => {
    const result = inspect(initializeMessage({ accessToken: LIVE_API_KEY }))

    expect(result).toMatchObject({
      status: 'rejected',
      code: 'OPENIMPORT.LIVE_API_KEY_REJECTED',
      notifyParent: true,
    })
  })

  it('rejects an initialize payload whose importId differs from the URL', () => {
    const result = inspect(initializeMessage({ importId: OTHER_IMPORT_ID }))

    expect(result).toMatchObject({
      status: 'rejected',
      code: 'OPENIMPORT.IMPORT_ID_MISMATCH',
      importId: IMPORT_ID,
      notifyParent: true,
    })
  })

  it('ignores unknown message types', () => {
    const result = inspect({ type: 'openimport.ping', version: 1 })

    expect(result).toEqual({ status: 'ignored' })
  })

  it('does not read apiBaseUrl from the message payload', () => {
    const result = inspect(
      initializeMessage({
        apiBaseUrl: 'https://attacker.example/api/v1',
      }),
    )

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') return
    expect(result).not.toHaveProperty('apiBaseUrl')
  })
})
