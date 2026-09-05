import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const [labPending, setLabPending] = useState(false)
  const [labError, setLabError] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const seqRef = useRef(0)
  const autoInitRef = useRef(false)

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

  const pushEvent = useCallback((text: string) => {
    seqRef.current += 1
    const at = new Date().toISOString().slice(11, 19)
    setEvents((current) => [
      ...current,
      { seq: seqRef.current, at, text },
    ])
  }, [])

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
  }, [pushEvent])

  function loadFrame() {
    if (!parsedId.ok) {
      return
    }
    setPreviewId(null)
    setIframeReady(false)
    setIframePath(`/imports/${parsedId.importId}`)
  }

  const initialize = useCallback(() => {
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
  }, [accessToken, canInitialize, parsedId, pushEvent, tokenCheck])

  useEffect(() => {
    if (!autoInitRef.current || !canInitialize) {
      return
    }
    autoInitRef.current = false
    initialize()
  }, [canInitialize, initialize])

  async function createLabSessionFromHarness() {
    setLabError(null)
    setLabPending(true)
    try {
      const response = await fetch('/__openimport/lab-session', {
        method: 'POST',
      })
      const payload: unknown = await response.json().catch(() => null)
      const messageFromBody =
        payload &&
        typeof payload === 'object' &&
        'message' in payload &&
        typeof payload.message === 'string'
          ? payload.message
          : null
      if (!response.ok) {
        throw new Error(
          messageFromBody ??
            'Não foi possível criar a sessão de laboratório.',
        )
      }
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('importId' in payload) ||
        !('accessToken' in payload) ||
        typeof payload.importId !== 'string' ||
        typeof payload.accessToken !== 'string'
      ) {
        throw new Error('Não foi possível criar a sessão de laboratório.')
      }

      const parsed = parseImportIdFromPath(`/imports/${payload.importId}`)
      const token = assertImportAccessToken(payload.accessToken)
      if (!parsed.ok || !token.ok) {
        throw new Error('Não foi possível criar a sessão de laboratório.')
      }

      setPreviewId(null)
      setImportId(parsed.importId)
      setAccessToken(payload.accessToken)
      setIframeReady(false)
      autoInitRef.current = true
      setIframePath(`/imports/${parsed.importId}`)
      pushEvent('lab-session criada')
    } catch (error) {
      autoInitRef.current = false
      const fallback = 'Não foi possível criar a sessão de laboratório.'
      setLabError(
        error instanceof TypeError
          ? fallback
          : error instanceof Error
            ? error.message
            : fallback,
      )
    } finally {
      setLabPending(false)
    }
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
        <div className="oi-lab-header-row">
          <p className="oi-lab-badge">DEV</p>
          <h1 id="oi-lab-title">Laboratório OpenImport</h1>
          <p className="oi-lab-mode">
            {previewId ? `fixture:${previewId}` : iframePath ? 'iframe' : 'idle'}
          </p>
        </div>
        <details className="oi-lab-env">
          <summary>Ambiente</summary>
          <div className="oi-lab-env-body">
            <p className="oi-lab-lead">
              Credenciais ficam só nesta aba — nunca na URL, storage ou log.
              A chave de organização não passa pelo navegador.
            </p>
            <dl className="oi-lab-status">
              <div>
                <dt>Frontend</dt>
                <dd title={window.location.origin}>{window.location.origin}</dd>
              </div>
              <div>
                <dt>Backend</dt>
                <dd title="http://localhost:3000">http://localhost:3000</dd>
              </div>
              <div>
                <dt>Modo</dt>
                <dd>
                  {previewId
                    ? `fixture:${previewId}`
                    : iframePath
                      ? 'iframe'
                      : 'idle'}
                </dd>
              </div>
            </dl>
          </div>
        </details>
      </section>

      <div className="oi-lab-layout">
        <div className="oi-lab-actions-bar">
          <button
            type="button"
            className="oi-primary"
            disabled={labPending}
            aria-label="Criar sessão de laboratório"
            onClick={() => {
              void createLabSessionFromHarness()
            }}
          >
            Criar sessão
          </button>
          {labPending ? (
            <span className="oi-lab-hint">A criar sessão…</span>
          ) : labError ? (
            <span className="oi-lab-hint oi-lab-hint-fail">{labError}</span>
          ) : (
            <span className="oi-lab-hint">
              Cada clique persiste template e sessão no Postgres local.
            </span>
          )}
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
                  Crie uma sessão para ver o importador neste canvas.
                </p>
              </div>
            )}
          </div>
        </section>

        <form
          className="oi-lab-creds"
          onSubmit={(event) => {
            event.preventDefault()
            loadFrame()
          }}
        >
          <details className="oi-lab-fold">
            <summary>Colar credenciais</summary>
            <div className="oi-lab-fold-body">
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
                      parsedId.ok
                        ? 'oi-lab-hint oi-lab-hint-ok'
                        : 'oi-lab-hint oi-lab-hint-fail'
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
                    {tokenCheck.ok
                      ? 'oi_import_ aceito'
                      : 'Token inválido ou oi_live_'}
                  </span>
                ) : (
                  <span className="oi-lab-hint">Somente oi_import_</span>
                )}
              </label>

              <div className="oi-lab-actions">
                <button
                  type="submit"
                  className="oi-secondary"
                  disabled={!canLoadFrame}
                >
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
            </div>
          </details>
        </form>

        <aside
          className="oi-lab-advanced"
          aria-labelledby="oi-lab-fixtures-title"
          data-testid="openimport-lab-fixtures-advanced"
        >
          <h2 id="oi-lab-fixtures-title">Fixtures</h2>
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
