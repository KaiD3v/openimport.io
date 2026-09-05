# OpenImport frontend

Interface embarcada do OpenImport: token temporário por `postMessage`, contexto da sessão, upload CSV, mapping manual e preview normalizado (`pt-BR-v1`). A confirmação definitiva ainda não existe no backend.

## Identidade visual

Bancada técnica OpenImport Data Workbench — fundo `--ink` (#0b0f14), painéis `--panel` (#141b24), texto `--chalk`, metadados `--mist`, ação `--phosphor`, sinal `--signal`. Tipografia IBM Plex Sans Condensed nos títulos, Sans no corpo e Mono em IDs, status e JSON. Sem dashboard SaaS, glassmorphism ou API key no navegador.

## Desenvolvimento

```bash
cp .env.example .env
npm install
npm run dev
```

Rota da importação: `/imports/:importId`.

Harness de desenvolvimento: `/dev` (ausente do build de produção). Token só em memória, nunca na query string.

QA visual sem token: seção **Pré-visualização visual** ou `/dev?fixture=<id>` (`created`, `uploaded-incomplete`, `uploaded-complete`, `upload-failed`, `long-labels`).

## Fluxo suportado

1. Host emite `oi_import_` fora do navegador e inicializa o iframe.
2. `GET /imports/:importId/context`
3. Em `created`: `POST /imports/:importId/file` (campo `file`)
4. Em `uploaded`: mapping por `columnPosition` + `fieldKey`, `PUT` com `expectedRevision`
5. Com mapping completo: `POST /imports/:importId/preview` (limite padrão 20)
6. Preview é dry run — sem confirmação nem processamento definitivo

`upload_failed` permanece terminal.

## Variáveis

| Variável | Uso |
| --- | --- |
| `VITE_OPENIMPORT_API_BASE_URL` | Base HTTP, em geral `http://localhost:3000/api/v1` |
| `VITE_OPENIMPORT_PARENT_ORIGINS` | Origens explícitas do host (sem wildcard) |
| `VITE_OPENIMPORT_REPOSITORY_URL` | URL pública do repositório (header/footer). Vazia esconde os links. |

## Protocolo embed

```json
{
  "type": "openimport.initialize",
  "version": 1,
  "importId": "<uuid>",
  "accessToken": "oi_import_<64 hex minúsculos>"
}
```

Respostas ao parent (origem explícita, nunca `*`): `openimport.ready`, `openimport.loaded`, `openimport.error`.

## Scripts

```bash
npm run lint
npm run typecheck
npm test
npm run test:watch
npm run build
npm run qa:visual   # fixtures em 360/768/1440 (Chrome local)
npm run qa:e2e      # walkthrough real com backend + /dev
```

`qa:e2e` exige opt-in (`OPENIMPORT_E2E_ALLOW_PERSIST=1`) porque cria template/sessão/objeto persistentes sem cleanup. Lê `SEED_API_KEY` de `backend/.env` fora do navegador e não imprime o token.
## Backend local

API em `http://localhost:3000/api/v1`, CORS para `http://localhost:5173`. Ver `backend/docs/frontend-integration.md`.
