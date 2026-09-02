# OpenImport backend

NestJS API for multi-tenant import templates. Authenticate with an organization API key:

```
Authorization: Bearer <api-key>
```

The organization is derived from the verified key. Clients must not send `organizationId`.

## Requirements

- Node.js 24
- npm
- Docker (PostgreSQL only)

## Local setup

1. Copy environment variables:

```bash
cp .env.example .env
```

2. Generate a high-entropy API key and put it in `.env` as `SEED_API_KEY`. The value must be `oi_live_` followed by exactly 64 hexadecimal characters, with no whitespace. `.env.example` leaves the variable empty on purpose. Do not commit `.env`.

```bash
node -e "console.log('oi_live_'+require('crypto').randomBytes(32).toString('hex'))"
```

3. Start PostgreSQL from the repository root:

```bash
docker compose up -d
```

This creates two databases on host port **5434**: `openimport` (development) and `openimport_test` (tests).

4. Install dependencies, generate the Prisma Client, and apply the versioned migration:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
```

During first-time development you can also run `npm run prisma:migrate -- --name init` if you need to create a new migration. Do not use `prisma db push`.

5. Seed the local organization. The seed refuses to run when `NODE_ENV=production`, rejects empty, short, placeholder, and malformed keys before touching the database, and stores only a SHA-256 hash plus a diagnostic prefix. It never prints the full key.

If `DATABASE_URL` is already set in your shell, it wins over `.env`. Unset it first so the seed uses the development database from `.env`.

```bash
npm run prisma:seed
```

6. Start the API:

```bash
npm run start:dev
```

The API listens on `PORT` (default 3000).

- Health: `GET /health`
- Readiness (includes a database ping, no connection string in the body): `GET /health/ready`
- OpenAPI UI: `GET /docs`
- OpenAPI JSON: `GET /docs-json`
- Create template: `POST /api/v1/templates`
- Get template: `GET /api/v1/templates/:templateId`

## Template contract

`POST /api/v1/templates`

```json
{
  "name": "products",
  "fields": [
    {
      "key": "sku",
      "label": "SKU",
      "type": "string",
      "required": true
    },
    {
      "key": "priceInCents",
      "label": "Preço",
      "type": "currency",
      "required": true
    }
  ]
}
```

Field types are `string`, `integer`, or `currency`. JSON types are strict: `required` must be a boolean, and `name`, `key`, and `label` must be strings. `name` is 1–100 characters after trim and unique per organization. Each template needs 1–50 fields. Field `key` values must be unique in the template and match `^[a-z][a-zA-Z0-9]{0,63}$`.

Unknown routes, with or without `/api/v1`, return JSON `{ code, message, traceId }` with `code: "RESOURCE.NOT_FOUND"`. Successful and error responses include `X-Request-ID`, matching `traceId` on errors. Incoming request IDs are accepted only when they are 1–128 characters from `[A-Za-z0-9._-]`; otherwise the API mints a new id.

Responses never include `organizationId` or credential hashes.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run start:dev` | Watch mode |
| `npm run typecheck` | Prisma generate + `tsc` for `src/` and `test/` |
| `npm run lint` | Oxlint |
| `npm test` | Unit tests |
| `npm run test:e2e` | HTTP tests against Postgres `openimport_test` |
| `npm run build` | Generate Prisma Client and compile |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:migrate` | Create/apply a development migration |
| `npm run prisma:migrate:deploy` | Apply committed migrations |
| `npm run prisma:seed` | Seed the local organization from `SEED_API_KEY` |

## Tests

Unit tests do not use the database. E2E tests apply migrations to `openimport_test` and create isolated organizations per case.

```bash
npm test
npm run test:e2e
```
