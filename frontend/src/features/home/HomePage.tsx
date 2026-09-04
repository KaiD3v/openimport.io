export function HomePage() {
  return (
    <div className="oi-site">
      <header className="oi-site-header">
        <a className="oi-site-brand" href="/">
          <span className="oi-brand-mark" aria-hidden="true" />
          OpenImport
        </a>
        <nav className="oi-site-nav" aria-label="Seções">
          <a href="#canvas">Canvas</a>
          <a href="#capacidades">Capacidades</a>
          <a href="#integracao">Integração</a>
        </nav>
      </header>

      <main>
        <section className="oi-hero oi-hero-canvas" aria-labelledby="oi-hero-title">
          <div className="oi-hero-copy">
            <p className="oi-eyebrow">Mapping canvas · self-hosted</p>
            <h1 id="oi-hero-title">OpenImport</h1>
            <p className="oi-hero-lead">
              Embarque um fluxo CSV → schema → JSON normalizado no seu produto.
              Autenticação, regras e persistência continuam no host.
            </p>
            <div className="oi-hero-actions">
              <a className="oi-primary" href="#canvas">
                Ver a transformação
              </a>
              <a className="oi-secondary" href="#integracao">
                Integração embarcada
              </a>
            </div>
          </div>

          <div className="oi-map-canvas" id="canvas" aria-label="Transformação visual">
            <div className="oi-map-lane oi-map-lane-source">
              <p className="oi-map-lane-title">Origem</p>
              <pre className="oi-map-snippet">
                <code>{`SKU;Estoque;Preço
ABC-1;7;299,90
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
              <p className="oi-map-lane-title">Destino</p>
              <pre className="oi-map-snippet">
                <code>{`{
  "sku": "ABC-1",
  "stock": 7,
  "priceInCents": 29990
}`}</code>
              </pre>
            </div>
          </div>
        </section>

        <section
          className="oi-section oi-flow-strip"
          id="como-funciona"
          aria-labelledby="oi-flow-title"
        >
          <h2 id="oi-flow-title">Como o canvas opera</h2>
          <ol className="oi-flow-rail">
            <li>
              <span className="oi-flow-index">01</span>
              <div>
                <strong>Enviar</strong>
                <p>O host cria a sessão; o operador envia um CSV.</p>
              </div>
            </li>
            <li>
              <span className="oi-flow-index">02</span>
              <div>
                <strong>Mapear</strong>
                <p>Colunas ligam-se a fields por posição, nunca pelo header.</p>
              </div>
            </li>
            <li>
              <span className="oi-flow-index">03</span>
              <div>
                <strong>Revisar</strong>
                <p>Preview dry run com normalização pt-BR-v1 e erros por campo.</p>
              </div>
            </li>
          </ol>
        </section>

        <section
          className="oi-section"
          id="capacidades"
          aria-labelledby="oi-cap-title"
        >
          <h2 id="oi-cap-title">Manifesto do MVP</h2>
          <div className="oi-manifest">
            <p>
              <span className="oi-mono">postMessage</span> inicializa o iframe
              com <span className="oi-mono">oi_import_</span> em memória.
            </p>
            <p>
              Upload, mapping otimista e preview normalizado sem confirmação
              definitiva.
            </p>
            <p>
              Conflitos de revisão pedem decisão explícita;{' '}
              <span className="oi-mono">upload_failed</span> é terminal.
            </p>
          </div>
          <p className="oi-limit-note" role="note">
            O fluxo termina no preview. Confirmação e processamento definitivo
            ainda não estão disponíveis nesta versão.
          </p>
        </section>

        <section
          className="oi-section"
          id="integracao"
          aria-labelledby="oi-int-title"
        >
          <h2 id="oi-int-title">Integração</h2>
          <p>
            Abra <code>/imports/:importId</code> e envie do parent:
          </p>
          <pre className="oi-code">
            <code>{`{
  "type": "openimport.initialize",
  "version": 1,
  "importId": "<uuid>",
  "accessToken": "oi_import_<64 hex>"
}`}</code>
          </pre>
          <p>
            Respostas: <code>openimport.ready</code>,{' '}
            <code>openimport.loaded</code>, <code>openimport.error</code>.
            Origem explícita — nunca <code>*</code>.
          </p>
        </section>
      </main>

      <footer className="oi-site-footer">
        <p>OpenImport — open source, self-hosted.</p>
        <p>
          <a href="#canvas">Canvas</a>
          {' · '}
          <a href="#integracao">Integração</a>
        </p>
      </footer>
    </div>
  )
}
