import { useEffect } from 'react'
import { scrollToHashTarget } from './scroll-to-hash.ts'

/**
 * After DocsPage paints, jump to window.location.hash if present.
 * Also listens for in-page hash changes (TOC).
 */
export function useScrollToHash() {
  useEffect(() => {
    let cancelled = false

    function run() {
      if (cancelled) return
      scrollToHashTarget(window.location.hash)
    }

    // Browser may have already failed to find #id before React commit.
    const timeoutId = window.setTimeout(run, 0)
    const frameId = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run)
    })

    window.addEventListener('hashchange', run)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('hashchange', run)
    }
  }, [])
}
