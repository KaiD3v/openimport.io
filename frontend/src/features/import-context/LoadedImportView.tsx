import { useCallback, useState } from 'react'
import type { ImportContext } from '../../api/import-context.schema.ts'
import type { ImportPreview } from '../../api/operation-schemas.ts'
import {
  currentFlowStep,
  isProcessingStatus,
  resolveFlowPresentation,
} from './flow-steps.ts'
import { ConfirmPanel } from './ConfirmPanel.tsx'
import { FlowSteps } from './FlowSteps.tsx'
import { MappingEditor } from './MappingEditor.tsx'
import { PreviewPanel } from './PreviewPanel.tsx'
import { ProcessingPanel } from './ProcessingPanel.tsx'
import { SessionStrip } from './SessionStrip.tsx'
import { UploadFailedNotice } from './UploadFailedNotice.tsx'
import { UploadPanel } from './UploadPanel.tsx'

type LoadedImportViewProps = {
  context: ImportContext
  apiBaseUrl: string
  generation: number
  pollError?: string | null
  onRetryPoll?: () => void
  initialPreview?: ImportPreview | null
}

export function LoadedImportView({
  context,
  apiBaseUrl,
  generation,
  pollError = null,
  onRetryPoll,
  initialPreview = null,
}: LoadedImportViewProps) {
  const [mappingDirty, setMappingDirty] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(initialPreview)
  const [expandMapping, setExpandMapping] = useState(false)
  const [expandUpload, setExpandUpload] = useState(false)
  const [confirming, setConfirming] = useState(false)

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
  const processing = isProcessingStatus(context.import.status)
  const activeStep =
    mappingDirty && context.import.status === 'uploaded'
      ? 'map'
      : currentFlowStep(context)

  // Confirm lock is irrelevant once the session leaves the uploaded stage.
  const confirmInFlight = confirming && !processing

  return (
    <div className="oi-import-layout">
      <h1 className="oi-sr-only">Bancada de importação</h1>
      <FlowSteps context={context} />
      <UploadFailedNotice context={context} />
      <SessionStrip context={context} />

      {processing ? (
        <ProcessingPanel
          context={context}
          apiBaseUrl={apiBaseUrl}
          generation={generation}
          pollError={pollError}
          onRetryPoll={onRetryPoll ?? (() => undefined)}
        />
      ) : null}

      {!interrupted && !processing ? (
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

          {activeStep === 'review' ||
          (mappingDirty &&
            context.import.status === 'uploaded' &&
            context.mapping.isComplete) ? (
            <>
              <PreviewPanel
                context={context}
                apiBaseUrl={apiBaseUrl}
                mappingDirty={mappingDirty}
                preview={preview}
                onPreview={setPreview}
              />
              <ConfirmPanel
                context={context}
                apiBaseUrl={apiBaseUrl}
                generation={generation}
                mappingDirty={mappingDirty}
                preview={preview}
                confirming={confirmInFlight}
                onConfirmingChange={setConfirming}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
