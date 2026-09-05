export function readHashId(hash: string): string | null {
  const id = hash.replace(/^#/, '').trim()
  return id.length > 0 ? id : null
}

/**
 * Scroll to the element matching location.hash.
 * Needed for SPA navigations: the browser tries before React mounts the target.
 */
export function scrollToHashTarget(
  hash: string,
  doc: Pick<Document, 'getElementById'> = document,
): boolean {
  const id = readHashId(hash)
  if (!id) {
    return false
  }

  const el = doc.getElementById(id)
  if (!el) {
    return false
  }

  el.scrollIntoView({ behavior: 'auto', block: 'start' })
  return true
}
