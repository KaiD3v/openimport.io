import { resolveFlowPresentation } from './flow-steps.ts'
import type { ImportContext } from '../../api/import-context.schema.ts'

type FlowStepsProps = {
  context: ImportContext
}

export function FlowSteps({ context }: FlowStepsProps) {
  const presentation = resolveFlowPresentation(context)

  return (
    <nav aria-label={presentation.navLabel}>
      <ol className="oi-steps" role="list">
        {presentation.steps.map((step, index) => (
          <li
            key={step.id}
            className={`oi-step oi-step-${step.state}`}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span className="oi-step-index" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="oi-step-label">{step.label}</span>
            {step.state === 'failed' ? (
              <span className="oi-step-stamp">Recusado</span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  )
}
