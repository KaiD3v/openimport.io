import { z } from 'zod'

export type ParseImportPathResult =
  | { ok: true; importId: string }
  | { ok: false; reason: 'missing' | 'invalid' }

export function parseImportIdFromPath(pathname: string): ParseImportPathResult {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  const parts = normalized.split('/').filter(Boolean)

  if (parts[0] !== 'imports') {
    return { ok: false, reason: 'missing' }
  }

  if (!parts[1]) {
    return { ok: false, reason: 'missing' }
  }

  if (parts.length !== 2 || !z.uuid().safeParse(parts[1]).success) {
    return { ok: false, reason: 'invalid' }
  }

  return { ok: true, importId: parts[1] }
}
