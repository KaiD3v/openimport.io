import { sessionStatusLabel } from './copy.ts'
import type { ImportContext } from '../../api/import-context.schema.ts'

type ContextSummaryProps = {
  context: ImportContext
}

export function ContextSummary({ context }: ContextSummaryProps) {
  const mappedByPosition = new Map(
    context.mapping.mappings.map((pair) => [pair.columnPosition, pair.fieldKey]),
  )

  return (
    <div className="oi-board">
      <section className="oi-ledger" aria-labelledby="oi-session-heading">
        <h2 id="oi-session-heading">Sessão</h2>
        <dl className="oi-facts">
          <div>
            <dt>Template</dt>
            <dd>{context.template.name}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{sessionStatusLabel(context.import.status)}</dd>
          </div>
          <div>
            <dt>Arquivo</dt>
            <dd>
              {context.import.originalFilename ?? 'Arquivo ainda não enviado'}
            </dd>
          </div>
          <div>
            <dt>Linhas de dados</dt>
            <dd>
              {context.import.dataRowCount === null
                ? '—'
                : context.import.dataRowCount}
            </dd>
          </div>
          <div>
            <dt>Revisão do mapping</dt>
            <dd>{context.mapping.revision}</dd>
          </div>
          <div>
            <dt>Completude</dt>
            <dd>
              {context.mapping.isComplete
                ? 'Mapping completo'
                : 'Mapping incompleto'}
            </dd>
          </div>
        </dl>

        {context.mapping.missingRequiredFields.length > 0 &&
        context.import.status !== 'upload_failed' ? (
          <p className="oi-note">
            Campos obrigatórios ainda sem coluna:{' '}
            {context.mapping.missingRequiredFields.join(', ')}
          </p>
        ) : null}

        {context.import.status !== 'upload_failed' ? (
        <div
          className="oi-cells"
          aria-label="Campos do template e associação"
        >
          {context.template.fields.map((field) => {
            const mapped = context.mapping.mappings.some(
              (pair) => pair.fieldKey === field.key,
            )
            return (
              <span
                key={field.key}
                className={mapped ? 'oi-cell oi-cell-filled' : 'oi-cell'}
              >
                {field.label}
              </span>
            )
          })}
        </div>
        ) : null}
      </section>

      <section className="oi-columns" aria-labelledby="oi-columns-heading">
        <h2 id="oi-columns-heading">Colunas detectadas</h2>
        {context.import.columns.length === 0 ? (
          <p className="oi-empty">
            {context.import.status === 'upload_failed'
              ? 'Nenhuma coluna disponível. O arquivo não pôde ser processado nesta sessão.'
              : 'Nenhuma coluna ainda. O envio do CSV virá na próxima etapa.'}
          </p>
        ) : (
          <table>
            <caption className="oi-sr-only">
              Colunas do arquivo e destino no template
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Origem</th>
                <th scope="col">Destino</th>
              </tr>
            </thead>
            <tbody>
              {context.import.columns.map((column) => (
                <tr key={column.position}>
                  <td>{column.position}</td>
                  <td>{column.name}</td>
                  <td>{mappedByPosition.get(column.position) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
