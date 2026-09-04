-- CreateEnum
CREATE TYPE "webhook_delivery_status" AS ENUM ('pending', 'delivered', 'failed');

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "secret_ciphertext" TEXT NOT NULL,
    "secret_prefix" VARCHAR(24) NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "import_session_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "status" "webhook_delivery_status" NOT NULL DEFAULT 'pending',
    "destination_url" VARCHAR(2048) NOT NULL,
    "payload" JSONB NOT NULL,
    "job_id" VARCHAR(160) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(80),
    "delivered_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_webhook_endpoints_organization_id_event_type" ON "webhook_endpoints"("organization_id", "event_type");

-- CreateIndex
CREATE INDEX "idx_webhook_endpoints_organization_id_is_active" ON "webhook_endpoints"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "uq_webhook_deliveries_job_id" ON "webhook_deliveries"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_webhook_deliveries_org_execution_event_type" ON "webhook_deliveries"("organization_id", "execution_id", "event_type");

-- CreateIndex
CREATE INDEX "idx_webhook_deliveries_organization_id_id" ON "webhook_deliveries"("organization_id", "id");

-- CreateIndex
CREATE INDEX "idx_webhook_deliveries_status_created_at_id" ON "webhook_deliveries"("status", "created_at", "id");

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "import_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
