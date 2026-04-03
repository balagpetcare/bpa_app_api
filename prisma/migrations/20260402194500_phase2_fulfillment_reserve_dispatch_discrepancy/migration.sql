-- Phase 2: Fulfillment ledger types + dispatch discrepancy records
ALTER TYPE "StockLedgerType" ADD VALUE 'RESERVE_FULFILLMENT';
ALTER TYPE "StockLedgerType" ADD VALUE 'RELEASE_FULFILLMENT_RESERVE';

CREATE TABLE "stock_dispatch_discrepancies" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "stockDispatchId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "reasonCode" VARCHAR(64) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "status" "StockDiscrepancyStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedByUserId" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_dispatch_discrepancies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_dispatch_discrepancies_orgId_idx" ON "stock_dispatch_discrepancies"("orgId");
CREATE INDEX "stock_dispatch_discrepancies_stockDispatchId_idx" ON "stock_dispatch_discrepancies"("stockDispatchId");
CREATE INDEX "stock_dispatch_discrepancies_status_idx" ON "stock_dispatch_discrepancies"("status");

ALTER TABLE "stock_dispatch_discrepancies" ADD CONSTRAINT "stock_dispatch_discrepancies_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_dispatch_discrepancies" ADD CONSTRAINT "stock_dispatch_discrepancies_stockDispatchId_fkey" FOREIGN KEY ("stockDispatchId") REFERENCES "stock_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_dispatch_discrepancies" ADD CONSTRAINT "stock_dispatch_discrepancies_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_dispatch_discrepancies" ADD CONSTRAINT "stock_dispatch_discrepancies_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_dispatch_discrepancies" ADD CONSTRAINT "stock_dispatch_discrepancies_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
