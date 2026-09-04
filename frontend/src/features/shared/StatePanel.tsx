type StatePanelProps = {
  code: string
  title: string
  body: string
  nextAction?: string
  detail?: string
  tone?: 'neutral' | 'warn' | 'fail' | 'wait'
  action?: {
    label: string
    href?: string
    onClick?: () => void
  }
}

export function StatePanel({
  code,
  title,
  body,
  nextAction,
  detail,
  tone = 'neutral',
  action,
}: StatePanelProps) {
  return (
    <section
      className={`oi-state oi-state-${tone}`}
      role={tone === 'fail' || tone === 'warn' ? 'alert' : undefined}
      aria-labelledby="oi-state-title"
    >
      <div className="oi-state-rail" aria-hidden="true">
        <span className="oi-state-node">CSV</span>
        <span className="oi-state-break" />
        <span className="oi-state-node oi-state-node-active">map</span>
        <span className="oi-state-break" />
        <span className="oi-state-node">JSON</span>
      </div>
      <div className="oi-state-body">
        <p className="oi-state-code">{code}</p>
        <h1 id="oi-state-title">{title}</h1>
        <p role="status" aria-label={title} className="oi-state-copy">
          {body}
        </p>
        {nextAction ? (
          <p className="oi-state-next">
            <strong>Próxima ação.</strong> {nextAction}
          </p>
        ) : null}
        {detail ? <p className="oi-state-detail">{detail}</p> : null}
        {action?.href ? (
          <a className="oi-primary" href={action.href}>
            {action.label}
          </a>
        ) : null}
        {action?.onClick ? (
          <button type="button" className="oi-primary" onClick={action.onClick}>
            {action.label}
          </button>
        ) : null}
      </div>
    </section>
  )
}
