-- CreateTable
CREATE TABLE "import_access_tokens" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "import_session_id" UUID NOT NULL,
    "issuer_api_key_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "token_prefix" VARCHAR(24) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_import_access_tokens_token_hash" ON "import_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_import_access_tokens_import_session_id" ON "import_access_tokens"("import_session_id");

-- CreateIndex
CREATE INDEX "idx_import_access_tokens_organization_id" ON "import_access_tokens"("organization_id");

-- CreateIndex
CREATE INDEX "idx_import_access_tokens_expires_at" ON "import_access_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "import_access_tokens" ADD CONSTRAINT "import_access_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_access_tokens" ADD CONSTRAINT "import_access_tokens_import_session_id_fkey" FOREIGN KEY ("import_session_id") REFERENCES "import_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_access_tokens" ADD CONSTRAINT "import_access_tokens_issuer_api_key_id_fkey" FOREIGN KEY ("issuer_api_key_id") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
