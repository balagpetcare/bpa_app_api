/*
  Warnings:

  - A unique constraint covering the columns `[ownerUserId,delegatedUserId,scopeKey,orgId,branchId]` on the table `owner_delegations` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "StockCountSessionStatus" AS ENUM ('DRAFT', 'FROZEN', 'SUBMITTED', 'POSTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InventoryLocationType" ADD VALUE 'BRANCH_STORE';
ALTER TYPE "InventoryLocationType" ADD VALUE 'CLINIC_STORE';
ALTER TYPE "InventoryLocationType" ADD VALUE 'DAMAGE_AREA';
ALTER TYPE "InventoryLocationType" ADD VALUE 'RETURN_AREA';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockLedgerType" ADD VALUE 'PURCHASE_IN';
ALTER TYPE "StockLedgerType" ADD VALUE 'PRODUCTION_IN';

-- DropForeignKey
ALTER TABLE "grns" DROP CONSTRAINT "grns_vendorId_fkey";

-- AlterTable
ALTER TABLE "grn_lines" ADD COLUMN     "unitCost" DECIMAL(12,4);

-- AlterTable
ALTER TABLE "grns" ADD COLUMN     "invoiceDate" TIMESTAMP(3),
ADD COLUMN     "invoiceNo" VARCHAR(120);

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "requiresExpiry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresLot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresMfg" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "stock_adjustment_requests" ADD COLUMN     "adjustmentCategory" VARCHAR(32);

-- CreateTable
CREATE TABLE "stock_count_sessions" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "status" "StockCountSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdByUserId" INTEGER,
    "frozenAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_count_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "systemQty" INTEGER NOT NULL DEFAULT 0,
    "countedQty" INTEGER NOT NULL DEFAULT 0,
    "varianceQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_count_sessions_orgId_idx" ON "stock_count_sessions"("orgId");

-- CreateIndex
CREATE INDEX "stock_count_sessions_locationId_idx" ON "stock_count_sessions"("locationId");

-- CreateIndex
CREATE INDEX "stock_count_sessions_status_idx" ON "stock_count_sessions"("status");

-- CreateIndex
CREATE INDEX "stock_count_lines_sessionId_idx" ON "stock_count_lines"("sessionId");

-- CreateIndex
CREATE INDEX "stock_count_lines_variantId_idx" ON "stock_count_lines"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_sessionId_variantId_key" ON "stock_count_lines"("sessionId", "variantId");

-- Skip: owner_delegations unique index already exists in DB (would fail with relation already exists)

-- AddForeignKey
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "stock_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grns" ADD CONSTRAINT "grns_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
