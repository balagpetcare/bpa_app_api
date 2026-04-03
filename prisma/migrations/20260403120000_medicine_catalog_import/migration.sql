-- Medicine catalog import: global core + country listings + admin staging

-- CreateEnum
CREATE TYPE "MedicineImportBatchStatus" AS ENUM (
  'UPLOADED',
  'PARSED',
  'PREVIEW_READY',
  'CONFIRMED',
  'APPLYING',
  'APPLIED',
  'PARTIALLY_APPLIED',
  'FAILED',
  'CANCELLED'
);

-- CreateEnum
CREATE TYPE "MedicineImportRowClassification" AS ENUM (
  'INVALID',
  'DUPLICATE_IN_FILE',
  'EXISTS_IN_DB',
  'NEW',
  'NEEDS_REVIEW'
);

-- CreateEnum
CREATE TYPE "MedicineImportRowApplyStatus" AS ENUM (
  'PENDING',
  'APPLIED',
  'SKIPPED',
  'FAILED'
);

-- CreateTable
CREATE TABLE "medicine_generics" (
    "id" SERIAL NOT NULL,
    "displayName" VARCHAR(512) NOT NULL,
    "normalizedKey" VARCHAR(256) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" INTEGER,
    "aliasesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_generics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_dosage_forms" (
    "id" SERIAL NOT NULL,
    "displayName" VARCHAR(128) NOT NULL,
    "normalizedKey" VARCHAR(128) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" INTEGER,
    "aliasesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_dosage_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_manufacturers" (
    "id" SERIAL NOT NULL,
    "displayName" VARCHAR(256) NOT NULL,
    "normalizedKey" VARCHAR(256) NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_brands" (
    "id" SERIAL NOT NULL,
    "manufacturerId" INTEGER NOT NULL,
    "displayName" VARCHAR(256) NOT NULL,
    "normalizedKey" VARCHAR(256) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" INTEGER,
    "aliasesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_presentations" (
    "id" SERIAL NOT NULL,
    "genericId" INTEGER NOT NULL,
    "dosageFormId" INTEGER NOT NULL,
    "strengthDisplay" VARCHAR(256) NOT NULL,
    "strengthNormalizedKey" VARCHAR(256) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_presentations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_import_batches" (
    "id" SERIAL NOT NULL,
    "countryId" INTEGER NOT NULL,
    "filename" VARCHAR(512) NOT NULL,
    "fileSha256" VARCHAR(64) NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "provider" VARCHAR(64) NOT NULL DEFAULT 'admin_csv',
    "status" "MedicineImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "previewVersion" INTEGER NOT NULL DEFAULT 0,
    "previewSummaryJson" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" INTEGER,
    "appliedAt" TIMESTAMP(3),
    "appliedByUserId" INTEGER,
    "applySummaryJson" JSONB,
    "errorMessage" TEXT,
    "uploadedByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_medicine_brands" (
    "id" SERIAL NOT NULL,
    "countryId" INTEGER NOT NULL,
    "presentationId" INTEGER NOT NULL,
    "brandId" INTEGER NOT NULL,
    "packageMarkDisplay" VARCHAR(512) NOT NULL DEFAULT '',
    "packageMarkNormalized" VARCHAR(256) NOT NULL DEFAULT '',
    "importFingerprint" VARCHAR(64) NOT NULL,
    "firstImportBatchId" INTEGER,
    "lastImportBatchId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" INTEGER,
    "deactivatedReason" VARCHAR(512),
    "workspaceProfileJson" JSONB,
    "reviewStatus" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_medicine_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_import_rows" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawPayloadJson" JSONB NOT NULL,
    "normalizedPayloadJson" JSONB,
    "issuesJson" JSONB,
    "rowFingerprint" VARCHAR(64) NOT NULL,
    "classification" "MedicineImportRowClassification" NOT NULL DEFAULT 'INVALID',
    "duplicateOfRowNumber" INTEGER,
    "applyStatus" "MedicineImportRowApplyStatus" NOT NULL DEFAULT 'PENDING',
    "applyDetailJson" JSONB,
    "countryMedicineBrandId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_import_entity_touches" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "entityType" VARCHAR(32) NOT NULL,
    "entityId" INTEGER NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "snapshotJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicine_import_entity_touches_pkey" PRIMARY KEY ("id")
);

-- Unique / indexes — core
CREATE UNIQUE INDEX "medicine_generics_normalizedKey_key" ON "medicine_generics"("normalizedKey");
CREATE INDEX "medicine_generics_normalizedKey_idx" ON "medicine_generics"("normalizedKey");
CREATE INDEX "medicine_generics_isActive_idx" ON "medicine_generics"("isActive");

CREATE UNIQUE INDEX "medicine_dosage_forms_normalizedKey_key" ON "medicine_dosage_forms"("normalizedKey");
CREATE INDEX "medicine_dosage_forms_normalizedKey_idx" ON "medicine_dosage_forms"("normalizedKey");
CREATE INDEX "medicine_dosage_forms_isActive_idx" ON "medicine_dosage_forms"("isActive");

CREATE UNIQUE INDEX "medicine_manufacturers_normalizedKey_key" ON "medicine_manufacturers"("normalizedKey");
CREATE INDEX "medicine_manufacturers_normalizedKey_idx" ON "medicine_manufacturers"("normalizedKey");
CREATE INDEX "medicine_manufacturers_isActive_idx" ON "medicine_manufacturers"("isActive");

CREATE UNIQUE INDEX "medicine_brands_manufacturerId_normalizedKey_key" ON "medicine_brands"("manufacturerId", "normalizedKey");
CREATE INDEX "medicine_brands_manufacturerId_idx" ON "medicine_brands"("manufacturerId");
CREATE INDEX "medicine_brands_isActive_idx" ON "medicine_brands"("isActive");

CREATE UNIQUE INDEX "medicine_presentations_genericId_dosageFormId_strengthNormalizedKey_key" ON "medicine_presentations"("genericId", "dosageFormId", "strengthNormalizedKey");
CREATE INDEX "medicine_presentations_genericId_idx" ON "medicine_presentations"("genericId");
CREATE INDEX "medicine_presentations_dosageFormId_idx" ON "medicine_presentations"("dosageFormId");
CREATE INDEX "medicine_presentations_isActive_idx" ON "medicine_presentations"("isActive");

-- Batches
CREATE INDEX "medicine_import_batches_countryId_status_createdAt_idx" ON "medicine_import_batches"("countryId", "status", "createdAt");
CREATE INDEX "medicine_import_batches_fileSha256_idx" ON "medicine_import_batches"("fileSha256");
CREATE INDEX "medicine_import_batches_uploadedByUserId_idx" ON "medicine_import_batches"("uploadedByUserId");

-- Country listings
CREATE UNIQUE INDEX "country_medicine_brands_countryId_importFingerprint_key" ON "country_medicine_brands"("countryId", "importFingerprint");
CREATE INDEX "country_medicine_brands_countryId_idx" ON "country_medicine_brands"("countryId");
CREATE INDEX "country_medicine_brands_presentationId_idx" ON "country_medicine_brands"("presentationId");
CREATE INDEX "country_medicine_brands_brandId_idx" ON "country_medicine_brands"("brandId");
CREATE INDEX "country_medicine_brands_countryId_archivedAt_idx" ON "country_medicine_brands"("countryId", "archivedAt");
CREATE INDEX "country_medicine_brands_reviewStatus_idx" ON "country_medicine_brands"("reviewStatus");

-- Staging rows
CREATE INDEX "medicine_import_rows_batchId_classification_idx" ON "medicine_import_rows"("batchId", "classification");
CREATE INDEX "medicine_import_rows_batchId_applyStatus_idx" ON "medicine_import_rows"("batchId", "applyStatus");
CREATE INDEX "medicine_import_rows_batchId_rowNumber_idx" ON "medicine_import_rows"("batchId", "rowNumber");
CREATE INDEX "medicine_import_rows_rowFingerprint_idx" ON "medicine_import_rows"("rowFingerprint");

CREATE INDEX "medicine_import_entity_touches_batchId_idx" ON "medicine_import_entity_touches"("batchId");
CREATE INDEX "medicine_import_entity_touches_entityType_entityId_idx" ON "medicine_import_entity_touches"("entityType", "entityId");

-- Foreign keys — core
ALTER TABLE "medicine_brands" ADD CONSTRAINT "medicine_brands_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "medicine_manufacturers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "medicine_presentations" ADD CONSTRAINT "medicine_presentations_genericId_fkey" FOREIGN KEY ("genericId") REFERENCES "medicine_generics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medicine_presentations" ADD CONSTRAINT "medicine_presentations_dosageFormId_fkey" FOREIGN KEY ("dosageFormId") REFERENCES "medicine_dosage_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Batches
ALTER TABLE "medicine_import_batches" ADD CONSTRAINT "medicine_import_batches_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medicine_import_batches" ADD CONSTRAINT "medicine_import_batches_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medicine_import_batches" ADD CONSTRAINT "medicine_import_batches_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medicine_import_batches" ADD CONSTRAINT "medicine_import_batches_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Country listings (after batches for FK)
ALTER TABLE "country_medicine_brands" ADD CONSTRAINT "country_medicine_brands_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "country_medicine_brands" ADD CONSTRAINT "country_medicine_brands_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "medicine_presentations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "country_medicine_brands" ADD CONSTRAINT "country_medicine_brands_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "medicine_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "country_medicine_brands" ADD CONSTRAINT "country_medicine_brands_firstImportBatchId_fkey" FOREIGN KEY ("firstImportBatchId") REFERENCES "medicine_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "country_medicine_brands" ADD CONSTRAINT "country_medicine_brands_lastImportBatchId_fkey" FOREIGN KEY ("lastImportBatchId") REFERENCES "medicine_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rows
ALTER TABLE "medicine_import_rows" ADD CONSTRAINT "medicine_import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "medicine_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medicine_import_rows" ADD CONSTRAINT "medicine_import_rows_countryMedicineBrandId_fkey" FOREIGN KEY ("countryMedicineBrandId") REFERENCES "country_medicine_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "medicine_import_entity_touches" ADD CONSTRAINT "medicine_import_entity_touches_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "medicine_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
