import { z } from 'zod'

export type AppRoute =
  | { kind: 'home' }
  | { kind: 'docs' }
  | { kind: 'import'; importId: string }
  | { kind: 'invalid-import' }
  | { kind: 'not-found' }

export function parseAppRoute(pathname: string): AppRoute {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  const parts = normalized.split('/').filter(Boolean)

  if (parts.length === 0) {
    return { kind: 'home' }
  }

  if (parts.length === 1 && parts[0] === 'docs') {
    return { kind: 'docs' }
  }

  if (parts[0] === 'imports') {
    if (parts.length === 2 && z.uuid().safeParse(parts[1]).success) {
      return { kind: 'import', importId: parts[1]! }
    }
    if (parts.length === 2) {
      return { kind: 'invalid-import' }
    }
    return { kind: 'not-found' }
  }

  return { kind: 'not-found' }
}
