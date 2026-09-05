import type { ImportContext } from '../../api/import-context.schema.ts'

export type FlowStepId = 'upload' | 'map' | 'review' | 'process' | 'result'
export type FlowStepState = 'done' | 'current' | 'upcoming' | 'failed'
export type FlowPresentationKind = 'active' | 'interrupted'

export type FlowStepPresentation = {
  id: FlowStepId
  label: string
  state: FlowStepState
}

export type FlowPresentation = {
  kind: FlowPresentationKind
  navLabel: string
  steps: FlowStepPresentation[]
}

export const FLOW_STEPS: Array<{ id: FlowStepId; label: string }> = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Mapear' },
  { id: 'review', label: 'Revisar' },
  { id: 'process', label: 'Processar' },
  { id: 'result', label: 'Resultado' },
]

const PROCESSING_STATUSES = new Set([
  'queued',
  'processing',
  'ready',
  'processing_failed',
])

export function resolveFlowPresentation(
  context: ImportContext,
): FlowPresentation {
  if (context.import.status === 'upload_failed') {
    return {
      kind: 'interrupted',
      navLabel: 'Falha no envio — sessão interrompida',
      steps: FLOW_STEPS.map((step) => ({
        id: step.id,
        label: step.label,
        state: step.id === 'upload' ? 'failed' : 'upcoming',
      })),
    }
  }

  if (context.import.status === 'processing_failed') {
    return {
      kind: 'interrupted',
      navLabel: 'Falha no processamento — sessão interrompida',
      steps: FLOW_STEPS.map((step) => ({
        id: step.id,
        label: step.label,
        state:
          step.id === 'process'
            ? 'failed'
            : step.id === 'result'
              ? 'upcoming'
              : 'done',
      })),
    }
  }

  const current: FlowStepId = PROCESSING_STATUSES.has(context.import.status)
    ? context.import.status === 'ready'
      ? 'result'
      : 'process'
    : context.import.status === 'created'
      ? 'upload'
      : context.mapping.isComplete
        ? 'review'
        : 'map'

  const currentIndex = stepIndex(current)

  return {
    kind: 'active',
    navLabel: `Etapa atual: ${FLOW_STEPS[currentIndex]?.label ?? current}`,
    steps: FLOW_STEPS.map((step, index) => ({
      id: step.id,
      label: step.label,
      state:
        index === currentIndex
          ? 'current'
          : index < currentIndex
            ? 'done'
            : 'upcoming',
    })),
  }
}

/** @deprecated Prefer resolveFlowPresentation for explicit step states. */
export function currentFlowStep(context: ImportContext): FlowStepId {
  const presentation = resolveFlowPresentation(context)
  const current = presentation.steps.find((step) => step.state === 'current')
  return current?.id ?? 'upload'
}

export function isProcessingStatus(
  status: ImportContext['import']['status'],
): boolean {
  return (
    status === 'queued' ||
    status === 'processing' ||
    status === 'ready' ||
    status === 'processing_failed'
  )
}

export function isPollingStatus(
  status: ImportContext['import']['status'],
): boolean {
  return status === 'queued' || status === 'processing'
}

function stepIndex(id: FlowStepId) {
  return FLOW_STEPS.findIndex((step) => step.id === id)
}
