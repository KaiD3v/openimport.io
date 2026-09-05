# Ambiente local

## Requisitos confirmados

- Node.js 24 (`.nvmrc` / `.node-version` na raiz; o manifesto não impõe `engines`).
- npm e Docker Compose.
- PostgreSQL 17 (`postgres:17-alpine`), MinIO compatível com S3 e Redis 7.4 (`redis:7.4.2-alpine`), fornecidos pelo Compose da raiz.
- O backend é ESM, NestJS 12, Prisma 7, TypeScript 6, Vitest 4, BullMQ (versões no `package.json`).

Self-host e CI: ver [Deployment](../../docs/deployment.md) e `.github/workflows/ci.yml`.

## Bancos e variáveis

O Compose cria `openimport` para desenvolvimento e `openimport_test` para E2E, ambos no Postgres local `localhost:5434`. Não aponte comandos de desenvolvimento para o banco de teste.

Copie `backend/.env.example` para `backend/.env` e defina uma chave de seed. O `dotenv` não sobrescreve variáveis já existentes: uma variável definida no shell tem precedência sobre `.env`. Isso é especialmente relevante para `DATABASE_URL`.

PowerShell, a partir de `backend/`:

```powershell
Copy-Item .env.example .env
node -e "console.log('oi_live_'+require('crypto').randomBytes(32).toString('hex'))"
# Copie o resultado para SEED_API_KEY no arquivo .env; não o exponha.
```

Bash, a partir de `backend/`:

```bash
cp .env.example .env
node -e "console.log('oi_live_'+require('crypto').randomBytes(32).toString('hex'))"
# Copie o resultado para SEED_API_KEY no arquivo .env; não o exponha.
```

A chave precisa ser `oi_live_` seguido de exatamente 64 caracteres hexadecimais minúsculos (`0-9`, `a-f`). O seed armazena apenas SHA-256 e um prefixo diagnóstico.

Gere também `WEBHOOK_SECRET_ENCRYPTION_KEY` (64 hex minúsculos) no `.env`. Ela cifra o segredo de assinatura do webhook em repouso e não deve ser logada:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Subir o ambiente

PowerShell:

```powershell
# Na raiz do repositório
docker compose up -d

# Em backend/
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run start:dev
```

Bash:

```bash
# Na raiz do repositório
docker compose up -d

# Em backend/
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run start:dev
```

O MinIO fica em `http://localhost:9000` (console em `:9001`) e o bucket `openimport` é criado idempotentemente por `minio-init`. As credenciais presentes no Compose são exclusivamente locais; não as reutilize fora desse ambiente.

Use `prisma:migrate:deploy` para aplicar migrations já versionadas. Não use `prisma db push`, não crie uma migration inicial para instalar o projeto e não resete banco/volumes como parte da instalação.

## Testes e verificação

Em `backend/`:

```powershell
npm test
npm run test:e2e
```

E2E requer Postgres, MinIO e Redis do Compose. Aplica migrations em `openimport_test` e usa Redis logical database **15** (`redis://localhost:6379/15`), isolado do backend local em DB **0**. Pode rodar com `npm run start:prod` ativo — os workers não compartilham a fila. Duas suítes E2E simultâneas no mesmo DB 15 não são suportadas. Para checagem estática e build, execute em sequência porque ambos geram Prisma:

```powershell
npm run typecheck
npm run build
```

Em Bash, os mesmos comandos `npm` são idênticos. Diagnóstico e limites ficam em [Testes e troubleshooting](testing-and-troubleshooting.md).

## Comandos equivalentes à CI

Backend:

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Frontend:

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Node.js 24 é a versão de referência (ver `.nvmrc` / `.node-version` na raiz).

Self-host (Compose de produção, sem portas de infra públicas):

```powershell
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.production.yml --env-file .env.production.example config --quiet
node scripts/check-license.mjs
node scripts/smoke-production.mjs
```

O smoke gera segredos efêmeros, aplica `prisma migrate deploy` em banco vazio e não executa seed. Detalhes em [Deployment](../../docs/deployment.md).

## Endereços locais

- API: `http://localhost:3000/api/v1`
- Liveness: `http://localhost:3000/health`
- Readiness: `http://localhost:3000/health/ready`
- Swagger: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/docs-json`

Swagger e JSON são habilitados quando `NODE_ENV` não é `production`, ou em produção com `ENABLE_DOCS=true`.
