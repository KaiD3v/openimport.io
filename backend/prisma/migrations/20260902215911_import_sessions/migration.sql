-- CreateEnum
CREATE TYPE "import_session_status" AS ENUM ('created', 'uploaded', 'upload_failed');

-- CreateTable
CREATE TABLE "import_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "status" "import_session_status" NOT NULL DEFAULT 'created',
    "idempotency_key_hash" VARCHAR(64) NOT NULL,
    "request_fingerprint" VARCHAR(64) NOT NULL,
    "original_filename" VARCHAR(255),
    "byte_size" INTEGER,
    "content_sha256" VARCHAR(64),
    "encoding" VARCHAR(32),
    "delimiter" VARCHAR(8),
    "data_row_count" INTEGER,
    "storage_object_key" VARCHAR(512),
    "uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_columns" (
    "id" UUID NOT NULL,
    "import_session_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "import_columns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_import_sessions_organization_id" ON "import_sessions"("organization_id");

-- CreateIndex
CREATE INDEX "idx_import_sessions_organization_id_template_id" ON "import_sessions"("organization_id", "template_id");

-- CreateIndex
CREATE INDEX "idx_import_sessions_organization_id_id" ON "import_sessions"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_import_sessions_org_idempotency_key_hash" ON "import_sessions"("organization_id", "idempotency_key_hash");

-- CreateIndex
CREATE INDEX "idx_import_columns_import_session_id" ON "import_columns"("import_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_import_columns_session_id_position" ON "import_columns"("import_session_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "uq_import_columns_session_id_name" ON "import_columns"("import_session_id", "name");

-- AddForeignKey
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "import_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_columns" ADD CONSTRAINT "import_columns_import_session_id_fkey" FOREIGN KEY ("import_session_id") REFERENCES "import_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
