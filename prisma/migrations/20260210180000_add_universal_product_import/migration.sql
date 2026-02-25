-- CreateEnum
CREATE TYPE "ProductPublishStatus" AS ENUM ('DRAFT', 'NEEDS_FIX', 'READY_TO_PUBLISH', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ProductImportSourceType" AS ENUM ('CSV', 'EXCEL', 'API');

-- CreateEnum
CREATE TYPE "ProductImportBatchStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductImportRowStatus" AS ENUM ('READY', 'NEEDS_FIX', 'ERROR');

-- CreateEnum
CREATE TYPE "IntegrationMappingType" AS ENUM ('CATEGORY', 'SUBCATEGORY', 'BRAND', 'UNIT');

-- AlterTable: Product - add publishStatus, validationIssues, importMeta
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "publishStatus" "ProductPublishStatus" DEFAULT 'DRAFT';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "validationIssues" JSONB;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "importMeta" JSONB;
CREATE INDEX IF NOT EXISTS "products_publishStatus_idx" ON "products"("publishStatus");

-- CreateTable: product_import_batches
CREATE TABLE "product_import_batches" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "sourceType" "ProductImportSourceType" NOT NULL,
    "provider" TEXT,
    "filename" TEXT,
    "status" "ProductImportBatchStatus" NOT NULL DEFAULT 'PENDING',
    "totals" JSONB,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable: product_import_rows
CREATE TABLE "product_import_rows" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "externalProductKey" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "status" "ProductImportRowStatus" NOT NULL DEFAULT 'ERROR',
    "issues" JSONB,
    "matchedProductId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable: integration_mappings
CREATE TABLE "integration_mappings" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "type" "IntegrationMappingType" NOT NULL,
    "externalValue" TEXT NOT NULL,
    "internalId" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_mappings_pkey" PRIMARY KEY ("id")
);

-- Foreign keys and indexes
CREATE INDEX "product_import_batches_orgId_status_idx" ON "product_import_batches"("orgId", "status");
CREATE INDEX "product_import_batches_createdAt_idx" ON "product_import_batches"("createdAt");
CREATE INDEX "product_import_rows_batchId_status_idx" ON "product_import_rows"("batchId", "status");
CREATE INDEX "product_import_rows_matchedProductId_idx" ON "product_import_rows"("matchedProductId");
CREATE UNIQUE INDEX "integration_mappings_orgId_provider_type_externalValue_key" ON "integration_mappings"("orgId", "provider", "type", "externalValue");
CREATE INDEX "integration_mappings_orgId_provider_type_idx" ON "integration_mappings"("orgId", "provider", "type");

ALTER TABLE "product_import_batches" ADD CONSTRAINT "product_import_batches_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_import_batches" ADD CONSTRAINT "product_import_batches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_import_batches" ADD CONSTRAINT "product_import_batches_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_import_rows" ADD CONSTRAINT "product_import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "product_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_import_rows" ADD CONSTRAINT "product_import_rows_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "integration_mappings" ADD CONSTRAINT "integration_mappings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
