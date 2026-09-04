-- CreateEnum
CREATE TYPE "import_client_result_outcome" AS ENUM ('accepted', 'rejected');

-- CreateTable
CREATE TABLE "import_result_batches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "import_session_id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "idempotency_key_hash" VARCHAR(64) NOT NULL,
    "request_fingerprint" VARCHAR(64) NOT NULL,
    "item_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_result_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_record_results" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "import_session_id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "record_number" INTEGER NOT NULL,
    "outcome" "import_client_result_outcome" NOT NULL,
    "client_record_id" VARCHAR(128),
    "error_code" VARCHAR(64),
    "error_message" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_record_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_import_result_batches_org_idempotency_key_hash" ON "import_result_batches"("organization_id", "idempotency_key_hash");

-- CreateIndex
CREATE INDEX "idx_import_result_batches_org_session" ON "import_result_batches"("organization_id", "import_session_id");

-- CreateIndex
CREATE INDEX "idx_import_result_batches_org_execution" ON "import_result_batches"("organization_id", "execution_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_import_record_results_execution_record_number" ON "import_record_results"("execution_id", "record_number");

-- CreateIndex
CREATE INDEX "idx_import_record_results_org_session" ON "import_record_results"("organization_id", "import_session_id");

-- CreateIndex
CREATE INDEX "idx_import_record_results_org_execution_outcome" ON "import_record_results"("organization_id", "execution_id", "outcome");

-- CreateIndex
CREATE INDEX "idx_import_record_results_batch_id" ON "import_record_results"("batch_id");

-- AddForeignKey
ALTER TABLE "import_result_batches" ADD CONSTRAINT "import_result_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_result_batches" ADD CONSTRAINT "import_result_batches_import_session_id_fkey" FOREIGN KEY ("import_session_id") REFERENCES "import_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_result_batches" ADD CONSTRAINT "import_result_batches_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "import_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_record_results" ADD CONSTRAINT "import_record_results_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_record_results" ADD CONSTRAINT "import_record_results_import_session_id_fkey" FOREIGN KEY ("import_session_id") REFERENCES "import_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_record_results" ADD CONSTRAINT "import_record_results_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "import_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_record_results" ADD CONSTRAINT "import_record_results_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_result_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
