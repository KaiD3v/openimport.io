# OpenImport

OpenImport is an import API. This repository contains independent `backend/` and `frontend/` apps.

## Backend

The NestJS backend covers API-key auth, import templates, CSV import sessions, manual column-to-field mapping, and synchronous preview with `pt-BR-v1` normalization.

See [`backend/README.md`](backend/README.md) for a quick local setup with PostgreSQL and MinIO, and the versioned [technical documentation index](backend/docs/README.md) for HTTP contracts, frontend integration, CSV behavior, architecture, operations, and tests.

## Frontend

The frontend app is out of scope for the current backend slice. Do not change files under `frontend/` for backend work.
