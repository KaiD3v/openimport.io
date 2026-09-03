# Ambiente local

## Requisitos confirmados

- Node.js 24 (documentado; o manifesto não impõe `engines`).
- npm e Docker Compose.
- PostgreSQL 17 (`postgres:17-alpine`) e MinIO compatível com S3, fornecidos pelo Compose da raiz.
- O backend é ESM, NestJS 12, Prisma 7, TypeScript 6 e Vitest 4 (versões no `package.json`).

Não há Dockerfile, CI, `.nvmrc` ou `.node-version` versionados.

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

E2E requer Postgres e MinIO do Compose, aplica as migrations em `openimport_test` e cria organizações isoladas. Para checagem estática e build, execute em sequência porque ambos geram Prisma:

```powershell
npm run typecheck
npm run build
```

Em Bash, os mesmos comandos `npm` são idênticos. Diagnóstico e limites ficam em [Testes e troubleshooting](testing-and-troubleshooting.md).

## Endereços locais

- API: `http://localhost:3000/api/v1`
- Liveness: `http://localhost:3000/health`
- Readiness: `http://localhost:3000/health/ready`
- Swagger: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/docs-json`

Swagger e JSON são habilitados quando `NODE_ENV` não é `production`, ou em produção com `ENABLE_DOCS=true`.
