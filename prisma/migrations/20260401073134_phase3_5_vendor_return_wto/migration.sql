-- CreateEnum
CREATE TYPE "WriteOffReason" AS ENUM ('DAMAGE', 'THEFT', 'OBSOLETE', 'SAMPLE', 'OTHER');

-- CreateEnum
CREATE TYPE "WriteOffRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'POSTED');

-- CreateEnum
CREATE TYPE "VendorReturnStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'DISPATCHED', 'RECEIVED_BY_VENDOR', 'CREDITED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WarehouseTransferOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'PICKING', 'IN_TRANSIT', 'RECEIVED', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockLedgerType" ADD VALUE 'RECALL_QUARANTINE';
ALTER TYPE "StockLedgerType" ADD VALUE 'QC_QUARANTINE_RELEASE';
ALTER TYPE "StockLedgerType" ADD VALUE 'QC_QUARANTINE_DISPOSE';
ALTER TYPE "StockLedgerType" ADD VALUE 'WRITE_OFF';

-- CreateTable
CREATE TABLE "write_off_requests" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "reason" "WriteOffReason" NOT NULL,
    "status" "WriteOffRequestStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "totalQty" INTEGER NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(12,2),
    "requestedByUserId" INTEGER NOT NULL,
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "write_off_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "write_off_request_lines" (
    "id" SERIAL NOT NULL,
    "writeOffRequestId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,4),
    "note" TEXT,
    "ledgerId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "write_off_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_returns" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "status" "VendorReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" VARCHAR(500) NOT NULL,
    "note" TEXT,
    "creditExpected" DECIMAL(12,2),
    "creditReceived" DECIMAL(12,2),
    "referenceNumber" VARCHAR(100),
    "dispatchedAt" TIMESTAMP(3),
    "receivedByVendorAt" TIMESTAMP(3),
    "creditedAt" TIMESTAMP(3),
    "createdByUserId" INTEGER NOT NULL,
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_return_lines" (
    "id" SERIAL NOT NULL,
    "vendorReturnId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,4),
    "condition" VARCHAR(50) NOT NULL DEFAULT 'RESELLABLE',
    "note" VARCHAR(500),
    "ledgerId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_transfer_orders" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "fromLocationId" INTEGER NOT NULL,
    "toLocationId" INTEGER NOT NULL,
    "status" "WarehouseTransferOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdByUserId" INTEGER NOT NULL,
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_transfer_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_transfer_order_lines" (
    "id" SERIAL NOT NULL,
    "warehouseTransferOrderId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "requestedQty" INTEGER NOT NULL,
    "pickedQty" INTEGER NOT NULL DEFAULT 0,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(500),
    "outboundLedgerId" INTEGER,
    "inboundLedgerId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_transfer_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "write_off_requests_orgId_status_idx" ON "write_off_requests"("orgId", "status");

-- CreateIndex
CREATE INDEX "write_off_requests_locationId_idx" ON "write_off_requests"("locationId");

-- CreateIndex
CREATE INDEX "write_off_requests_requestedByUserId_idx" ON "write_off_requests"("requestedByUserId");

-- CreateIndex
CREATE INDEX "write_off_request_lines_writeOffRequestId_idx" ON "write_off_request_lines"("writeOffRequestId");

-- CreateIndex
CREATE INDEX "write_off_request_lines_variantId_idx" ON "write_off_request_lines"("variantId");

-- CreateIndex
CREATE INDEX "write_off_request_lines_lotId_idx" ON "write_off_request_lines"("lotId");

-- CreateIndex
CREATE INDEX "vendor_returns_orgId_status_idx" ON "vendor_returns"("orgId", "status");

-- CreateIndex
CREATE INDEX "vendor_returns_vendorId_idx" ON "vendor_returns"("vendorId");

-- CreateIndex
CREATE INDEX "vendor_returns_locationId_idx" ON "vendor_returns"("locationId");

-- CreateIndex
CREATE INDEX "vendor_return_lines_vendorReturnId_idx" ON "vendor_return_lines"("vendorReturnId");

-- CreateIndex
CREATE INDEX "vendor_return_lines_variantId_idx" ON "vendor_return_lines"("variantId");

-- CreateIndex
CREATE INDEX "warehouse_transfer_orders_orgId_status_idx" ON "warehouse_transfer_orders"("orgId", "status");

-- CreateIndex
CREATE INDEX "warehouse_transfer_orders_fromLocationId_idx" ON "warehouse_transfer_orders"("fromLocationId");

-- CreateIndex
CREATE INDEX "warehouse_transfer_orders_toLocationId_idx" ON "warehouse_transfer_orders"("toLocationId");

-- CreateIndex
CREATE INDEX "warehouse_transfer_order_lines_warehouseTransferOrderId_idx" ON "warehouse_transfer_order_lines"("warehouseTransferOrderId");

-- CreateIndex
CREATE INDEX "warehouse_transfer_order_lines_variantId_idx" ON "warehouse_transfer_order_lines"("variantId");

-- AddForeignKey
ALTER TABLE "write_off_requests" ADD CONSTRAINT "write_off_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "write_off_requests" ADD CONSTRAINT "write_off_requests_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "write_off_requests" ADD CONSTRAINT "write_off_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "write_off_requests" ADD CONSTRAINT "write_off_requests_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "write_off_request_lines" ADD CONSTRAINT "write_off_request_lines_writeOffRequestId_fkey" FOREIGN KEY ("writeOffRequestId") REFERENCES "write_off_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "write_off_request_lines" ADD CONSTRAINT "write_off_request_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "write_off_request_lines" ADD CONSTRAINT "write_off_request_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "write_off_request_lines" ADD CONSTRAINT "write_off_request_lines_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "stock_ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_returns" ADD CONSTRAINT "vendor_returns_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_returns" ADD CONSTRAINT "vendor_returns_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_returns" ADD CONSTRAINT "vendor_returns_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_returns" ADD CONSTRAINT "vendor_returns_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_returns" ADD CONSTRAINT "vendor_returns_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_return_lines" ADD CONSTRAINT "vendor_return_lines_vendorReturnId_fkey" FOREIGN KEY ("vendorReturnId") REFERENCES "vendor_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_return_lines" ADD CONSTRAINT "vendor_return_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_return_lines" ADD CONSTRAINT "vendor_return_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_return_lines" ADD CONSTRAINT "vendor_return_lines_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "stock_ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_orders" ADD CONSTRAINT "warehouse_transfer_orders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_orders" ADD CONSTRAINT "warehouse_transfer_orders_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_orders" ADD CONSTRAINT "warehouse_transfer_orders_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_orders" ADD CONSTRAINT "warehouse_transfer_orders_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_orders" ADD CONSTRAINT "warehouse_transfer_orders_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_order_lines" ADD CONSTRAINT "warehouse_transfer_order_lines_warehouseTransferOrderId_fkey" FOREIGN KEY ("warehouseTransferOrderId") REFERENCES "warehouse_transfer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_order_lines" ADD CONSTRAINT "warehouse_transfer_order_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_order_lines" ADD CONSTRAINT "warehouse_transfer_order_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_order_lines" ADD CONSTRAINT "warehouse_transfer_order_lines_outboundLedgerId_fkey" FOREIGN KEY ("outboundLedgerId") REFERENCES "stock_ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_transfer_order_lines" ADD CONSTRAINT "warehouse_transfer_order_lines_inboundLedgerId_fkey" FOREIGN KEY ("inboundLedgerId") REFERENCES "stock_ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
