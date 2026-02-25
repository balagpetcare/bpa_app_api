-- Phase 1: GRN, GrnLine, CatalogEnableRequest, StockLedgerType.GRN_IN, InventoryLocationType.CENTRAL_WAREHOUSE

-- Enum: add GRN_IN to StockLedgerType
ALTER TYPE "StockLedgerType" ADD VALUE 'GRN_IN';

-- Enum: add CENTRAL_WAREHOUSE to InventoryLocationType
ALTER TYPE "InventoryLocationType" ADD VALUE 'CENTRAL_WAREHOUSE';

-- CreateEnum GrnStatus
CREATE TYPE "GrnStatus" AS ENUM ('DRAFT', 'RECEIVED');

-- CreateEnum CatalogEnableRequestStatus
CREATE TYPE "CatalogEnableRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable grns
CREATE TABLE "grns" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "status" "GrnStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "receivedAt" TIMESTAMP(3),
    "receivedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grns_pkey" PRIMARY KEY ("id")
);

-- CreateTable grn_lines
CREATE TABLE "grn_lines" (
    "id" SERIAL NOT NULL,
    "grnId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lotId" INTEGER,
    "lotCode" TEXT,
    "mfgDate" TIMESTAMP(3),
    "expDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grn_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable catalog_enable_requests
CREATE TABLE "catalog_enable_requests" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "requestedPrice" DECIMAL(10,2),
    "status" "CatalogEnableRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" INTEGER NOT NULL,
    "reviewedByUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_enable_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grns_orgId_idx" ON "grns"("orgId");
CREATE INDEX "grns_vendorId_idx" ON "grns"("vendorId");
CREATE INDEX "grns_locationId_idx" ON "grns"("locationId");
CREATE INDEX "grns_status_idx" ON "grns"("status");
CREATE INDEX "grns_createdAt_idx" ON "grns"("createdAt");

CREATE INDEX "grn_lines_grnId_idx" ON "grn_lines"("grnId");
CREATE INDEX "grn_lines_variantId_idx" ON "grn_lines"("variantId");
CREATE INDEX "grn_lines_lotId_idx" ON "grn_lines"("lotId");

CREATE INDEX "catalog_enable_requests_orgId_idx" ON "catalog_enable_requests"("orgId");
CREATE INDEX "catalog_enable_requests_branchId_idx" ON "catalog_enable_requests"("branchId");
CREATE INDEX "catalog_enable_requests_status_idx" ON "catalog_enable_requests"("status");
CREATE INDEX "catalog_enable_requests_createdAt_idx" ON "catalog_enable_requests"("createdAt");

-- AddForeignKey grns
ALTER TABLE "grns" ADD CONSTRAINT "grns_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grns" ADD CONSTRAINT "grns_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grns" ADD CONSTRAINT "grns_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grns" ADD CONSTRAINT "grns_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey grn_lines
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "grns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey catalog_enable_requests
ALTER TABLE "catalog_enable_requests" ADD CONSTRAINT "catalog_enable_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_enable_requests" ADD CONSTRAINT "catalog_enable_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_enable_requests" ADD CONSTRAINT "catalog_enable_requests_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catalog_enable_requests" ADD CONSTRAINT "catalog_enable_requests_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catalog_enable_requests" ADD CONSTRAINT "catalog_enable_requests_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "catalog_enable_requests" ADD CONSTRAINT "catalog_enable_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catalog_enable_requests" ADD CONSTRAINT "catalog_enable_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- StockRequest: approve with partial + extra items
ALTER TABLE "stock_requests" ADD COLUMN IF NOT EXISTS "approvedItems" JSONB;
ALTER TABLE "stock_requests" ADD COLUMN IF NOT EXISTS "extraItems" JSONB;
ALTER TABLE "stock_requests" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "stock_requests" ADD COLUMN IF NOT EXISTS "approvedByUserId" INTEGER;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'stock_requests_approvedByUserId_fkey' AND table_name = 'stock_requests'
  ) THEN
    ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_approvedByUserId_fkey"
      FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
