# OpenImport

OpenImport is an import API. This repository contains independent `backend/` and `frontend/` apps.

## Backend

The NestJS backend covers API-key auth, import templates, and CSV import sessions (idempotent create, streaming upload to MinIO/S3, column detection).

See [`backend/README.md`](backend/README.md) for local setup with PostgreSQL and MinIO.

## Frontend

The frontend app is out of scope for the current backend slice. Do not change files under `frontend/` for backend work.
