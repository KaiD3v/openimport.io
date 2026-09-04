-- Additive retention state for CSV object cleanup after terminal import sessions.
-- Does not delete sessions, executions, records, results, or webhook deliveries.

ALTER TABLE "import_sessions"
  ADD COLUMN "storage_deleted_at" TIMESTAMPTZ(6),
  ADD COLUMN "storage_cleanup_claimed_at" TIMESTAMPTZ(6),
  ADD COLUMN "storage_cleanup_claim_token" UUID;

CREATE INDEX "idx_import_sessions_file_retention"
  ON "import_sessions" ("status", "storage_cleanup_claimed_at")
  WHERE "storage_object_key" IS NOT NULL
    AND "storage_deleted_at" IS NULL;
