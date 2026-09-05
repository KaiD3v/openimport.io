import { useEffect, useId, useRef, useState } from 'react'
import { GitHubLink } from './GitHubLink.tsx'

type SiteNavMenuProps = {
  showLabCta?: boolean
}

const COMPACT_QUERY = '(max-width: 767px)'

function readCompactViewport() {
  if (typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(COMPACT_QUERY).matches
}

/**
 * Public site nav as a header tray on small screens (in-flow panel),
 * inline links on desktop. Protocol "ÍNDICE" toggle — not a floating dropdown.
 */
export function SiteNavMenu({ showLabCta = false }: SiteNavMenuProps) {
  const [open, setOpen] = useState(false)
  const [compact, setCompact] = useState(readCompactViewport)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const firstLinkRef = useRef<HTMLAnchorElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return
    }
    const media = window.matchMedia(COMPACT_QUERY)
    function sync() {
      setCompact(media.matches)
      if (!media.matches) {
        setOpen(false)
      }
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!open || !compact) {
      return
    }

    firstLinkRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, compact])

  function close() {
    setOpen(false)
  }

  const trayOpen = compact && open

  return (
    <>
      <div className="oi-site-actions">
        {showLabCta ? (
          <a
            className="oi-lab-cta"
            href="/dev"
            aria-label="Abrir laboratório"
          >
            <span className="oi-lab-cta-full">Abrir laboratório</span>
            <span className="oi-lab-cta-short">Lab</span>
          </a>
        ) : null}
        <button
          ref={toggleRef}
          type="button"
          className="oi-site-nav-toggle"
          aria-expanded={trayOpen}
          aria-controls={panelId}
          aria-label={trayOpen ? 'Fechar índice do site' : 'Abrir índice do site'}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="oi-site-nav-toggle-legend" aria-hidden="true">
            ÍNDICE
          </span>
          <span className="oi-site-nav-toggle-caret" aria-hidden="true">
            {trayOpen ? '▴' : '▾'}
          </span>
        </button>
      </div>

      <nav
        id={panelId}
        className={['oi-site-nav', trayOpen ? 'is-open' : '']
          .filter(Boolean)
          .join(' ')}
        aria-label="Principal"
        aria-hidden={compact && !open ? true : undefined}
        onClick={(event) => {
          if (event.target instanceof HTMLAnchorElement) {
            close()
          }
        }}
      >
        <a ref={firstLinkRef} href="/#pipeline">
          Como funciona
        </a>
        <a href="/docs">Documentação</a>
        <GitHubLink />
      </nav>
    </>
  )
}
