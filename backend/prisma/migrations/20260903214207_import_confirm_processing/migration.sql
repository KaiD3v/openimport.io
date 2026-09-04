-- CreateEnum
CREATE TYPE "import_execution_status" AS ENUM ('queued', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "import_record_classification" AS ENUM ('valid', 'invalid');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "import_session_status" ADD VALUE 'queued';
ALTER TYPE "import_session_status" ADD VALUE 'processing';
ALTER TYPE "import_session_status" ADD VALUE 'ready';
ALTER TYPE "import_session_status" ADD VALUE 'processing_failed';

-- AlterTable
ALTER TABLE "import_sessions" ADD COLUMN     "confirmed_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "import_executions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "import_session_id" UUID NOT NULL,
    "status" "import_execution_status" NOT NULL DEFAULT 'queued',
    "confirmation_fingerprint" VARCHAR(64) NOT NULL,
    "expected_mapping_revision" INTEGER NOT NULL,
    "expected_content_sha256" VARCHAR(64) NOT NULL,
    "job_id" VARCHAR(160) NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "total_rows" INTEGER,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(80),
    "error_message" VARCHAR(500),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "import_session_id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "record_number" INTEGER NOT NULL,
    "classification" "import_record_classification" NOT NULL,
    "payload" JSONB,
    "errors" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_import_executions_job_id" ON "import_executions"("job_id");

-- CreateIndex
CREATE INDEX "idx_import_executions_org_session" ON "import_executions"("organization_id", "import_session_id");

-- CreateIndex
CREATE INDEX "idx_import_executions_org_id" ON "import_executions"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_import_executions_session_fingerprint" ON "import_executions"("import_session_id", "confirmation_fingerprint");

-- CreateIndex
CREATE INDEX "idx_import_records_org_session_class_record" ON "import_records"("organization_id", "import_session_id", "classification", "record_number");

-- CreateIndex
CREATE INDEX "idx_import_records_org_execution" ON "import_records"("organization_id", "execution_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_import_records_execution_record_number" ON "import_records"("execution_id", "record_number");

-- AddForeignKey
ALTER TABLE "import_executions" ADD CONSTRAINT "import_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_executions" ADD CONSTRAINT "import_executions_import_session_id_fkey" FOREIGN KEY ("import_session_id") REFERENCES "import_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_import_session_id_fkey" FOREIGN KEY ("import_session_id") REFERENCES "import_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "import_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
