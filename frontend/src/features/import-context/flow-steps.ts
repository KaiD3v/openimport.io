import type { ImportContext } from '../../api/import-context.schema.ts'

export type FlowStepId = 'upload' | 'map' | 'review' | 'process'
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
  { id: 'upload', label: 'Enviar arquivo' },
  { id: 'map', label: 'Mapear' },
  { id: 'review', label: 'Revisar' },
  { id: 'process', label: 'Processar' },
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
      steps: [
        { id: 'upload', label: 'Enviar arquivo', state: 'failed' },
        { id: 'map', label: 'Mapear', state: 'upcoming' },
        { id: 'review', label: 'Revisar', state: 'upcoming' },
        { id: 'process', label: 'Processar', state: 'upcoming' },
      ],
    }
  }

  if (context.import.status === 'processing_failed') {
    return {
      kind: 'interrupted',
      navLabel: 'Falha no processamento — sessão interrompida',
      steps: [
        { id: 'upload', label: 'Enviar arquivo', state: 'done' },
        { id: 'map', label: 'Mapear', state: 'done' },
        { id: 'review', label: 'Revisar', state: 'done' },
        { id: 'process', label: 'Processar', state: 'failed' },
      ],
    }
  }

  const current: FlowStepId = PROCESSING_STATUSES.has(context.import.status)
    ? 'process'
    : context.import.status === 'created'
      ? 'upload'
      : context.mapping.isComplete
        ? 'review'
        : 'map'

  const currentIndex = stepIndex(current)
  const readyDone = context.import.status === 'ready'

  return {
    kind: 'active',
    navLabel: `Etapa atual: ${FLOW_STEPS[currentIndex]?.label ?? current}`,
    steps: FLOW_STEPS.map((step, index) => {
      if (readyDone && step.id === 'process') {
        return { id: step.id, label: step.label, state: 'done' }
      }
      return {
        id: step.id,
        label: step.label,
        state:
          index === currentIndex
            ? 'current'
            : index < currentIndex
              ? 'done'
              : 'upcoming',
      }
    }),
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
