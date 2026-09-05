import { SiteChrome } from '../shared/SiteChrome.tsx'
import { StatePanel } from '../shared/StatePanel.tsx'

export function NotFoundPage() {
  return (
    <SiteChrome>
      <main id="conteudo-principal" className="oi-state-page" tabIndex={-1}>
        <StatePanel
          code="ROUTE.NOT_FOUND"
          tone="warn"
          title="Página não encontrada"
          body="Este endereço não corresponde à homepage nem a uma sessão de importação."
          nextAction="Volte à página inicial ou abra /imports/:importId a partir do sistema de origem."
          detail="Rotas válidas: / · /docs · /imports/:uuid"
          action={{ label: 'Ir para a página inicial', href: '/' }}
        />
      </main>
    </SiteChrome>
  )
}
