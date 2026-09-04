-- Snapshot the endpoint signing-secret ciphertext onto each delivery.
-- Existing rows are backfilled from the associated endpoint, then the column
-- becomes NOT NULL. Ciphertext is copied as-is (AES-GCM blob); plaintext is
-- never persisted. Indexes and foreign keys from 20260904072000_webhook_import_ready
-- are unchanged.

ALTER TABLE "webhook_deliveries" ADD COLUMN "secret_ciphertext" TEXT;

UPDATE "webhook_deliveries" AS d
SET "secret_ciphertext" = e."secret_ciphertext"
FROM "webhook_endpoints" AS e
WHERE d."endpoint_id" = e."id"
  AND d."secret_ciphertext" IS NULL;

ALTER TABLE "webhook_deliveries" ALTER COLUMN "secret_ciphertext" SET NOT NULL;
