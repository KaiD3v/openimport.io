import type { ImportContext } from '../../api/import-context.schema.ts'

export type FlowStepId = 'upload' | 'map' | 'review'
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
]

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
      ],
    }
  }

  const current: FlowStepId =
    context.import.status === 'created'
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

function stepIndex(id: FlowStepId) {
  return FLOW_STEPS.findIndex((step) => step.id === id)
}
