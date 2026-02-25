/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `donations` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ProductVersionStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('PENDING', 'APPROVED', 'ISSUED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SerialStatus" AS ENUM ('ISSUED', 'ACTIVATED', 'SOLD', 'VOID', 'RECALLED');

-- CreateEnum
CREATE TYPE "ScanAction" AS ENUM ('PRODUCED', 'SHIPPED', 'RECEIVED', 'SOLD', 'VERIFY');

-- CreateEnum
CREATE TYPE "ScanActorRole" AS ENUM ('FACTORY', 'DISTRIBUTOR', 'RETAILER', 'CUSTOMER', 'ADMIN');

-- CreateTable
CREATE TABLE "factories" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" TEXT,
    "addressJson" JSONB,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_lines" (
    "id" SERIAL NOT NULL,
    "factoryId" INTEGER NOT NULL,
    "lineCode" TEXT NOT NULL,
    "deviceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_versions" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ProductVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "specJson" JSONB,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_templates" (
    "id" SERIAL NOT NULL,
    "productVersionId" INTEGER NOT NULL,
    "templateJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packaging_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_fingerprints" (
    "id" SERIAL NOT NULL,
    "productVersionId" INTEGER NOT NULL,
    "textHash" TEXT,
    "imageHash" TEXT,
    "specHash" TEXT,
    "similarityScore" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "allowedCountries" JSONB,
    "channels" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_plans" (
    "id" SERIAL NOT NULL,
    "contractId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "perMonth" INTEGER,
    "perBatch" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quota_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_usages" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "issuedQty" INTEGER NOT NULL DEFAULT 0,
    "remainingQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quota_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" SERIAL NOT NULL,
    "productVersionId" INTEGER NOT NULL,
    "factoryId" INTEGER NOT NULL,
    "lineId" INTEGER,
    "status" "BatchStatus" NOT NULL DEFAULT 'PENDING',
    "requestedQty" INTEGER NOT NULL,
    "approvedQty" INTEGER,
    "mfgDate" TIMESTAMP(3),
    "expDate" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serial_ranges" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByUserId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',

    CONSTRAINT "serial_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serials" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "serialCode" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "status" "SerialStatus" NOT NULL DEFAULT 'ISSUED',
    "firstScanAt" TIMESTAMP(3),
    "firstScanCountry" TEXT,
    "firstScanDevice" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_events" (
    "id" SERIAL NOT NULL,
    "serialId" INTEGER NOT NULL,
    "actorRole" "ScanActorRole" NOT NULL,
    "action" "ScanAction" NOT NULL,
    "countryCode" TEXT,
    "deviceId" TEXT,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "factories_orgId_idx" ON "factories"("orgId");

-- CreateIndex
CREATE INDEX "production_lines_factoryId_idx" ON "production_lines"("factoryId");

-- CreateIndex
CREATE UNIQUE INDEX "production_lines_factoryId_lineCode_key" ON "production_lines"("factoryId", "lineCode");

-- CreateIndex
CREATE INDEX "product_versions_productId_status_idx" ON "product_versions"("productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_versions_productId_version_key" ON "product_versions"("productId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_templates_productVersionId_key" ON "packaging_templates"("productVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "product_fingerprints_productVersionId_key" ON "product_fingerprints"("productVersionId");

-- CreateIndex
CREATE INDEX "contracts_orgId_idx" ON "contracts"("orgId");

-- CreateIndex
CREATE INDEX "quota_plans_contractId_idx" ON "quota_plans"("contractId");

-- CreateIndex
CREATE INDEX "quota_plans_productId_idx" ON "quota_plans"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "quota_usages_batchId_key" ON "quota_usages"("batchId");

-- CreateIndex
CREATE INDEX "batches_productVersionId_idx" ON "batches"("productVersionId");

-- CreateIndex
CREATE INDEX "batches_factoryId_idx" ON "batches"("factoryId");

-- CreateIndex
CREATE INDEX "batches_status_idx" ON "batches"("status");

-- CreateIndex
CREATE INDEX "serial_ranges_batchId_idx" ON "serial_ranges"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "serials_serialCode_key" ON "serials"("serialCode");

-- CreateIndex
CREATE INDEX "serials_batchId_idx" ON "serials"("batchId");

-- CreateIndex
CREATE INDEX "scan_events_serialId_createdAt_idx" ON "scan_events"("serialId", "createdAt");

-- CreateIndex (guarded: may already exist)
CREATE UNIQUE INDEX IF NOT EXISTS "donations_idempotencyKey_key" ON "donations"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "factories" ADD CONSTRAINT "factories_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_templates" ADD CONSTRAINT "packaging_templates_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "product_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_fingerprints" ADD CONSTRAINT "product_fingerprints_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "product_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_plans" ADD CONSTRAINT "quota_plans_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_plans" ADD CONSTRAINT "quota_plans_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_usages" ADD CONSTRAINT "quota_usages_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "product_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_ranges" ADD CONSTRAINT "serial_ranges_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_ranges" ADD CONSTRAINT "serial_ranges_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serials" ADD CONSTRAINT "serials_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_serialId_fkey" FOREIGN KEY ("serialId") REFERENCES "serials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ads_status_dates_idx" RENAME TO "ads_status_startAt_endAt_idx";
