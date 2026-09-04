import { OpenImportApiError } from './errors.ts'

export function shouldRetryFailedQuery(
  _failureCount: number,
  error: unknown,
): boolean {
  if (
    error instanceof OpenImportApiError &&
    [400, 401, 403, 404, 503].includes(error.status)
  ) {
    return false
  }

  return false
}
