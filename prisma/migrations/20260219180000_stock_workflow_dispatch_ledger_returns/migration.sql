-- Stock workflow: StockDispatch, StockDispatchItem, StockLedger orgId/unitCost, Grn.stockDispatchId, StockReturn/StockReturnItem, StockRequestStatus additions

-- StockRequestStatus: add APPROVED, PARTIALLY_DISPATCHED (run once; re-run may error if values exist)
ALTER TYPE "StockRequestStatus" ADD VALUE 'APPROVED';
ALTER TYPE "StockRequestStatus" ADD VALUE 'PARTIALLY_DISPATCHED';

-- StockDispatchStatus enum
CREATE TYPE "StockDispatchStatus" AS ENUM ('CREATED', 'PACKED', 'IN_TRANSIT', 'DELIVERED');

-- StockLedger: add orgId, unitCost
ALTER TABLE "stock_ledgers" ADD COLUMN IF NOT EXISTS "orgId" INTEGER;
ALTER TABLE "stock_ledgers" ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL(12,4);
CREATE INDEX IF NOT EXISTS "stock_ledgers_orgId_idx" ON "stock_ledgers"("orgId");
ALTER TABLE "stock_ledgers" ADD CONSTRAINT "stock_ledgers_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- StockDispatch table
CREATE TABLE "stock_dispatches" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "stockRequestId" INTEGER NOT NULL,
    "fromLocationId" INTEGER NOT NULL,
    "toLocationId" INTEGER NOT NULL,
    "status" "StockDispatchStatus" NOT NULL DEFAULT 'CREATED',
    "carrierType" VARCHAR(50),
    "vehicleNo" VARCHAR(100),
    "driverName" VARCHAR(200),
    "driverPhone" VARCHAR(50),
    "trackingId" VARCHAR(200),
    "eta" TIMESTAMP(3),
    "shippingCost" DECIMAL(12,2),
    "note" TEXT,
    "packedAt" TIMESTAMP(3),
    "inTransitAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_dispatches_pkey" PRIMARY KEY ("id")
);

-- StockDispatchItem table
CREATE TABLE "stock_dispatch_items" (
    "id" SERIAL NOT NULL,
    "stockDispatchId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "quantityDispatched" INTEGER NOT NULL,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "quantityDamaged" INTEGER NOT NULL DEFAULT 0,
    "quantityShort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_dispatch_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_dispatches_orgId_idx" ON "stock_dispatches"("orgId");
CREATE INDEX "stock_dispatches_stockRequestId_idx" ON "stock_dispatches"("stockRequestId");
CREATE INDEX "stock_dispatches_fromLocationId_idx" ON "stock_dispatches"("fromLocationId");
CREATE INDEX "stock_dispatches_toLocationId_idx" ON "stock_dispatches"("toLocationId");
CREATE INDEX "stock_dispatches_status_idx" ON "stock_dispatches"("status");
CREATE INDEX "stock_dispatches_createdAt_idx" ON "stock_dispatches"("createdAt");

CREATE INDEX "stock_dispatch_items_stockDispatchId_idx" ON "stock_dispatch_items"("stockDispatchId");
CREATE INDEX "stock_dispatch_items_variantId_idx" ON "stock_dispatch_items"("variantId");
CREATE INDEX "stock_dispatch_items_lotId_idx" ON "stock_dispatch_items"("lotId");

ALTER TABLE "stock_dispatches" ADD CONSTRAINT "stock_dispatches_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_dispatches" ADD CONSTRAINT "stock_dispatches_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "stock_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_dispatches" ADD CONSTRAINT "stock_dispatches_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_dispatches" ADD CONSTRAINT "stock_dispatches_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_dispatches" ADD CONSTRAINT "stock_dispatches_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_dispatch_items" ADD CONSTRAINT "stock_dispatch_items_stockDispatchId_fkey" FOREIGN KEY ("stockDispatchId") REFERENCES "stock_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_dispatch_items" ADD CONSTRAINT "stock_dispatch_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_dispatch_items" ADD CONSTRAINT "stock_dispatch_items_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grn: optional stockDispatchId, vendorId nullable
ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "stockDispatchId" INTEGER;
ALTER TABLE "grns" ALTER COLUMN "vendorId" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "grns_stockDispatchId_idx" ON "grns"("stockDispatchId");
ALTER TABLE "grns" ADD CONSTRAINT "grns_stockDispatchId_fkey" FOREIGN KEY ("stockDispatchId") REFERENCES "stock_dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- StockReturn enums and tables
CREATE TYPE "StockReturnReason" AS ENUM ('DAMAGED', 'WRONG_ITEM', 'NEAR_EXPIRY', 'OVERSTOCK', 'OTHER');
CREATE TYPE "StockReturnStatus" AS ENUM ('CREATED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

CREATE TABLE "stock_returns" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "fromLocationId" INTEGER NOT NULL,
    "toLocationId" INTEGER NOT NULL,
    "reason" "StockReturnReason" NOT NULL,
    "status" "StockReturnStatus" NOT NULL DEFAULT 'CREATED',
    "note" TEXT,
    "createdByUserId" INTEGER,
    "receivedAt" TIMESTAMP(3),
    "receivedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_return_items" (
    "id" SERIAL NOT NULL,
    "stockReturnId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "quantityReturned" INTEGER NOT NULL,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_return_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_returns_orgId_idx" ON "stock_returns"("orgId");
CREATE INDEX "stock_returns_fromLocationId_idx" ON "stock_returns"("fromLocationId");
CREATE INDEX "stock_returns_toLocationId_idx" ON "stock_returns"("toLocationId");
CREATE INDEX "stock_returns_status_idx" ON "stock_returns"("status");
CREATE INDEX "stock_returns_createdAt_idx" ON "stock_returns"("createdAt");

CREATE INDEX "stock_return_items_stockReturnId_idx" ON "stock_return_items"("stockReturnId");
CREATE INDEX "stock_return_items_variantId_idx" ON "stock_return_items"("variantId");
CREATE INDEX "stock_return_items_lotId_idx" ON "stock_return_items"("lotId");

ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_return_items" ADD CONSTRAINT "stock_return_items_stockReturnId_fkey" FOREIGN KEY ("stockReturnId") REFERENCES "stock_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_return_items" ADD CONSTRAINT "stock_return_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_return_items" ADD CONSTRAINT "stock_return_items_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
