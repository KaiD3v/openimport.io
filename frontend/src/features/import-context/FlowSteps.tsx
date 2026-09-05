import { useEffect, useRef } from 'react'
import { resolveFlowPresentation } from './flow-steps.ts'
import type { ImportContext } from '../../api/import-context.schema.ts'

type FlowStepsProps = {
  context: ImportContext
}

function stateStamp(state: string) {
  if (state === 'current') return 'Atual'
  if (state === 'done') return 'Concluído'
  if (state === 'failed') return 'Recusado'
  return 'Pendente'
}

export function FlowSteps({ context }: FlowStepsProps) {
  const presentation = resolveFlowPresentation(context)
  const moreRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return
    }
    const mq = window.matchMedia('(min-width: 641px)')
    function sync() {
      if (moreRef.current && mq.matches) {
        moreRef.current.open = true
      }
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  const currentIndex = Math.max(
    0,
    presentation.steps.findIndex(
      (step) => step.state === 'current' || step.state === 'failed',
    ),
  )
  const current = presentation.steps[currentIndex] ?? presentation.steps[0]
  const total = presentation.steps.length
  const number = currentIndex + 1
  const progress = Math.round((number / total) * 100)

  const stepList = (
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
          <span className="oi-step-stamp">{stateStamp(step.state)}</span>
        </li>
      ))}
    </ol>
  )

  return (
    <nav className="oi-steps-nav" aria-label={presentation.navLabel}>
      <div className="oi-steps-compact">
        <p className="oi-steps-compact-meta">
          <span>Etapa {number} de {total}</span>
          <span className="oi-steps-compact-name">{current.label}</span>
        </p>
        <div
          className="oi-steps-meter"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={number}
          aria-label={`Etapa ${number} de ${total}`}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
      <details className="oi-steps-more" ref={moreRef}>
        <summary>Ver todas as etapas</summary>
        {stepList}
      </details>
    </nav>
  )
}
