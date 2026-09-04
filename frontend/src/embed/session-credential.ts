let boundImportId: string | null = null
let accessToken: string | null = null

export function replaceSessionCredential(importId: string, token: string) {
  if (boundImportId && boundImportId !== importId) {
    throw new Error('Cannot replace session credential for a different importId')
  }

  boundImportId = importId
  accessToken = token
}

export function readSessionCredential(importId: string): string | null {
  if (boundImportId !== importId) {
    return null
  }

  return accessToken
}

export function clearSessionCredential() {
  boundImportId = null
  accessToken = null
}
