import { useEffect, type ReactNode } from 'react'
import {
  EXTERNAL_LINK_REL,
  KAIDEV_URL,
  getOpenImportRepositoryUrl,
  repositoryConfigHint,
} from '../../config/public-links.ts'
import { GitHubLink } from './GitHubLink.tsx'
import { compactSessionId } from './session-id.ts'
import { SiteNavMenu } from './SiteNavMenu.tsx'

type SiteChromeProps = {
  children: ReactNode
  variant?: 'site' | 'workbench' | 'lab'
  importId?: string | null
  statusLabel?: string
}

const CONTEXT_LABEL = {
  site: 'site',
  lab: 'laboratório',
  workbench: 'importador',
} as const

export function SkipLink() {
  return (
    <a className="oi-skip-link" href="#conteudo-principal">
      Ir para o conteúdo principal
    </a>
  )
}

function BrandMark() {
  return (
    <svg
      className="oi-brand-mark"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.5" y="3" width="7" height="3.2" fill="currentColor" opacity="0.9" />
      <rect x="1.5" y="8.4" width="7" height="3.2" fill="currentColor" opacity="0.55" />
      <rect x="1.5" y="13.8" width="7" height="3.2" fill="currentColor" opacity="0.35" />
      <path
        d="M10.2 10.4h3.1l.9-2.2 1.4 7.2 1.1-3.6H18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M18.6 6.2h3.7v11.6h-3.7M18.6 6.2c.8 1.4.8 10.2 0 11.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  )
}

export function SiteHeader({
  variant = 'site',
  importId = null,
  statusLabel,
}: {
  variant?: SiteChromeProps['variant']
  importId?: string | null
  statusLabel?: string
}) {
  const context = CONTEXT_LABEL[variant]
  const compactId = importId ? compactSessionId(importId) : null

  return (
    <header
      className="oi-chrome-header"
      role="banner"
      data-chrome-context={variant}
    >
      <div className="oi-chrome-header-inner">
        <a className="oi-site-brand" href="/">
          <BrandMark />
          OpenImport
        </a>

        <p className="oi-chrome-context">{context}</p>

        {variant === 'workbench' ? (
          <div className="oi-chrome-workbench">
            <p className="oi-tag">{statusLabel ?? 'CSV → mapping → JSON'}</p>
            {importId && compactId ? (
              <p className="oi-id">
                <span>Sessão</span>
                <span className="oi-id-value" title={importId}>
                  {compactId}
                </span>
              </p>
            ) : null}
          </div>
        ) : variant === 'lab' ? null : (
          <SiteNavMenu showLabCta={import.meta.env.DEV} />
        )}
      </div>
    </header>
  )
}

export function SiteFooter({
  variant = 'site',
}: {
  variant?: SiteChromeProps['variant']
}) {
  if (variant === 'lab') {
    return (
      <footer className="oi-site-footer oi-site-footer-lab" role="contentinfo">
        <p className="oi-footer-protocol">OPENIMPORT://LAB</p>
      </footer>
    )
  }

  return (
    <footer className="oi-site-footer" role="contentinfo">
      <div className="oi-chrome-footer-inner">
        <p className="oi-footer-protocol">OPENIMPORT://SELF-HOSTED</p>
        <div className="oi-footer-links">
          <p className="oi-footer-license">Apache-2.0</p>
          <p>
            <a
              href={KAIDEV_URL}
              target="_blank"
              rel={EXTERNAL_LINK_REL}
            >
              Desenvolvido por KaiD3v
              <span className="oi-sr-only"> (abre em nova aba)</span>
            </a>
          </p>
          {getOpenImportRepositoryUrl() ? (
            <p>
              <GitHubLink>GitHub</GitHubLink>
            </p>
          ) : null}
        </div>
      </div>
    </footer>
  )
}

export function SiteChrome({
  children,
  variant = 'site',
  importId = null,
  statusLabel,
}: SiteChromeProps) {
  useEffect(() => {
    const hint = repositoryConfigHint(
      getOpenImportRepositoryUrl(),
      import.meta.env.DEV,
    )
    if (hint) {
      console.info(hint)
    }
  }, [])

  return (
    <div
      className={
        variant === 'lab'
          ? 'oi-lab'
          : variant === 'workbench'
            ? 'oi-app'
            : 'oi-site'
      }
    >
      <SkipLink />
      <SiteHeader
        variant={variant}
        importId={importId}
        statusLabel={statusLabel}
      />
      {children}
      <SiteFooter variant={variant} />
    </div>
  )
}
