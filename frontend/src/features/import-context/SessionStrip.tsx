import { useEffect, useRef } from 'react'
import type { ImportContext } from '../../api/import-context.schema.ts'
import { sessionStatusLabel } from './copy.ts'

type SessionStripProps = {
  context: ImportContext
}

export function SessionStrip({ context }: SessionStripProps) {
  const filename = context.import.originalFilename ?? 'Arquivo ainda não enviado'
  const detailsRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return
    }
    const mq = window.matchMedia('(min-width: 641px)')
    function sync() {
      if (detailsRef.current && mq.matches) {
        detailsRef.current.open = true
      }
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return (
    <details className="oi-session-strip" ref={detailsRef}>
      <summary>
        Resumo da sessão
        <span className="oi-session-summary-meta">
          {context.template.name} · {filename}
        </span>
      </summary>
      <div className="oi-session-grid">
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
          <span className="oi-session-v oi-session-file">{filename}</span>
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
      </div>
    </details>
  )
}
