const IMPORT_ACCESS_TOKEN = /^oi_import_[0-9a-f]{64}$/
const LIVE_API_KEY = /^oi_live_/

export function isImportAccessToken(value: string): boolean {
  return IMPORT_ACCESS_TOKEN.test(value)
}

export function assertImportAccessToken(value: string):
  | { ok: true; accessToken: string }
  | { ok: false; code: 'OPENIMPORT.LIVE_API_KEY_REJECTED' | 'OPENIMPORT.INVALID_IMPORT_TOKEN' } {
  if (LIVE_API_KEY.test(value)) {
    return { ok: false, code: 'OPENIMPORT.LIVE_API_KEY_REJECTED' }
  }

  if (!IMPORT_ACCESS_TOKEN.test(value)) {
    return { ok: false, code: 'OPENIMPORT.INVALID_IMPORT_TOKEN' }
  }

  return { ok: true, accessToken: value }
}
