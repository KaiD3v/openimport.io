import { describe, expect, it } from 'vitest'
import { OpenImportApiError } from './errors.ts'
import { shouldRetryFailedQuery } from './query-retry.ts'

describe('shouldRetryFailedQuery', () => {
  it('does not retry 400, 401, 403 or 404', () => {
    for (const status of [400, 401, 403, 404]) {
      const error = new OpenImportApiError({
        status,
        code: 'TEST',
        message: 'no',
      })
      expect(shouldRetryFailedQuery(0, error)).toBe(false)
    }
  })

  it('does not automatically retry 503 or network failures', () => {
    expect(
      shouldRetryFailedQuery(
        0,
        new OpenImportApiError({
          status: 503,
          code: 'HEALTH.NOT_READY',
          message: 'down',
        }),
      ),
    ).toBe(false)

    expect(
      shouldRetryFailedQuery(
        0,
        new OpenImportApiError({
          status: 0,
          code: 'OPENIMPORT.NETWORK_FAILURE',
          message: 'offline',
        }),
      ),
    ).toBe(false)
  })
})
