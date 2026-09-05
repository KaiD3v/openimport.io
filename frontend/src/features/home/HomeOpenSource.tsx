import { GitHubLink } from '../shared/GitHubLink.tsx'
import { getOpenImportRepositoryUrl } from '../../config/public-links.ts'

/** Production embed path for host systems — not the DEV /dev lab. */
export const PRODUCTION_EMBED_PATH = '/imports/:importId'

export function HomeOpenSource() {
  const repositoryUrl = getOpenImportRepositoryUrl()

  return (
    <section
      className="oi-section oi-home-band oi-home-band-panel"
      id="integracao"
      aria-labelledby="oi-int-title"
    >
      <h2 id="oi-int-title">Open source e self-hosted</h2>
      <p>
        Licença Apache-2.0. Hospede a API e o iframe no seu ambiente. O
        navegador recebe somente o token temporário{' '}
        <span className="oi-mono">oi_import_</span>, em memória.
      </p>
      {repositoryUrl ? (
        <p>
          <GitHubLink>Ver o repositório no GitHub</GitHubLink>
        </p>
      ) : null}
      <p>
        Em sistemas externos reais, o host abre a bancada nesta rota e envia{' '}
        <code>openimport.initialize</code> por <code>postMessage</code>:
      </p>
      <p className="oi-home-embed-cta">
        <a
          className="oi-primary oi-mono"
          href="/docs#passo-4-iframe"
          aria-label={`Rota de produção para sistemas externos: ${PRODUCTION_EMBED_PATH}`}
        >
          {PRODUCTION_EMBED_PATH}
        </a>
      </p>
      <p>
        <a className="oi-secondary" href="/docs">
          Ler documentação de integração
        </a>
      </p>
    </section>
  )
}
