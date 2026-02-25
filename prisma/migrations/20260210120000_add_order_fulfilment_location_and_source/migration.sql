-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('ONLINE', 'POS', 'CLINIC', 'OTHER');

-- AlterEnum (StockLedgerType: add SALE_CLINIC for clinic medicine sale ledger)
ALTER TYPE "StockLedgerType" ADD VALUE 'SALE_CLINIC';

-- AlterTable (Order: add fulfilmentInventoryLocationId, orderSource; FK to inventory_locations)
ALTER TABLE "orders" ADD COLUMN "fulfilmentInventoryLocationId" INTEGER,
ADD COLUMN "orderSource" "OrderSource";

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfilmentInventoryLocationId_fkey" 
  FOREIGN KEY ("fulfilmentInventoryLocationId") REFERENCES "inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "orders_fulfilmentInventoryLocationId_idx" ON "orders"("fulfilmentInventoryLocationId");
CREATE INDEX "orders_orderSource_idx" ON "orders"("orderSource");
