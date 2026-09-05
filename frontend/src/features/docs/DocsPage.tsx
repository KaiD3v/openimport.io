import type { ReactNode } from 'react'
import { GitHubLink } from '../shared/GitHubLink.tsx'
import { SiteChrome } from '../shared/SiteChrome.tsx'
import { getOpenImportRepositoryUrl } from '../../config/public-links.ts'
import { DocsCodeBlock } from './DocsCodeBlock.tsx'
import { DOCS_TOC } from './docs-toc.ts'
import {
  SNIPPET_CLIENT,
  SNIPPET_CONSUME,
  SNIPPET_ENV,
  SNIPPET_HOST_ROUTE,
  SNIPPET_IFRAME,
  SNIPPET_SESSION,
  SNIPPET_TEMPLATE,
  SNIPPET_WEBHOOK,
} from './docs-snippets.ts'
import { useScrollToHash } from './use-scroll-to-hash.ts'

function DocsSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section className="oi-docs-section" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
  )
}

export function DocsPage() {
  const repositoryUrl = getOpenImportRepositoryUrl()
  useScrollToHash()

  return (
    <SiteChrome>
      <main id="conteudo-principal" className="oi-docs" tabIndex={-1}>
        <div className="oi-docs-hero">
          <p className="oi-eyebrow">OPENIMPORT://DOCS</p>
          <h1 id="oi-docs-title">Documentação de integração</h1>
          <p className="oi-docs-lead">
            Guia passo a passo para embutir o OpenImport no seu sistema
            (JavaScript / Node.js). Copie os blocos na ordem. A API key{' '}
            <span className="oi-mono">oi_live_</span> fica só no servidor do
            host; o navegador recebe apenas{' '}
            <span className="oi-mono">oi_import_</span>.
          </p>
        </div>

        <nav className="oi-docs-toc" aria-label="Nesta página">
          <p className="oi-docs-toc-label">Nesta página</p>
          <ol>
            {DOCS_TOC.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`}>{item.label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <DocsSection id="introducao" title="Introdução">
          <p>
            OpenImport é uma API self-hosted de importação CSV, com uma bancada
            embarcável em iframe. O sistema cliente (host) define o template,
            cria a sessão e entrega um token temporário ao iframe. O operador
            envia o CSV, mapeia colunas, revisa o preview e confirma. O
            OpenImport normaliza no perfil <span className="oi-mono">pt-BR-v1</span>,
            processa em fila e devolve um snapshot de registros válidos e
            rejeitados.
          </p>
          <ul className="oi-docs-list">
            <li>
              Não acessa o banco de dados do cliente — só entrega snapshot via
              API.
            </li>
            <li>Licença Apache-2.0; você hospeda a API e o frontend.</li>
            <li>
              Sem login de usuário final, sem listagem de importações, sem XLSX
              no MVP.
            </li>
          </ul>
        </DocsSection>

        <DocsSection id="conceitos" title="Conceitos">
          <ul className="oi-how">
            <li>
              <strong>OpenImport</strong>
              <span>
                API Nest + bancada React. Guarda o snapshot; não escreve no seu
                ERP.
              </span>
            </li>
            <li>
              <strong>Sistema cliente (host)</strong>
              <span>
                Seu produto. Backend usa{' '}
                <span className="oi-mono">oi_live_</span>; frontend só embute o
                iframe.
              </span>
            </li>
            <li>
              <strong>Operador</strong>
              <span>
                Pessoa no browser, dentro do iframe, com token{' '}
                <span className="oi-mono">oi_import_</span> só em memória.
              </span>
            </li>
          </ul>
          <p>
            Quando o status da sessão é <span className="oi-mono">ready</span>,
            os válidos saem em{' '}
            <span className="oi-mono">GET /imports/:id/valid-rows</span> (somente
            API key). O iframe <strong>não</strong> baixa esses registros.
          </p>
        </DocsSection>

        <DocsSection id="repositorio" title="Repositório">
          {repositoryUrl ? (
            <p>
              Código-fonte e issues:{' '}
              <GitHubLink>Ver o repositório no GitHub</GitHubLink>
            </p>
          ) : (
            <p className="oi-limit-note">
              URL do repositório não configurada. Defina{' '}
              <span className="oi-mono">VITE_OPENIMPORT_REPOSITORY_URL</span> no
              ambiente do frontend para exibir o link do GitHub.
            </p>
          )}
        </DocsSection>

        <DocsSection id="pre-requisitos" title="Pré-requisitos">
          <ol className="oi-docs-list">
            <li>
              OpenImport no ar: <span className="oi-mono">GET /health/ready</span>{' '}
              → <span className="oi-mono">{`{"status":"ok"}`}</span>.
            </li>
            <li>Node.js 18+ no backend do host (fetch global).</li>
            <li>
              Variáveis no <strong>servidor do host</strong>:
            </li>
          </ol>
          <DocsCodeBlock code={SNIPPET_ENV} />
          <p>
            No OpenImport, configure origens explícitas (nunca{' '}
            <span className="oi-mono">*</span> em produção):
          </p>
          <ul className="oi-docs-list">
            <li>
              <span className="oi-mono">ALLOWED_ORIGINS</span> — CORS do iframe
              para a API (quando não for same-origin).
            </li>
            <li>
              <span className="oi-mono">VITE_OPENIMPORT_PARENT_ORIGINS</span> —
              origem da <strong>sua</strong> app (quem envia{' '}
              <span className="oi-mono">openimport.initialize</span>).
            </li>
            <li>
              <span className="oi-mono">FRONTEND_FRAME_ANCESTORS</span> — quem
              pode embutir o iframe (CSP).
            </li>
          </ul>
          <DocsCodeBlock code={SNIPPET_CLIENT} />
        </DocsSection>

        <DocsSection id="passo-1-template" title="Passo 1 — Criar o template">
          <p>
            <strong>Só no servidor.</strong> Defina os campos que o CSV deve
            preencher. <span className="oi-mono">type</span> aceita{' '}
            <span className="oi-mono">string</span>,{' '}
            <span className="oi-mono">integer</span> ou{' '}
            <span className="oi-mono">currency</span> (centavos).{' '}
            <span className="oi-mono">key</span> em camelCase começando com
            minúscula. Não há listagem: persista o <span className="oi-mono">id</span>.
          </p>
          <DocsCodeBlock code={SNIPPET_TEMPLATE} />
        </DocsSection>

        <DocsSection id="passo-2-sessao" title="Passo 2 — Sessão e token">
          <p>
            <strong>Só no servidor.</strong> Crie a sessão com{' '}
            <span className="oi-mono">Idempotency-Key</span> estável por tentativa
            lógica. Em seguida emita o token de importação (
            <span className="oi-mono">oi_import_</span>).
          </p>
          <DocsCodeBlock code={SNIPPET_SESSION} />
        </DocsSection>

        <DocsSection id="passo-3-rota-host" title="Passo 3 — Expor ao frontend do host">
          <p>
            Sua API autenticada devolve <span className="oi-mono">importId</span>{' '}
            + <span className="oi-mono">accessToken</span> uma vez, com{' '}
            <span className="oi-mono">Cache-Control: no-store</span>. O frontend
            do host guarda o token só em memória (estado da aba).
          </p>
          <DocsCodeBlock code={SNIPPET_HOST_ROUTE} />
        </DocsSection>

        <DocsSection id="passo-4-iframe" title="Passo 4 — Iframe e postMessage">
          <p>
            <strong>Só no browser.</strong> Abra{' '}
            <span className="oi-mono">/imports/:importId</span> no iframe. No{' '}
            <span className="oi-mono">load</span>, envie{' '}
            <span className="oi-mono">openimport.initialize</span> com origem
            explícita. Respostas:{' '}
            <span className="oi-mono">openimport.ready</span> (token aceito),{' '}
            <span className="oi-mono">openimport.loaded</span> (contexto OK),{' '}
            <span className="oi-mono">openimport.error</span>.
          </p>
          <DocsCodeBlock code={SNIPPET_IFRAME} />
        </DocsSection>

        <DocsSection id="passo-5-operador" title="Passo 5 — Fluxo do operador">
          <p>
            Dentro do iframe o operador faz upload → mapping → preview →
            confirmação. O host <strong>não</strong> chama{' '}
            <span className="oi-mono">/file</span>,{' '}
            <span className="oi-mono">/mapping</span>,{' '}
            <span className="oi-mono">/preview</span> nem{' '}
            <span className="oi-mono">/confirm</span>. Após confirmar, a sessão
            vai a <span className="oi-mono">queued</span> →{' '}
            <span className="oi-mono">processing</span> →{' '}
            <span className="oi-mono">ready</span> (ou{' '}
            <span className="oi-mono">processing_failed</span>). O iframe faz poll
            e pode listar rejeições; os válidos ficam só para a API key.
          </p>
        </DocsSection>

        <DocsSection id="passo-6-consumo" title="Passo 6 — Consumir o snapshot">
          <p>
            <strong>Só no servidor do host.</strong> Espere{' '}
            <span className="oi-mono">ready</span> (poll ou webhook), pagine{' '}
            <span className="oi-mono">valid-rows</span>, grave no seu domínio e
            reporte <span className="oi-mono">POST .../results</span>.
          </p>
          <DocsCodeBlock code={SNIPPET_CONSUME} />
          <p>
            Webhook opcional: cadastre{' '}
            <span className="oi-mono">PUT /webhook-endpoints</span> com a API key.
            O payload de <span className="oi-mono">import.ready</span> traz
            contagens, não as linhas. Verifique a assinatura no body cru:
          </p>
          <DocsCodeBlock code={SNIPPET_WEBHOOK} />
        </DocsSection>

        <DocsSection id="checklist" title="Checklist">
          <ul className="oi-docs-list">
            <li>
              <span className="oi-mono">oi_live_</span> nunca no React, URL,
              cookie ou localStorage.
            </li>
            <li>
              Token <span className="oi-mono">oi_import_</span> só em memória;
              nunca na query string do iframe.
            </li>
            <li>
              <span className="oi-mono">postMessage</span> com origem explícita —
              nunca <span className="oi-mono">*</span>.
            </li>
            <li>
              Não espere download dos válidos na UI do OpenImport — use{' '}
              <span className="oi-mono">valid-rows</span> no backend.
            </li>
            <li>
              Sem listagem/cancelamento na API: persista IDs e idempotency keys
              no host.
            </li>
            <li>
              Lotes de results ≤ 100; mesma Idempotency-Key + mesmo body =
              replay.
            </li>
          </ul>
        </DocsSection>

        <DocsSection id="referencia" title="Referência">
          <ul className="oi-docs-list">
            <li>
              Swagger local (dev):{' '}
              <span className="oi-mono">http://localhost:3000/docs</span>
            </li>
            <li>
              Laboratório visual (somente DEV):{' '}
              <span className="oi-mono">/dev</span>
            </li>
            <li>
              Contrato no repositório:{' '}
              <span className="oi-mono">backend/docs/frontend-integration.md</span>{' '}
              e <span className="oi-mono">backend/docs/api-reference.md</span>
            </li>
            <li>
              Exemplo de template:{' '}
              <span className="oi-mono">
                backend/docs/examples/products-template.json
              </span>
            </li>
          </ul>
          <p className="oi-docs-back-wrap">
            <a
              className="oi-docs-back"
              href="/"
              aria-label="Voltar à página inicial"
            >
              <svg
                className="oi-docs-back-icon"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="square"
                  d="M14 5 7 12l7 7M7 12h11"
                />
              </svg>
            </a>
          </p>
        </DocsSection>
      </main>
    </SiteChrome>
  )
}
