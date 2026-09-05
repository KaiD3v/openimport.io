# OpenImport

OpenImport is an import API. This repository contains independent `backend/` and `frontend/` apps.

## Backend

The NestJS backend covers API-key auth, import access tokens scoped to a session, import templates, CSV import sessions, manual column-to-field mapping, synchronous preview with `pt-BR-v1` normalization, idempotent confirmation, asynchronous processing to a `ready` snapshot, client result reporting, and signed `import.ready` webhooks.

See [`backend/README.md`](backend/README.md) for a quick local setup with PostgreSQL and MinIO, and the versioned [technical documentation index](backend/docs/README.md) for HTTP contracts, frontend integration, CSV behavior, architecture, operations, and tests.

## Frontend

The React/Vite frontend covers the full import flow: upload, mapping, preview, confirmation, processing state, rejected rows, and initialization via `postMessage` with a short-lived import token. It is embedded by the host system and never receives the organization API key.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
