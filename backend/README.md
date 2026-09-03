# OpenImport backend

NestJS API for multi-tenant import templates and CSV import sessions. Authenticate with an organization API key:

```
Authorization: Bearer <api-key>
```

The organization is derived from the verified key. Clients must not send `organizationId`.

## Requirements

- Node.js 24
- npm
- Docker (PostgreSQL + MinIO)

## Local setup

1. Copy environment variables:

```bash
cp .env.example .env
```

2. Generate a high-entropy API key and put it in `.env` as `SEED_API_KEY`. The value must be `oi_live_` followed by exactly 64 hexadecimal characters, with no whitespace. `.env.example` leaves the variable empty on purpose. Do not commit `.env`.

```bash
node -e "console.log('oi_live_'+require('crypto').randomBytes(32).toString('hex'))"
```

3. Start PostgreSQL and MinIO from the repository root:

```bash
docker compose up -d
```

This creates:

- PostgreSQL on host port **5434** with databases `openimport` (development) and `openimport_test` (tests)
- MinIO S3 API on **9000** and console on **9001**
- Bucket `openimport` (created idempotently by `minio-init`)

Development MinIO credentials are intentionally weak and local-only (`openimport` / `openimportsecret`).

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
- Create import session: `POST /api/v1/imports` (requires `Idempotency-Key`)
- Upload CSV: `POST /api/v1/imports/:importId/file` (`multipart/form-data`, field `file`)
- Get import session: `GET /api/v1/imports/:importId`
- Get column mapping: `GET /api/v1/imports/:importId/mapping`
- Replace column mapping: `PUT /api/v1/imports/:importId/mapping`
- Preview mapped rows (dry run): `POST /api/v1/imports/:importId/preview`

## Import session flow

1. Create a template.
2. Create a session:

```bash
curl -sS http://localhost:3000/api/v1/imports \
  -H "Authorization: Bearer $API_KEY" \
  -H "Idempotency-Key: demo-import-001" \
  -H "Content-Type: application/json" \
  -d "{\"templateId\":\"$TEMPLATE_ID\"}"
```

`Idempotency-Key` must be 8–128 characters from `[A-Za-z0-9._-]`. The API stores only a SHA-256 of the key plus a fingerprint of `{ templateId }`. Same org + key + payload returns the same session; same key with a different payload returns `409 IDEMPOTENCY.KEY_REUSED`.

3. Upload a UTF-8 CSV (comma or semicolon; ambiguous delimiters are rejected):

```bash
curl -sS http://localhost:3000/api/v1/imports/$IMPORT_ID/file \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@./products.csv;type=text/csv"
```

The upload streams to MinIO/S3, hashes with SHA-256, parses with `csv-parse` without buffering the whole file, and persists ordered columns. Quoted commas, semicolons, and line breaks inside header fields are accepted. The request must contain exactly one file field named `file`. Invalid UTF-8 is rejected with `422 IMPORT.INVALID_CSV` and is not replaced with fallback characters. Multipart requests without a valid boundary return `400 VALIDATION.FAILED`. A second upload for an accepted file returns `409 IMPORT.FILE_ALREADY_UPLOADED`. After `upload_failed`, retry is not allowed in this MVP and returns `409 IMPORT.UPLOAD_NOT_ALLOWED`.

Session status after a failed upload:
- Rejection before the object is stored (for example invalid multipart or incompatible filename/MIME): session stays `created`, and a later valid upload is allowed.
- `CsvParseError` after the object was stored: object is deleted, session becomes `upload_failed`, and retry is blocked with `409 IMPORT.UPLOAD_NOT_ALLOWED`.

Encoding: UTF-8 and UTF-8 with BOM only. A leading UTF-8 BOM (`EF BB BF`) is stripped once even when those bytes arrive across chunks. Invalid UTF-8 sequences are rejected. A U+FEFF that appears in field content after the preamble is preserved.

### Conservative upload limits (overridable via env)

| Variable | Default | Meaning |
| --- | --- | --- |
| `IMPORT_MAX_FILE_BYTES` | `5242880` (5 MiB) | Max upload size |
| `IMPORT_MAX_DATA_ROWS` | `10000` | Max data rows after the header |
| `IMPORT_MAX_COLUMNS` | `50` | Max header columns |
| `IMPORT_MAX_FIELD_BYTES` | `65536` | Max bytes per individual field |

### Column mapping (manual)

Mapping associates CSV **column positions** with template **field keys**. It is available only while the session status is `uploaded`. Saving a mapping does not validate rows and does not change session status.

4. Inspect the empty draft:

```bash
curl -sS http://localhost:3000/api/v1/imports/$IMPORT_ID/mapping \
  -H "Authorization: Bearer $API_KEY"
```

Initial response shape:

```json
{
  "importId": "...",
  "revision": 0,
  "mappings": [],
  "isComplete": false,
  "missingRequiredFields": ["sku", "priceInCents"]
}
```

5. Save a draft (partial mappings are allowed):

```bash
curl -sS -X PUT http://localhost:3000/api/v1/imports/$IMPORT_ID/mapping \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"expectedRevision\":0,\"mappings\":[{\"columnPosition\":0,\"fieldKey\":\"sku\"}]}"
```

Rules:
- Map by `columnPosition` → `fieldKey` (not by header text).
- `expectedRevision` must match the current revision or the API returns `409 IMPORT.MAPPING_REVISION_CONFLICT` (GET again and retry).
- Semantic no-ops (same pairs in any order) keep the revision unchanged.
- `mappings: []` clears the draft and increments the revision when the previous draft was non-empty.
- Unknown columns/fields or duplicate associations return `422 IMPORT.MAPPING_INVALID` without changing persistence.
- Sessions in `created` or `upload_failed` return `409 IMPORT.MAPPING_NOT_ALLOWED`.
- `isComplete` means at least one association exists and every required template field is mapped. It does **not** mean row validation passed.

6. Complete the mapping:

```bash
curl -sS -X PUT http://localhost:3000/api/v1/imports/$IMPORT_ID/mapping \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"expectedRevision\":1,\"mappings\":[{\"columnPosition\":0,\"fieldKey\":\"sku\"},{\"columnPosition\":2,\"fieldKey\":\"priceInCents\"}]}"
```

7. Dry-run preview (does **not** confirm the import, persist normalized rows, or call any customer API):

```bash
curl -sS -X POST http://localhost:3000/api/v1/imports/$IMPORT_ID/preview \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"expectedMappingRevision":2,"limit":20}'
```

Preview applies the saved mapping, profile `pt-BR-v1`, and returns:
- `summary` counts for **every** data record.
- `rows`: a prefix sample (`limit` 1–100, default 20), also capped at 1 MiB of JSON (`1_048_576` bytes of `JSON.stringify` UTF-8). `sampleTruncated` is true when the sample is incomplete. A first record larger than that budget can yield `rows: []` while the summary remains valid. `expectedMappingRevision` must be a JSON integer from `0` to `Number.MAX_SAFE_INTEGER`.
- Invalid records have `data: null` and per-field errors (`FIELD.REQUIRED`, `FIELD.INVALID_INTEGER`, `FIELD.INVALID_CURRENCY`, `FIELD.NUMBER_OUT_OF_RANGE`). Messages never echo cell values.

HTTP 200 with invalid rows is expected. Preview does not change session status, mapping, revision, or the stored object.

Conflicts: `409 IMPORT.PREVIEW_NOT_ALLOWED` (not `uploaded`), `409 IMPORT.MAPPING_INCOMPLETE`, `409 IMPORT.MAPPING_REVISION_CONFLICT` (before or during the read), `409 IMPORT.FILE_CHANGED` (object bytes or header/count no longer match upload metadata). Values of `expectedMappingRevision` outside `0..Number.MAX_SAFE_INTEGER` return `400 VALIDATION.FAILED` before storage is opened. Read failures, including a storage stream that closes before EOF, return `503 IMPORT.PREVIEW_UNAVAILABLE` and never delete the object.

A later confirmation step (not in this slice) must re-check mapping revision and file identity.

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

Responses never include `organizationId`, storage object keys, or credential hashes.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run start:dev` | Watch mode |
| `npm run typecheck` | Prisma generate + `tsc` for `src/` and `test/` |
| `npm run lint` | Oxlint |
| `npm test` | Unit tests |
| `npm run test:e2e` | HTTP tests against Postgres `openimport_test` and MinIO |
| `npm run build` | Generate Prisma Client and compile |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:migrate` | Create/apply a development migration |
| `npm run prisma:migrate:deploy` | Apply committed migrations |
| `npm run prisma:seed` | Seed the local organization from `SEED_API_KEY` |

## Tests

Unit tests do not use the database. E2E tests apply migrations to `openimport_test`, exercise MinIO, and create isolated organizations per case.

```bash
npm test
npm run test:e2e
```
