import type { ImportContext } from '../../api/import-context.schema.ts'
import { PROCESSING_FAILED_NOTICE } from './copy.ts'
import { progressPercent } from './processing-progress.ts'
import { RejectedRowsPanel } from './RejectedRowsPanel.tsx'

type ProcessingPanelProps = {
  context: ImportContext
  apiBaseUrl: string
  generation: number
  pollError: string | null
  onRetryPoll: () => void
}

export function ProcessingPanel({
  context,
  apiBaseUrl,
  generation,
  pollError,
  onRetryPoll,
}: ProcessingPanelProps) {
  const { status, progress, failure } = context.import
  const percent = progressPercent(progress)

  if (
    status !== 'queued' &&
    status !== 'processing' &&
    status !== 'ready' &&
    status !== 'processing_failed'
  ) {
    return null
  }

  if (status === 'processing_failed') {
    return (
      <section
        className="oi-workbench oi-interrupted"
        aria-labelledby="oi-process-failed-title"
        data-testid="processing-failed-panel"
      >
        <p className="oi-interrupted-stamp">{PROCESSING_FAILED_NOTICE.title}</p>
        <h2 id="oi-process-failed-title">{PROCESSING_FAILED_NOTICE.body}</h2>
        {failure ? (
          <div className="oi-inline-error" role="alert">
            <p>
              <strong>{failure.code}</strong>
            </p>
            <p>{failure.message}</p>
          </div>
        ) : null}
        <p className="oi-interrupted-next">{PROCESSING_FAILED_NOTICE.nextAction}</p>
      </section>
    )
  }

  if (status === 'ready' && progress) {
    return (
      <div className="oi-stage-stack" data-testid="ready-panel">
        <section
          className="oi-workbench oi-workbench-primary"
          aria-labelledby="oi-ready-title"
        >
          <div className="oi-workbench-head">
            <h2 id="oi-ready-title">Processamento concluído</h2>
            <p className="oi-workbench-lead">
              Snapshot pronto no OpenImport. Os registros válidos ficam
              disponíveis ao backend do sistema cliente — esta interface não os
              baixa.
            </p>
          </div>
          <dl className="oi-stat-grid">
            <div>
              <dt>Processados</dt>
              <dd>{progress.processedRows}</dd>
            </div>
            <div>
            <dt>Válidos</dt>
            <dd>
              <span className="oi-stat-ok">{progress.validRows}</span>
              <span className="oi-sr-only"> válidas</span>
            </dd>
          </div>
          <div>
            <dt>Inválidos</dt>
            <dd>
              <span className="oi-stat-fail">{progress.invalidRows}</span>
              <span className="oi-sr-only"> inválidas</span>
            </dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{progress.totalRows ?? '—'}</dd>
            </div>
          </dl>
        </section>
        <RejectedRowsPanel
          importId={context.import.id}
          apiBaseUrl={apiBaseUrl}
          generation={generation}
          enabled={progress.invalidRows > 0}
        />
        {progress.invalidRows === 0 ? (
          <p className="oi-note" role="status">
            Nenhuma linha rejeitada neste snapshot.
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <section
      className="oi-workbench oi-workbench-primary"
      aria-labelledby="oi-processing-title"
      data-testid="processing-panel"
    >
      <div className="oi-workbench-head">
        <h2 id="oi-processing-title">
          {status === 'queued' ? 'Na fila' : 'Processando'}
        </h2>
        <p className="oi-workbench-lead">
          Acompanhando o worker. O mapping e o arquivo já estão congelados.
        </p>
      </div>
      <p className="oi-sr-only" aria-live="polite">
        {status === 'queued' ? 'Importação na fila.' : 'Processamento em andamento.'}
      </p>

      {progress ? (
        <dl className="oi-stat-grid">
          <div>
            <dt>Processados</dt>
            <dd>{progress.processedRows}</dd>
          </div>
          <div>
            <dt>Válidos</dt>
            <dd>
              <span className="oi-stat-ok">{progress.validRows}</span>
              <span className="oi-sr-only"> válidas</span>
            </dd>
          </div>
          <div>
            <dt>Inválidos</dt>
            <dd>
              <span className="oi-stat-fail">{progress.invalidRows}</span>
              <span className="oi-sr-only"> inválidas</span>
            </dd>
          </div>
          <div>
            <dt>Progresso</dt>
            <dd>
              {percent === null ? (
                <span>Em andamento (total ainda indisponível)</span>
              ) : (
                <span>{percent}%</span>
              )}
            </dd>
          </div>
        </dl>
      ) : null}

      {percent !== null ? (
        <div
          className="oi-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Progresso do processamento"
        >
          <div className="oi-progress-fill" style={{ width: `${percent}%` }} />
        </div>
      ) : (
        <div
          className="oi-progress-track oi-progress-indeterminate"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-busy="true"
          aria-label="Processamento em andamento, total ainda indisponível"
        >
          <div className="oi-progress-fill" />
        </div>
      )}

      {pollError ? (
        <div className="oi-inline-error" role="alert">
          <p>{pollError}</p>
          <button type="button" className="oi-secondary" onClick={onRetryPoll}>
            Tentar atualizar
          </button>
        </div>
      ) : (
        <p className="oi-pending-row">Atualizando status…</p>
      )}
    </section>
  )
}
