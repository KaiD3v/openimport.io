import type { ImportContext } from '../../api/import-context.schema.ts'
import { sessionStatusLabel } from './copy.ts'

type SessionStripProps = {
  context: ImportContext
}

export function SessionStrip({ context }: SessionStripProps) {
  return (
    <aside className="oi-session-strip" aria-label="Resumo da sessão">
      <div>
        <span className="oi-session-k">Template</span>
        <span className="oi-session-v">{context.template.name}</span>
      </div>
      <div>
        <span className="oi-session-k">Status</span>
        <span className="oi-session-v">
          {sessionStatusLabel(context.import.status)}
        </span>
      </div>
      <div>
        <span className="oi-session-k">Arquivo</span>
        <span className="oi-session-v oi-session-file">
          {context.import.originalFilename ?? 'Arquivo ainda não enviado'}
        </span>
      </div>
      <div>
        <span className="oi-session-k">Linhas</span>
        <span className="oi-session-v">
          {context.import.dataRowCount === null
            ? '—'
            : context.import.dataRowCount}
        </span>
      </div>
      <div>
        <span className="oi-session-k">Revisão</span>
        <span className="oi-session-v">{context.mapping.revision}</span>
      </div>
      <div>
        <span className="oi-session-k">Mapping</span>
        <span className="oi-session-v">
          {context.mapping.isComplete
            ? 'Mapping completo'
            : 'Mapping incompleto'}
        </span>
      </div>
      {context.import.status !== 'upload_failed' ? (
        <div className="oi-session-fields" aria-label="Campos do template">
          {context.template.fields.map((field) => {
            const mapped = context.mapping.mappings.some(
              (pair) => pair.fieldKey === field.key,
            )
            return (
              <span
                key={field.key}
                className={
                  mapped ? 'oi-legend-chip oi-legend-chip-used' : 'oi-legend-chip'
                }
              >
                {field.label}
              </span>
            )
          })}
        </div>
      ) : null}
    </aside>
  )
}
