import { useCallback, useState } from 'react'
import type { ImportContext } from '../../api/import-context.schema.ts'
import type { ImportPreview } from '../../api/operation-schemas.ts'
import { currentFlowStep, resolveFlowPresentation } from './flow-steps.ts'
import { FlowSteps } from './FlowSteps.tsx'
import { MappingEditor } from './MappingEditor.tsx'
import { PreviewPanel } from './PreviewPanel.tsx'
import { SessionStrip } from './SessionStrip.tsx'
import { UploadFailedNotice } from './UploadFailedNotice.tsx'
import { UploadPanel } from './UploadPanel.tsx'

type LoadedImportViewProps = {
  context: ImportContext
  apiBaseUrl: string
  generation: number
}

export function LoadedImportView({
  context,
  apiBaseUrl,
  generation,
}: LoadedImportViewProps) {
  const [mappingDirty, setMappingDirty] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [expandMapping, setExpandMapping] = useState(false)
  const [expandUpload, setExpandUpload] = useState(false)

  const handleDraftChange = useCallback((dirty: boolean) => {
    setMappingDirty(dirty)
    if (dirty) {
      setPreview(null)
    }
  }, [])

  const handleMappingSaved = useCallback(() => {
    setPreview(null)
    setExpandMapping(false)
  }, [])

  const presentation = resolveFlowPresentation(context)
  const interrupted = presentation.kind === 'interrupted'
  const activeStep =
    mappingDirty && context.import.status === 'uploaded'
      ? 'map'
      : currentFlowStep(context)

  return (
    <div className="oi-import-layout">
      <FlowSteps context={context} />
      <UploadFailedNotice context={context} />
      <SessionStrip context={context} />

      {!interrupted ? (
        <div className="oi-stage-stack">
          {context.import.status === 'uploaded' && activeStep !== 'upload' ? (
            <details
              className="oi-stage-summary"
              open={expandUpload}
              onToggle={(event) =>
                setExpandUpload((event.target as HTMLDetailsElement).open)
              }
            >
              <summary>
                Upload concluído — {context.import.originalFilename} ·{' '}
                {context.import.dataRowCount ?? 0} linhas ·{' '}
                {context.import.columns.length} colunas
              </summary>
              <ul className="oi-column-chips">
                {context.import.columns.map((column) => (
                  <li key={column.position}>
                    <span className="oi-mono">#{column.position}</span>{' '}
                    {column.name}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {activeStep === 'upload' ? (
            <UploadPanel
              context={context}
              apiBaseUrl={apiBaseUrl}
              generation={generation}
            />
          ) : null}

          {context.mapping.isComplete &&
          activeStep === 'review' &&
          !expandMapping ? (
            <details className="oi-stage-summary">
              <summary>
                Mapping completo — revisão {context.mapping.revision} ·{' '}
                {context.mapping.mappings.length} associações
              </summary>
              <button
                type="button"
                className="oi-secondary"
                onClick={() => setExpandMapping(true)}
              >
                Revisar associações
              </button>
            </details>
          ) : null}

          {(activeStep === 'map' || expandMapping) &&
          context.import.status === 'uploaded' ? (
            <MappingEditor
              context={context}
              apiBaseUrl={apiBaseUrl}
              generation={generation}
              onDraftChange={handleDraftChange}
              onSaved={handleMappingSaved}
            />
          ) : null}

          {activeStep === 'review' ? (
            <PreviewPanel
              context={context}
              apiBaseUrl={apiBaseUrl}
              mappingDirty={mappingDirty}
              preview={preview}
              onPreview={setPreview}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
