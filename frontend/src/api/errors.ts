export class OpenImportApiError extends Error {
  readonly status: number
  readonly code: string
  readonly traceId?: string

  constructor(input: {
    status: number
    code: string
    message: string
    traceId?: string
  }) {
    super(input.message)
    this.name = 'OpenImportApiError'
    this.status = input.status
    this.code = input.code
    this.traceId = input.traceId
  }
}

export function isOpenImportApiError(
  error: unknown,
): error is OpenImportApiError {
  return error instanceof OpenImportApiError
}
