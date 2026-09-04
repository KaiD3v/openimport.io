import { useEffect, useMemo, useRef, useState } from 'react'
import { assertImportAccessToken } from '../embed/import-token.ts'
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
    <div className="oi-lab" data-testid="openimport-dev-harness">
      <header className="oi-lab-header">
        <div>
          <p className="oi-lab-badge">DEV</p>
          <h1>OpenImport Lab</h1>
          <p className="oi-lab-lead">
            Console interno de QA. Credenciais ficam só nesta aba e nunca vão
            para a URL do iframe.
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
      </header>

      <div className="oi-lab-layout">
        <aside className="oi-lab-side">
          <form
            className="oi-lab-panel"
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

          <section className="oi-lab-panel" aria-labelledby="oi-lab-fixtures-title">
            <h2 id="oi-lab-fixtures-title">Fixtures</h2>
            {FIXTURE_GROUPS.map((group) => (
              <div key={group.title} className="oi-lab-fixture-group">
                <h3>{group.title}</h3>
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
              </div>
            ))}
          </section>
        </aside>

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
                  Carregue um iframe com importId válido ou selecione uma
                  fixture sintética à esquerda.
                </p>
              </div>
            )}
          </div>
        </section>

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
    </div>
  )
}
