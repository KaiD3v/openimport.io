import { SiteChrome } from '../shared/SiteChrome.tsx'
import { StatePanel } from '../shared/StatePanel.tsx'

export function InvalidImportPage() {
  return (
    <SiteChrome>
      <main id="conteudo-principal" className="oi-state-page" tabIndex={-1}>
        <StatePanel
          code="IMPORT.INVALID_ID"
          tone="fail"
          title="Identificador inválido"
          body="O caminho /imports/:importId exige um UUID válido. Sem isso o canvas de importação não abre."
          nextAction="Corrija o identificador no sistema hospedeiro e recarregue o iframe."
          detail="Exemplo: /imports/11111111-1111-4111-8111-111111111111"
          action={{ label: 'Ir para a página inicial', href: '/' }}
        />
      </main>
    </SiteChrome>
  )
}
