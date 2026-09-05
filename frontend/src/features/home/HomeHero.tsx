import { GitHubLink } from '../shared/GitHubLink.tsx'
import { getOpenImportRepositoryUrl } from '../../config/public-links.ts'
import { resolveLabCta } from './lab-cta.ts'

export function HomeHero() {
  const repositoryUrl = getOpenImportRepositoryUrl()
  const productionCta = resolveLabCta(false, repositoryUrl)

  return (
    <section className="oi-hero oi-hero-canvas" aria-labelledby="oi-hero-title">
      <div className="oi-hero-copy">
        <p className="oi-eyebrow">OPENIMPORT://DATA-PIPELINE</p>
        <h1 id="oi-hero-title">Transforme CSV em payloads confiáveis de API.</h1>
        <p className="oi-hero-lead">
          Bancada self-hosted para mapear colunas, normalizar valores e entregar
          um snapshot. Esta interface não acessa o banco do cliente.
        </p>
        <div className="oi-hero-actions">
          {import.meta.env.DEV ? (
            <a className="oi-primary" href="/dev">
              Abrir laboratório
            </a>
          ) : productionCta.kind === 'github' ? (
            <GitHubLink className="oi-primary">Ver no GitHub</GitHubLink>
          ) : (
            <a className="oi-primary" href="#pipeline">
              Como funciona
            </a>
          )}
          {import.meta.env.DEV ? (
            repositoryUrl ? (
              <GitHubLink className="oi-secondary">Ver no GitHub</GitHubLink>
            ) : (
              <a className="oi-secondary" href="#pipeline">
                Como funciona
              </a>
            )
          ) : productionCta.kind === 'github' ? (
            <a className="oi-secondary" href="#pipeline">
              Como funciona
            </a>
          ) : null}
        </div>
        {import.meta.env.DEV ? (
          <p className="oi-hero-lab-note">
            O laboratório em <span className="oi-mono">/dev</span> usa sessão e
            token configurados localmente. Nada disso entra no bundle de
            produção.
          </p>
        ) : null}
      </div>

      <div
        className="oi-map-canvas"
        id="canvas"
        aria-label="Composição CSV para mapping e JSON"
      >
        <div className="oi-map-lane oi-map-lane-source">
          <p className="oi-map-lane-title">CSV</p>
          <pre className="oi-map-snippet" tabIndex={0}>
            <code>{`SKU;Estoque;Preço
ABC-1;7;R$ 299,90
ABC-2;3;abc`}</code>
          </pre>
        </div>
        <div className="oi-map-mid" aria-hidden="true">
          <span className="oi-map-wire" />
          <span className="oi-map-chip">#0 → sku</span>
          <span className="oi-map-chip">#2 → priceInCents</span>
          <span className="oi-map-wire" />
        </div>
        <div className="oi-map-lane oi-map-lane-target">
          <p className="oi-map-lane-title">JSON</p>
          <pre className="oi-map-snippet" tabIndex={0}>
            <code>{`{
  "sku": "ABC-1",
  "stock": 7,
  "priceInCents": 29990
}`}</code>
          </pre>
        </div>
        <p className="oi-money-transform" aria-label="R$ 299,90 vira 29990">
          <span className="oi-mono">R$ 299,90</span>
          <span aria-hidden="true"> → </span>
          <span className="oi-mono">29990</span>
        </p>
      </div>
    </section>
  )
}
