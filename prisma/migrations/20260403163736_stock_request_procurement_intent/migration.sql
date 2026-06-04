-- CreateEnum: StockRequestIntent
CREATE TYPE "StockRequestIntent" AS ENUM ('INTERNAL_TRANSFER', 'PROCUREMENT');

-- AlterTable: stock_requests — add procurement routing fields
ALTER TABLE "stock_requests" ADD COLUMN "requestIntent" "StockRequestIntent" NOT NULL DEFAULT 'INTERNAL_TRANSFER';
ALTER TABLE "stock_requests" ADD COLUMN "linkedPurchaseOrderId" INTEGER;
ALTER TABLE "stock_requests" ADD COLUMN "procurementNote" TEXT;
ALTER TABLE "stock_requests" ADD COLUMN "preferredVendorId" INTEGER;
ALTER TABLE "stock_requests" ADD COLUMN "urgency" VARCHAR(20);

-- CreateIndex
CREATE INDEX "stock_requests_requestIntent_idx" ON "stock_requests"("requestIntent");
CREATE INDEX "stock_requests_linkedPurchaseOrderId_idx" ON "stock_requests"("linkedPurchaseOrderId");

-- AddForeignKey: stock_requests.linkedPurchaseOrderId -> purchase_orders.id
-- Deferred to 20260429120000 — `purchase_orders` is created there (shadow ordering).

-- AddForeignKey: stock_requests.preferredVendorId -> vendors.id
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_preferredVendorId_fkey" FOREIGN KEY ("preferredVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
