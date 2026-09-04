import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { isOpenImportApiError, OpenImportApiError } from '../../api/errors.ts'
import type { ImportContext } from '../../api/import-context.schema.ts'
import type { ImportPreview } from '../../api/operation-schemas.ts'
import { postImportPreview } from '../../api/post-import-preview.ts'
import { readSessionCredential } from '../../embed/session-credential.ts'
import { abbreviateHash, copyForApiError } from './copy.ts'

type PreviewPanelProps = {
  context: ImportContext
  apiBaseUrl: string
  mappingDirty: boolean
  preview: ImportPreview | null
  onPreview: (preview: ImportPreview | null) => void
}

const PREVIEW_LIMIT = 20

export function PreviewPanel({
  context,
  apiBaseUrl,
  mappingDirty,
  preview,
  onPreview,
}: PreviewPanelProps) {
  const [errorCopy, setErrorCopy] = useState<ReturnType<
    typeof copyForApiError
  > | null>(null)

  const canRun =
    context.import.status === 'uploaded' &&
    context.mapping.isComplete &&
    !mappingDirty

  const mutation = useMutation({
    mutationFn: async () => {
      const accessToken = readSessionCredential(context.import.id)
      if (!accessToken) {
        throw new OpenImportApiError({
          status: 401,
          code: 'AUTH.INVALID_IMPORT_TOKEN',
          message: 'Token ausente.',
        })
      }

      return postImportPreview({
        apiBaseUrl,
        importId: context.import.id,
        accessToken,
        expectedMappingRevision: context.mapping.revision,
        limit: PREVIEW_LIMIT,
      })
    },
    retry: false,
    onSuccess: (data) => {
      setErrorCopy(null)
      onPreview(data)
    },
    onError: (error) => {
      onPreview(null)
      if (isOpenImportApiError(error)) {
        setErrorCopy(copyForApiError(error))
      }
    },
  })

  if (context.import.status !== 'uploaded') {
    return null
  }

  return (
    <section
      className="oi-workbench oi-workbench-primary"
      aria-labelledby="oi-preview-title"
    >
      <div className="oi-workbench-head">
        <h2 id="oi-preview-title">Revisar preview</h2>
        <p className="oi-workbench-lead">
          Dry run com normalização pt-BR-v1. Limite da amostra: {PREVIEW_LIMIT}{' '}
          registros.
        </p>
      </div>

      {!context.mapping.isComplete ? (
        <p className="oi-note">
          Salve um mapping completo para liberar o preview.
        </p>
      ) : null}

      {mappingDirty ? (
        <p className="oi-note" role="status">
          Há alterações locais no mapping. Salve antes de gerar o preview.
        </p>
      ) : null}

      <div className="oi-inline-actions">
        <button
          type="button"
          className="oi-primary"
          disabled={!canRun || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Gerando preview…' : 'Gerar preview'}
        </button>
        {errorCopy?.retry ? (
          <button
            type="button"
            className="oi-secondary"
            onClick={() => mutation.mutate()}
          >
            Tentar novamente
          </button>
        ) : null}
      </div>

      {mutation.isPending ? (
        <p role="status" aria-label="Gerando preview">
          Gerando preview…
        </p>
      ) : null}

      {errorCopy ? (
        <div className="oi-inline-error" role="alert">
          <p>
            <strong>{errorCopy.title}.</strong> {errorCopy.body}
          </p>
          <p className="oi-support">
            {[errorCopy.code, errorCopy.traceId].filter(Boolean).join(' · ')}
          </p>
        </div>
      ) : null}

      {preview ? <PreviewResult preview={preview} /> : null}
    </section>
  )
}

function PreviewResult({ preview }: { preview: ImportPreview }) {
  const fieldKeys = Array.from(
    new Set(
      preview.rows.flatMap((row) =>
        row.data
          ? Object.keys(row.data)
          : row.errors.map((error) => error.fieldKey),
      ),
    ),
  )

  return (
    <div className="oi-preview-result">
      <section className="oi-preview-summary" aria-labelledby="oi-preview-summary-title">
        <h3 id="oi-preview-summary-title">Resumo</h3>
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
          <div>
            <dt>Hash</dt>
            <dd className="oi-mono">{abbreviateHash(preview.contentSha256)}</dd>
          </div>
        </dl>
      </section>

      {preview.sampleTruncated ? (
        <p className="oi-note" role="status">
          As estatísticas cobrem o arquivo inteiro. A amostra abaixo pode ter
          sido reduzida pelo limite de resposta.
        </p>
      ) : null}

      <section className="oi-preview-sample" aria-labelledby="oi-preview-sample-title">
        <h3 id="oi-preview-sample-title">Amostra</h3>

        <div className="oi-preview-table-wrap" data-preview-layout="table">
          <table className="oi-preview-table">
            <caption className="oi-sr-only">Amostra do preview</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Status</th>
                {fieldKeys.map((key) => (
                  <th key={key} scope="col">
                    {key}
                  </th>
                ))}
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
                  <td>
                    <StatusBadge valid={row.valid} />
                  </td>
                  {fieldKeys.map((key) => (
                    <td key={key}>
                      {row.data && key in row.data
                        ? String(row.data[key])
                        : '—'}
                    </td>
                  ))}
                  <td>
                    {row.errors.length === 0 ? (
                      '—'
                    ) : (
                      <ul className="oi-error-list">
                        {row.errors.map((error) => (
                          <li key={`${error.fieldKey}-${error.code}`}>
                            <span className="oi-mono">{error.fieldKey}</span>
                            <span className="oi-error-code">{error.code}</span>
                            <span>{error.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
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
                <StatusBadge valid={row.valid} />
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

      {preview.rows.length === 0 ? (
        <p className="oi-empty">A amostra desta resposta está vazia.</p>
      ) : null}

      <p className="oi-preview-end" role="status">
        Preview concluído. A confirmação e o processamento definitivo ainda não
        estão disponíveis nesta versão.
      </p>
    </div>
  )
}

function StatusBadge({ valid }: { valid: boolean }) {
  return (
    <span className={valid ? 'oi-badge oi-badge-ok' : 'oi-badge oi-badge-fail'}>
      <span aria-hidden="true">{valid ? '✓' : '!'}</span> {valid ? 'Válido' : 'Inválido'}
    </span>
  )
}
