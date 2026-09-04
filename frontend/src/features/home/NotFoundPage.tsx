import { StatePanel } from '../shared/StatePanel.tsx'

export function NotFoundPage() {
  return (
    <div className="oi-site oi-site-compact">
      <header className="oi-site-header">
        <a className="oi-site-brand" href="/">
          <span className="oi-brand-mark" aria-hidden="true" />
          OpenImport
        </a>
      </header>
      <main className="oi-state-page">
        <StatePanel
          code="ROUTE.NOT_FOUND"
          tone="warn"
          title="Página não encontrada"
          body="Este endereço não corresponde à homepage nem a uma sessão de importação."
          nextAction="Volte à página inicial ou abra /imports/:importId a partir do sistema de origem."
          detail="Rotas válidas: / · /imports/:uuid"
          action={{ label: 'Ir para a página inicial', href: '/' }}
        />
      </main>
    </div>
  )
}
