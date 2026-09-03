-- AlterTable
ALTER TABLE "import_sessions" ADD COLUMN     "mapping" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "mapping_revision" INTEGER NOT NULL DEFAULT 0;
