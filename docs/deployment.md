# Self-hosted deployment

This stack is meant to run behind your own TLS terminator. The Compose file does not publish PostgreSQL, Redis, or MinIO, does not start a MinIO console, and does not run `prisma db seed`.

## Prerequisites

- Docker Compose v2
- Node.js 24 only if you run local gates; the images use `node:24-alpine`
- A secrets file copied from [`.env.production.example`](../.env.production.example) — replace every `CHANGE_ME` value

Never reuse credentials from [`docker-compose.yml`](../docker-compose.yml). That file is development-only (published ports, weak local passwords, MinIO console).

Use a distinct Compose project name so production volumes do not collide with the development stack:

```bash
docker compose -p openimport-prod -f docker-compose.production.yml --env-file .env.production config --quiet
```

## Build and start

```bash
docker compose -p openimport-prod -f docker-compose.production.yml --env-file .env.production build
docker compose -p openimport-prod -f docker-compose.production.yml --env-file .env.production up -d --wait
```

`migrate` is a one-shot service (`prisma migrate deploy`, `restart: "no"`). It runs against an empty or already-migrated database. The API container starts only after that job exits 0. Image build sets a dummy `DATABASE_URL` only so `prisma generate` can load `prisma.config.ts`; the running services use the Compose value.

Frontend image build args:

| Arg | Typical production value |
| --- | --- |
| `VITE_OPENIMPORT_API_BASE_URL` | `/api/v1` (same-origin nginx proxy) |
| `VITE_OPENIMPORT_PARENT_ORIGINS` | explicit host origins, no `*` |

Runtime `FRONTEND_FRAME_ANCESTORS` must list `'self'` and/or absolute http(s) origins. Empty values, `*`, `;`, CR/LF, and broad scheme sources (`https:`) are rejected at container start.

The only published port is frontend `8080`. Put TLS (Caddy, nginx, a load balancer) in front of that port.

## Environment

Validated at backend boot ([`backend/src/core/config/env.ts`](../backend/src/core/config/env.ts)):

- Compose constructs `DATABASE_URL`, `REDIS_URL` (`redis:6379/0`), and `S3_ENDPOINT` (`http://minio:9000`) from `POSTGRES_*` and S3 credentials. A host `DATABASE_URL` (for example the local E2E URL on `localhost:5434`) is not interpolated into the containers.
- `POSTGRES_PASSWORD` must be URL-safe (no `@`, `:`, `/`, or `#`).
- E2E uses Redis logical DB `15` and must not share the production Redis URL.
- `ALLOWED_ORIGINS` is a comma-separated list of absolute browser origins. Wildcards are rejected in production.
- `WEBHOOK_SECRET_ENCRYPTION_KEY` is 64 lowercase hex characters.
- Compose topology is **client → nginx → backend**. Set `TRUST_PROXY=1` (hop count). Unrestricted `true` is coerced to `loopback` and is never allowed. nginx sets `X-Forwarded-For` to `$remote_addr` (overwrite, not append) so a client cannot choose the IP used by the limiter.
- `RATE_LIMIT_TRUSTED_PROXY=true` is allowed only when `TRUST_PROXY` is set. Pre-auth keys use IP; post-auth keys use `organizationId` + `apiKeyId` / `accessTokenId` — never the raw token. Counters live in Redis (`openimport:rl:*`) with TTL.
- Operation tiers: `RATE_LIMIT_PRE_AUTH_MAX`, `RATE_LIMIT_MAX`, `RATE_LIMIT_*_UPLOAD/PREVIEW/CONFIRM/ACCESS_TOKEN/WEBHOOK`.
- `WEBHOOK_SSRF_ALLOW_PRIVATE_TARGETS` must stay `false` in production.

If an outer TLS terminator sits in front of nginx, increase the hop count accordingly and ensure that terminator also overwrites forwarded-for from untrusted clients.

## TLS

Terminate HTTPS outside Compose. Forward `X-Forwarded-For` / `X-Forwarded-Proto` only from that proxy, and set `TRUST_PROXY` to the number of trusted hops. The frontend container already proxies `/api/` and `/health*` to the backend on the internal network and re-resolves the `backend` hostname through Docker DNS after restarts.

## Backups

Backup is documented, not automated.

**PostgreSQL** — while the `postgres` service is healthy:

```bash
docker compose -p openimport-prod -f docker-compose.production.yml --env-file .env.production exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > openimport-$(date +%F).dump
```

Restore onto a new volume with `pg_restore`, then run `migrate` (`prisma migrate deploy`) if the dump predates newer migrations.

**MinIO** — copy the `openimport_minio` volume (or `mc mirror` from a break-glass admin task on the internal network). Object keys are not an API contract; restore the volume that the running service mounts.

After restore, confirm `/health/ready` before sending traffic.

## Smoke test

From the repository root (generates ephemeral secrets, uses project `openimport-smoke`, deletes that project's volumes at the end):

```bash
node scripts/smoke-production.mjs
```

The script builds images, applies migrations on an empty database, then checks liveness, readiness, `/`, `/imports/<uuid>`, CSP `frame-ancestors`, proxied `/health`, unauthenticated `/api/v1` (401), absence of the `/dev` harness, non-root processes, no `.env` files in the images, unpublished infra ports, restart, and volume persistence.

## Known limits

- Rate limit is Redis-backed and shared across API replicas; Redis outage fails closed with generic `503`.
- TLS terminates outside Compose.
- Backup/restore is an operator procedure, not a Compose service.
- CI and local E2E use Redis DB 15 on ephemeral runners; do not point them at production Redis.
- `HTTP_REQUEST_TIMEOUT_MS` bounds incomplete request reception; it does not cancel controller work after the body is fully received.
