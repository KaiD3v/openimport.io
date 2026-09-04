-- Partial index aligned with listFileRetentionCandidates:
-- filter finished_at IS NOT NULL + status IN (ready, failed),
-- order by finished_at, import_session_id.
-- Prisma schema cannot express partial indexes; keep this SQL-only.

CREATE INDEX "idx_import_executions_file_retention"
  ON "import_executions" ("finished_at", "import_session_id")
  WHERE "finished_at" IS NOT NULL
    AND "status" IN ('ready'::"import_execution_status", 'failed'::"import_execution_status");
