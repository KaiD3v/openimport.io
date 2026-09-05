import { useEffect, useMemo, useRef, useState } from 'react'
import { assertImportAccessToken } from '../embed/import-token.ts'
import { SiteChrome } from '../features/shared/SiteChrome.tsx'
import { parseImportIdFromPath } from '../routing/parse-import-path.ts'
import { FixtureStage } from './FixtureStage.tsx'
import {
  VISUAL_FIXTURES,
  type VisualFixtureId,
} from './visual-fixtures.ts'

const FIXTURE_GROUPS: Array<{
  title: string
  ids: VisualFixtureId[]
}> = [
  {
    title: 'Shell',
    ids: ['waiting', 'loading', 'token-expired'],
  },
  {
    title: 'Upload',
    ids: [
      'created',
      'upload-selected',
      'upload-pending',
      'upload-recoverable-error',
      'upload-failed',
    ],
  },
  {
    title: 'Mapping',
    ids: [
      'uploaded-incomplete',
      'uploaded-complete',
      'mapping-dirty',
      'mapping-conflict',
      'long-labels',
    ],
  },
  {
    title: 'Preview',
    ids: [
      'preview-loading',
      'preview-valid',
      'preview-invalid',
      'preview-truncated',
      'preview-unavailable',
    ],
  },
  {
    title: 'Confirmação e processamento',
    ids: [
      'confirmation-ready',
      'queued',
      'processing-determined',
      'processing-indeterminate',
      'ready-no-rejects',
      'ready-with-rejects',
      'ready-rejects-expired',
      'processing-failed',
      'polling-error',
      'polling-session-expired',
    ],
  },
]

export function DevHarness() {
  const [importId, setImportId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [iframePath, setIframePath] = useState<string | null>(null)
  const [iframeReady, setIframeReady] = useState(false)
  const [events, setEvents] = useState<
    Array<{ seq: number; at: string; text: string }>
  >([])
  const [previewId, setPreviewId] = useState<VisualFixtureId | null>(() => {
    const params = new URLSearchParams(window.location.search)
    const fixture = params.get('fixture')
    return VISUAL_FIXTURES.some((entry) => entry.id === fixture)
      ? (fixture as VisualFixtureId)
      : null
  })
  const [viewportHint, setViewportHint] = useState('auto')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const seqRef = useRef(0)

  const parsedId = useMemo(
    () => parseImportIdFromPath(`/imports/${importId}`),
    [importId],
  )
  const tokenCheck = useMemo(
    () => assertImportAccessToken(accessToken),
    [accessToken],
  )

  const previewFixture = VISUAL_FIXTURES.find((fixture) => fixture.id === previewId)
  const soloPreview = Boolean(
    previewFixture &&
      new URLSearchParams(window.location.search).get('fixture') ===
        previewFixture.id,
  )

  const canLoadFrame = parsedId.ok
  const canInitialize =
    Boolean(iframePath) &&
    iframeReady &&
    parsedId.ok &&
    tokenCheck.ok

  function pushEvent(text: string) {
    seqRef.current += 1
    const at = new Date().toISOString().slice(11, 19)
    setEvents((current) => [
      ...current,
      { seq: seqRef.current, at, text },
    ])
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) {
        return
      }
      if (!event.data || typeof event.data !== 'object') {
        return
      }

      const payload = event.data as {
        type?: unknown
        code?: unknown
      }
      if (typeof payload.type !== 'string') {
        return
      }

      const code = typeof payload.code === 'string' ? ` ${payload.code}` : ''
      pushEvent(`${payload.type}${code}`)
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [])

  function loadFrame() {
    if (!parsedId.ok) {
      return
    }
    setPreviewId(null)
    setIframeReady(false)
    setIframePath(`/imports/${parsedId.importId}`)
  }

  function initialize() {
    const frame = iframeRef.current?.contentWindow
    if (!frame || !parsedId.ok || !tokenCheck.ok || !canInitialize) {
      return
    }

    frame.postMessage(
      {
        type: 'openimport.initialize',
        version: 1,
        importId: parsedId.importId,
        accessToken,
      },
      window.location.origin,
    )
    pushEvent('host → openimport.initialize')
  }

  if (soloPreview && previewFixture) {
    return <FixtureStage fixture={previewFixture} solo />
  }

  return (
    <SiteChrome variant="lab">
      <main
        id="conteudo-principal"
        className="oi-lab-body"
        tabIndex={-1}
        data-testid="openimport-dev-harness"
      >
      <section className="oi-lab-header" aria-labelledby="oi-lab-title">
        <div>
          <p className="oi-lab-badge">DEV</p>
          <h1 id="oi-lab-title">Laboratório OpenImport</h1>
          <p className="oi-lab-lead">
            Console interno de QA para inicializar o iframe com token local.
            Credenciais ficam só nesta aba e nunca vão para a URL do iframe,
            storage ou o log.
          </p>
        </div>
        <dl className="oi-lab-status">
          <div>
            <dt>Frontend</dt>
            <dd>{window.location.origin}</dd>
          </div>
          <div>
            <dt>Backend</dt>
            <dd>http://localhost:3000</dd>
          </div>
          <div>
            <dt>Modo</dt>
            <dd>{previewId ? `fixture:${previewId}` : iframePath ? 'iframe' : 'idle'}</dd>
          </div>
        </dl>
      </section>

      <div className="oi-lab-layout">
        <form
          className="oi-lab-panel oi-lab-creds"
          onSubmit={(event) => {
            event.preventDefault()
            loadFrame()
          }}
        >
            <h2>Credenciais</h2>
            <label className="oi-lab-field">
              <span>importId</span>
              <input
                aria-label="importId"
                value={importId}
                onChange={(event) => setImportId(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={importId.length > 0 && !parsedId.ok}
              />
              {importId.length > 0 ? (
                <span
                  className={
                    parsedId.ok ? 'oi-lab-hint oi-lab-hint-ok' : 'oi-lab-hint oi-lab-hint-fail'
                  }
                >
                  {parsedId.ok ? 'UUID válido' : 'UUID inválido'}
                </span>
              ) : (
                <span className="oi-lab-hint">Informe o UUID da sessão</span>
              )}
            </label>

            <label className="oi-lab-field">
              <span>token temporário</span>
              <div className="oi-lab-token-row">
                <input
                  id="oi-lab-token"
                  aria-label="token temporário"
                  type={tokenVisible ? 'text' : 'password'}
                  value={accessToken}
                  onChange={(event) => setAccessToken(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={accessToken.length > 0 && !tokenCheck.ok}
                />
                <button
                  type="button"
                  className="oi-secondary"
                  aria-pressed={tokenVisible}
                  aria-controls="oi-lab-token"
                  onClick={() => setTokenVisible((value) => !value)}
                >
                  {tokenVisible ? 'Ocultar token' : 'Mostrar token'}
                </button>
              </div>
              {accessToken.length > 0 ? (
                <span
                  className={
                    tokenCheck.ok
                      ? 'oi-lab-hint oi-lab-hint-ok'
                      : 'oi-lab-hint oi-lab-hint-fail'
                  }
                >
                  {tokenCheck.ok ? 'oi_import_ aceito' : 'Token inválido ou oi_live_'}
                </span>
              ) : (
                <span className="oi-lab-hint">Somente oi_import_</span>
              )}
            </label>

            <div className="oi-lab-actions">
              <button type="submit" className="oi-primary" disabled={!canLoadFrame}>
                Carregar iframe
              </button>
              <button
                type="button"
                className="oi-secondary"
                disabled={!canInitialize}
                onClick={initialize}
              >
                Inicializar sessão
              </button>
            </div>
          </form>

        <div className="oi-lab-panel oi-lab-quick">
          <h2 id="oi-lab-quick-title">Fixture rápida</h2>
          <p className="oi-lab-hint">Selecionar por label</p>
          <select
            aria-label="Seletor rápido de fixture"
            value={previewId ?? ''}
            onChange={(event) => {
              const next = event.target.value
              setIframePath(null)
              setIframeReady(false)
              setPreviewId(next ? (next as VisualFixtureId) : null)
            }}
          >
            <option value="">Canvas vazio</option>
            {FIXTURE_GROUPS.map((group) => (
              <optgroup key={group.title} label={group.title}>
                {group.ids.map((id) => {
                  const fixture = VISUAL_FIXTURES.find((entry) => entry.id === id)
                  if (!fixture) return null
                  return (
                    <option key={fixture.id} value={fixture.id}>
                      {fixture.label}
                    </option>
                  )
                })}
              </optgroup>
            ))}
          </select>
        </div>

        <section className="oi-lab-main" aria-label="Canvas de QA">
          <div className="oi-lab-canvas-bar">
            <p>
              {previewFixture
                ? `Fixture · ${previewFixture.id}`
                : iframePath
                  ? `Iframe · ${iframePath}`
                  : 'Canvas vazio'}
            </p>
            <label className="oi-lab-viewport">
              Viewport
              <select
                value={viewportHint}
                onChange={(event) => setViewportHint(event.target.value)}
              >
                <option value="auto">auto</option>
                <option value="360">360</option>
                <option value="768">768</option>
                <option value="1440">1440</option>
              </select>
            </label>
          </div>

          <div
            className={
              viewportHint === 'auto'
                ? 'oi-lab-canvas'
                : `oi-lab-canvas oi-lab-canvas-${viewportHint}`
            }
          >
            {previewFixture ? (
              <FixtureStage fixture={previewFixture} />
            ) : iframePath ? (
              <iframe
                ref={iframeRef}
                className="oi-harness-frame"
                title="OpenImport"
                src={iframePath}
                onLoad={() => {
                  setIframeReady(true)
                  pushEvent(`iframe ${iframePath}`)
                }}
              />
            ) : (
              <div className="oi-lab-empty">
                <p className="oi-state-code">LAB.EMPTY</p>
                <h2>Nenhuma sessão no canvas</h2>
                <p>
                  Carregue um iframe com importId válido ou escolha uma fixture
                  no seletor rápido.
                </p>
              </div>
            )}
          </div>
        </section>

        <aside
          className="oi-lab-advanced"
          aria-labelledby="oi-lab-fixtures-title"
          data-testid="openimport-lab-fixtures-advanced"
        >
          <h2 id="oi-lab-fixtures-title">Fixtures avançadas</h2>
          {FIXTURE_GROUPS.map((group) => (
            <details key={group.title} className="oi-lab-fixture-group">
              <summary>{group.title}</summary>
              <div className="oi-lab-fixture-list">
                {group.ids.map((id) => {
                  const fixture = VISUAL_FIXTURES.find((entry) => entry.id === id)
                  if (!fixture) return null
                  const selected = previewId === fixture.id
                  return (
                    <button
                      key={fixture.id}
                      type="button"
                      className={
                        selected
                          ? 'oi-lab-fixture oi-lab-fixture-selected'
                          : 'oi-lab-fixture'
                      }
                      aria-pressed={selected}
                      onClick={() => {
                        setIframePath(null)
                        setIframeReady(false)
                        setPreviewId(fixture.id)
                      }}
                    >
                      {fixture.label}
                    </button>
                  )
                })}
              </div>
            </details>
          ))}
        </aside>

        <aside className="oi-lab-log-panel" aria-label="Event log">
          <h2>Event log</h2>
          <ol
            className="oi-lab-log"
            data-testid="openimport-harness-log"
            aria-live="polite"
          >
            {events.length === 0 ? (
              <li className="oi-lab-log-empty">Sem eventos ainda.</li>
            ) : (
              events.map((entry) => (
                <li key={`${entry.seq}-${entry.text}`}>
                  <span className="oi-mono">
                    #{entry.seq} {entry.at}
                  </span>{' '}
                  {entry.text}
                </li>
              ))
            )}
          </ol>
        </aside>
      </div>
      </main>
    </SiteChrome>
  )
}
