# OpenImport backend

API NestJS multi-tenant para templates, sessões de importação CSV, mapping manual, preview síncrono e confirmação assíncrona com snapshot persistido. A organização vem da API key:

```http
Authorization: Bearer <api-key>
```

Documentação técnica versionada: [`docs/README.md`](docs/README.md).

## Início rápido

Requer Node.js 24, npm e Docker. Na raiz do repositório:

```bash
docker compose up -d
```

Sobe PostgreSQL, MinIO e Redis (BullMQ). Em `backend/`, copie `.env.example` para `.env`, gere uma chave `SEED_API_KEY` (`oi_live_` + 64 caracteres hexadecimais minúsculos) e execute:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run start:dev
```

O banco de desenvolvimento é `openimport` (Postgres) + Redis DB `0`; E2E usa `openimport_test` + Redis DB `15`. Não use `prisma db push`, não crie migration para instalar e não versiona `.env`.

URLs locais:

- API: `http://localhost:3000/api/v1`
- Health: `http://localhost:3000/health`
- Readiness: `http://localhost:3000/health/ready`
- Swagger/OpenAPI: `/docs` e `/docs-json` (fora de produção, ou com `ENABLE_DOCS=true`)

## Fluxo atual

1. Criar template.
2. Criar sessão com `Idempotency-Key`.
3. Enviar CSV em `file`.
4. Consultar e salvar mapping com revisão otimista.
5. Executar preview `pt-BR-v1` (dry-run).
6. Confirmar com revisão + SHA-256 → `queued` (worker + reconciliador no mesmo processo Nest em desenvolvimento).
7. Aguardar worker até `ready` (ou `processing_failed` com `failure` público); consultar `rejected-rows` e, com API key no backend cliente, `valid-rows` + `results` / `results/summary`.

Não há webhook `import.ready`, listagem/histórico, cancelamento, XLSX nem autenticação de usuário para navegador.

## Comandos

Em `backend/`: `npm test` (unitários), `npm run test:e2e` (Postgres/MinIO/Redis), `npm run lint`, `npm run typecheck` e `npm run build`. Execute typecheck e build sequencialmente, pois ambos geram Prisma.

Consulte [Ambiente local](docs/getting-started.md), [Referência HTTP](docs/api-reference.md) e [Integração frontend](docs/frontend-integration.md) para instruções e contratos completos.
