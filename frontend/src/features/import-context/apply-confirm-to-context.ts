import type { ImportContext } from '../../api/import-context.schema.ts'
import type { ConfirmImportResponse } from '../../api/operation-schemas.ts'

/** Patch only fields present on the confirm 202 response. */
export function applyConfirmToContext(
  context: ImportContext,
  confirm: ConfirmImportResponse,
): ImportContext {
  return {
    ...context,
    import: {
      ...context.import,
      status: confirm.status,
      executionId: confirm.executionId,
      progress: confirm.progress,
      failure: confirm.failure,
    },
  }
}
