import { GitHubLink } from '../shared/GitHubLink.tsx'
import { getOpenImportRepositoryUrl } from '../../config/public-links.ts'

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
      <p>Abra <code>/imports/:importId</code> e envie do parent:</p>
      <pre className="oi-code" tabIndex={0}>
        <code>{`{
  "type": "openimport.initialize",
  "version": 1,
  "importId": "<uuid>",
  "accessToken": "oi_import_<64 hex>"
}`}</code>
      </pre>
      <p>
        Respostas: <code>openimport.ready</code>,{' '}
        <code>openimport.loaded</code>, <code>openimport.error</code>. Origem
        explícita — nunca <code>*</code>.
      </p>
    </section>
  )
}
