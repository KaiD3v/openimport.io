/**
 * Validates FRONTEND_FRAME_ANCESTORS for CSP embedding.
 * Allowed: 'self', 'none' (alone), and absolute http(s) origins (no path/query/fragment).
 * Rejected: *, wildcards, scheme-only sources, ';', CR/LF.
 */

/**
 * @param {string} raw
 * @returns {{ ok: true, tokens: string[] } | { ok: false, reason: string }}
 */
export function validateFrameAncestors(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: 'empty' }
  }
  if (/[\r\n;]/.test(raw)) {
    return { ok: false, reason: 'forbidden_chars' }
  }
  if (raw.includes('*')) {
    return { ok: false, reason: 'wildcard' }
  }

  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return { ok: false, reason: 'empty' }
  }

  for (const token of tokens) {
    if (token === "'self'") {
      continue
    }
    if (token === "'none'") {
      if (tokens.length !== 1) {
        return { ok: false, reason: 'none_must_be_alone' }
      }
      continue
    }
    if (
      token === 'https:' ||
      token === 'http:' ||
      token === 'data:' ||
      token === 'blob:'
    ) {
      return { ok: false, reason: 'broad_scheme' }
    }
    let url
    try {
      url = new URL(token)
    } catch {
      return { ok: false, reason: 'malformed' }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, reason: 'scheme' }
    }
    if (token !== url.origin) {
      return { ok: false, reason: 'not_origin' }
    }
  }

  return { ok: true, tokens }
}
