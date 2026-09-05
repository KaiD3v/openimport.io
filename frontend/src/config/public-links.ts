export const KAIDEV_URL = 'https://kaidev.com.br/'

export const EXTERNAL_LINK_REL = 'noopener noreferrer' as const

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Public repository URL used in header/footer. Comes only from
 * VITE_OPENIMPORT_REPOSITORY_URL — never invent a GitHub fallback.
 */
export function readRepositoryUrl(raw?: string | null): string | null {
  const value = raw?.trim() ?? ''
  if (!value) {
    return null
  }

  try {
    const url = new URL(value)
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

export function getOpenImportRepositoryUrl(): string | null {
  return readRepositoryUrl(import.meta.env.VITE_OPENIMPORT_REPOSITORY_URL)
}

export function repositoryConfigHint(
  url: string | null,
  isDev: boolean,
): string | null {
  if (!isDev || url) {
    return null
  }
  return '[openimport] VITE_OPENIMPORT_REPOSITORY_URL is not set; repository links are hidden.'
}
