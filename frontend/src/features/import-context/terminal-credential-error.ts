import { isOpenImportApiError } from '../../api/errors.ts'

/** Auth failures that must stop polling and show a terminal session UI. */
export function isTerminalCredentialError(error: unknown): boolean {
  if (!isOpenImportApiError(error)) {
    return false
  }

  return (
    error.status === 401 ||
    error.code === 'AUTH.INVALID_IMPORT_TOKEN' ||
    error.code === 'AUTH.MISSING_BEARER'
  )
}
