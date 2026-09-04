import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { ImportPreview } from '../api/operation-schemas.ts'
import { LoadedImportView } from '../features/import-context/LoadedImportView.tsx'
import { StatePanel } from '../features/shared/StatePanel.tsx'
import type { VisualFixture } from './visual-fixtures.ts'

const HARNESS_API = 'http://localhost:3000/api/v1'

function ShellPanel({
  variant,
  title,
  body,
  code,
}: {
  variant: 'status' | 'error'
  title: string
  body: string
  code?: string
}) {
  return (
    <StatePanel
      code={code ?? (variant === 'error' ? 'STATE.ERROR' : 'STATE.WAIT')}
      tone={variant === 'error' ? 'fail' : 'wait'}
      title={title}
      body={body}
      nextAction={
        variant === 'error'
          ? 'Reabra a sessão pelo sistema de origem.'
          : 'Aguarde a inicialização do host.'
      }
    />
  )
}

function PreviewResult({ preview }: { preview: ImportPreview }) {
  return (
    <div className="oi-preview-result" data-testid="fixture-preview-result">
      <section
        className="oi-preview-summary"
        aria-labelledby="oi-fixture-summary-title"
      >
        <h3 id="oi-fixture-summary-title">Resumo</h3>
        <dl className="oi-stat-grid">
          <div>
            <dt>Total</dt>
            <dd>{preview.summary.totalRows}</dd>
          </div>
          <div>
            <dt>Válidos</dt>
            <dd className="oi-stat-ok">{preview.summary.validRows}</dd>
          </div>
          <div>
            <dt>Inválidos</dt>
            <dd className="oi-stat-fail">{preview.summary.invalidRows}</dd>
          </div>
          <div>
            <dt>Perfil</dt>
            <dd>{preview.normalizationProfile}</dd>
          </div>
          <div>
            <dt>Revisão</dt>
            <dd>{preview.mappingRevision}</dd>
          </div>
        </dl>
      </section>
      {preview.sampleTruncated ? (
        <p className="oi-note" role="status">
          As estatísticas cobrem o arquivo inteiro. A amostra abaixo pode ter
          sido reduzida pelo limite de resposta.
        </p>
      ) : null}
      <section
        className="oi-preview-sample"
        aria-labelledby="oi-fixture-sample-title"
      >
        <h3 id="oi-fixture-sample-title">Amostra</h3>
        <div className="oi-preview-table-wrap" data-preview-layout="table">
          <table className="oi-preview-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Status</th>
                <th scope="col">Erros</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr
                  key={row.recordNumber}
                  className={row.valid ? undefined : 'oi-row-invalid'}
                >
                  <td>{row.recordNumber}</td>
                  <td>{row.valid ? 'Válido' : 'Inválido'}</td>
                  <td>
                    {row.errors.length === 0
                      ? '—'
                      : row.errors
                          .map(
                            (error) =>
                              `${error.fieldKey}: ${error.code} — ${error.message}`,
                          )
                          .join('; ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="oi-preview-cards" data-preview-layout="cards">
          {preview.rows.map((row) => (
            <article
              key={row.recordNumber}
              className={
                row.valid
                  ? 'oi-record-card'
                  : 'oi-record-card oi-record-card-invalid'
              }
            >
              <header className="oi-record-head">
                <span className="oi-mono">#{row.recordNumber}</span>
                <span
                  className={
                    row.valid ? 'oi-badge oi-badge-ok' : 'oi-badge oi-badge-fail'
                  }
                >
                  <span aria-hidden="true">{row.valid ? '✓' : '!'}</span>{' '}
                  {row.valid ? 'Válido' : 'Inválido'}
                </span>
              </header>
              {row.data ? (
                <dl className="oi-record-fields">
                  {Object.entries(row.data).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="oi-note">Dados normalizados indisponíveis.</p>
              )}
              {row.errors.length > 0 ? (
                <ul className="oi-error-list">
                  {row.errors.map((error) => (
                    <li key={`${error.fieldKey}-${error.code}`}>
                      <span className="oi-mono">{error.fieldKey}</span>
                      <span className="oi-error-code">{error.code}</span>
                      <span>{error.message}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      </section>
      <p className="oi-preview-end" role="status">
        Preview concluído. A confirmação e o processamento definitivo ainda não
        estão disponíveis nesta versão.
      </p>
    </div>
  )
}

function PresentationOverlays({
  presentation,
}: {
  presentation: NonNullable<Extract<VisualFixture, { kind: 'loaded' }>['presentation']>
}) {
  return (
    <div className="oi-fixture-overlays" data-testid="fixture-overlays">
      {presentation.uploadSelected ? (
        <section className="oi-workbench" aria-label="Seleção de arquivo">
          <div className="oi-file-card">
            <p className="oi-file-card-label">Arquivo selecionado</p>
            <p>
              <strong className="oi-file-name">
                {presentation.uploadSelected.name}
              </strong>
            </p>
            <p className="oi-file-size">
              {presentation.uploadSelected.sizeLabel}
            </p>
            <div className="oi-inline-actions">
              <button
                type="button"
                className="oi-secondary"
                disabled={presentation.uploadPending}
              >
                Remover seleção
              </button>
              <button
                type="button"
                className="oi-primary"
                disabled={presentation.uploadPending}
              >
                Enviar arquivo
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {presentation.uploadPending ? (
        <p className="oi-pending-row" role="status" aria-label="Enviando arquivo">
          Enviando arquivo…
          <button type="button" className="oi-secondary">
            Cancelar envio
          </button>
        </p>
      ) : null}

      {presentation.uploadError ? (
        <div className="oi-inline-error" role="alert">
          <p>{presentation.uploadError}</p>
          <p className="oi-support">IMPORT.FILE_TOO_LARGE · req_fixture</p>
        </div>
      ) : null}

      {presentation.mappingDirtyNote ? (
        <p className="oi-note" role="status">
          Alterações locais ainda não salvas. Há alterações locais no mapping.
          Salve antes de gerar o preview.
        </p>
      ) : null}

      {presentation.mappingConflict ? (
        <div className="oi-conflict" role="alert">
          <p>
            <strong>Conflito de revisão.</strong> {presentation.mappingConflict}
          </p>
          <p className="oi-conflict-meta">
            Revisão local: 1 · Revisão atual no servidor: 4
          </p>
          <div className="oi-inline-actions">
            <button type="button" className="oi-secondary">
              Descartar alterações locais
            </button>
            <button type="button" className="oi-primary">
              Reaplicar associações locais
            </button>
          </div>
        </div>
      ) : null}

      {presentation.previewLoading ? (
        <p role="status" aria-label="Gerando preview">
          Gerando preview…
        </p>
      ) : null}

      {presentation.previewUnavailable ? (
        <div className="oi-inline-error" role="alert">
          <p>
            <strong>Preview temporariamente indisponível.</strong> O
            armazenamento ou o stream não respondeu. Tente novamente em
            instantes.
          </p>
          <p className="oi-support">IMPORT.PREVIEW_UNAVAILABLE · req_fixture</p>
          <button type="button" className="oi-secondary">
            Tentar novamente
          </button>
        </div>
      ) : null}

      {presentation.preview ? (
        <PreviewResult preview={presentation.preview} />
      ) : null}
    </div>
  )
}

export function FixtureStage({
  fixture,
  solo = false,
}: {
  fixture: VisualFixture
  solo?: boolean
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      }),
  )

  const importId =
    fixture.kind === 'shell'
      ? (fixture.importId ?? null)
      : fixture.context.import.id

  return (
    <QueryClientProvider client={client}>
      <div
        className={
          solo ? 'oi-visual-stage oi-visual-stage-solo' : 'oi-visual-stage'
        }
        data-testid="openimport-visual-fixture"
        data-fixture-id={fixture.id}
      >
        <div className="oi-app">
          <header className="oi-top" role="banner">
            <p className="oi-mark">OpenImport</p>
            <p className="oi-tag">CSV → schema → JSON</p>
            {importId ? (
              <p className="oi-id">
                <span>Sessão</span> {importId}
              </p>
            ) : null}
          </header>
          <main className="oi-main">
            {fixture.kind === 'shell' ? (
              <ShellPanel
                variant={fixture.variant}
                title={fixture.title}
                body={fixture.body}
                code={fixture.code}
              />
            ) : (
              <>
                <LoadedImportView
                  context={fixture.context}
                  apiBaseUrl={HARNESS_API}
                  generation={1}
                />
                {fixture.presentation ? (
                  <PresentationOverlays presentation={fixture.presentation} />
                ) : null}
              </>
            )}
          </main>
        </div>
      </div>
    </QueryClientProvider>
  )
}

export function FixtureProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
