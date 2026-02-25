-- Product Import Hardening: progress fields + lastUsedAt on mappings
ALTER TABLE "product_import_batches" ADD COLUMN IF NOT EXISTS "processedRows" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "product_import_batches" ADD COLUMN IF NOT EXISTS "totalRows" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "product_import_batches" ADD COLUMN IF NOT EXISTS "progressPercent" DOUBLE PRECISION;
ALTER TABLE "product_import_batches" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "product_import_batches" ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMP(3);
ALTER TABLE "product_import_batches" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;

ALTER TABLE "integration_mappings" ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3);
