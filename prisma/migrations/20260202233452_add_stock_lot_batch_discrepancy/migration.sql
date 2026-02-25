-- CreateEnum
CREATE TYPE "StockDiscrepancyStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "StockAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "StockLedgerType" ADD VALUE 'LOSS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockTransferStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "StockTransferStatus" ADD VALUE 'DISPUTED';
ALTER TYPE "StockTransferStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "stock_ledgers" ADD COLUMN     "lotId" INTEGER;

-- AlterTable
ALTER TABLE "stock_transfer_items" ADD COLUMN     "lotId" INTEGER;

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "lotCode" TEXT NOT NULL,
    "mfgDate" TIMESTAMP(3) NOT NULL,
    "expDate" TIMESTAMP(3) NOT NULL,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lot_balances" (
    "locationId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "onHandQty" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_lot_balances_pkey" PRIMARY KEY ("locationId","lotId")
);

-- CreateTable
CREATE TABLE "stock_discrepancies" (
    "id" SERIAL NOT NULL,
    "transferId" INTEGER NOT NULL,
    "transferItemId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "expectedQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "missingQty" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "evidenceMediaIds" JSONB,
    "status" "StockDiscrepancyStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedByUserId" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_requests" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "quantityDelta" INTEGER NOT NULL,
    "reason" TEXT,
    "payload" JSONB,
    "status" "StockAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" INTEGER NOT NULL,
    "reviewedByUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_adjustment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_lots_orgId_idx" ON "stock_lots"("orgId");

-- CreateIndex
CREATE INDEX "stock_lots_variantId_idx" ON "stock_lots"("variantId");

-- CreateIndex
CREATE INDEX "stock_lots_expDate_idx" ON "stock_lots"("expDate");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lots_orgId_variantId_lotCode_key" ON "stock_lots"("orgId", "variantId", "lotCode");

-- CreateIndex
CREATE INDEX "stock_lot_balances_lotId_idx" ON "stock_lot_balances"("lotId");

-- CreateIndex
CREATE INDEX "stock_discrepancies_transferId_idx" ON "stock_discrepancies"("transferId");

-- CreateIndex
CREATE INDEX "stock_discrepancies_status_idx" ON "stock_discrepancies"("status");

-- CreateIndex
CREATE INDEX "stock_adjustment_requests_orgId_status_idx" ON "stock_adjustment_requests"("orgId", "status");

-- CreateIndex
CREATE INDEX "stock_adjustment_requests_locationId_idx" ON "stock_adjustment_requests"("locationId");

-- CreateIndex
CREATE INDEX "stock_ledgers_lotId_idx" ON "stock_ledgers"("lotId");

-- CreateIndex
CREATE INDEX "stock_transfer_items_lotId_idx" ON "stock_transfer_items"("lotId");

-- AddForeignKey
ALTER TABLE "stock_ledgers" ADD CONSTRAINT "stock_ledgers_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot_balances" ADD CONSTRAINT "stock_lot_balances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot_balances" ADD CONSTRAINT "stock_lot_balances_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_discrepancies" ADD CONSTRAINT "stock_discrepancies_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_discrepancies" ADD CONSTRAINT "stock_discrepancies_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_discrepancies" ADD CONSTRAINT "stock_discrepancies_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_discrepancies" ADD CONSTRAINT "stock_discrepancies_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_requests" ADD CONSTRAINT "stock_adjustment_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_requests" ADD CONSTRAINT "stock_adjustment_requests_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_requests" ADD CONSTRAINT "stock_adjustment_requests_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_requests" ADD CONSTRAINT "stock_adjustment_requests_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_requests" ADD CONSTRAINT "stock_adjustment_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_requests" ADD CONSTRAINT "stock_adjustment_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
