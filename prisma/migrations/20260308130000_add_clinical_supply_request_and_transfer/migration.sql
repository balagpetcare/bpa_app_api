-- CreateTable: clinical_supply_requests
CREATE TABLE IF NOT EXISTS "clinical_supply_requests" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "requestNo" VARCHAR(32) NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "priority" VARCHAR(24) NOT NULL DEFAULT 'ROUTINE',
    "status" VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    "note" VARCHAR(512),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_supply_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "clinical_supply_requests_requestNo_key" ON "clinical_supply_requests"("requestNo");
CREATE INDEX IF NOT EXISTS "clinical_supply_requests_orgId_idx" ON "clinical_supply_requests"("orgId");
CREATE INDEX IF NOT EXISTS "clinical_supply_requests_branchId_idx" ON "clinical_supply_requests"("branchId");
CREATE INDEX IF NOT EXISTS "clinical_supply_requests_status_idx" ON "clinical_supply_requests"("status");

ALTER TABLE "clinical_supply_requests" ADD CONSTRAINT "clinical_supply_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_supply_requests" ADD CONSTRAINT "clinical_supply_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_supply_requests" ADD CONSTRAINT "clinical_supply_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_supply_requests" ADD CONSTRAINT "clinical_supply_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: clinical_supply_request_items
CREATE TABLE IF NOT EXISTS "clinical_supply_request_items" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "clinicalItemId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "requestedQty" INTEGER NOT NULL,
    "approvedQty" INTEGER,
    "fulfilledQty" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(256),

    CONSTRAINT "clinical_supply_request_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "clinical_supply_request_items_requestId_idx" ON "clinical_supply_request_items"("requestId");

ALTER TABLE "clinical_supply_request_items" ADD CONSTRAINT "clinical_supply_request_items_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "clinical_supply_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_supply_request_items" ADD CONSTRAINT "clinical_supply_request_items_clinicalItemId_fkey" FOREIGN KEY ("clinicalItemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_supply_request_items" ADD CONSTRAINT "clinical_supply_request_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "clinical_item_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: clinical_stock_transfers
CREATE TABLE IF NOT EXISTS "clinical_stock_transfers" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "transferNo" VARCHAR(32) NOT NULL,
    "supplyRequestId" INTEGER,
    "fromBranchId" INTEGER NOT NULL,
    "toBranchId" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'CREATED',
    "dispatchedById" INTEGER,
    "receivedById" INTEGER,
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_stock_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "clinical_stock_transfers_transferNo_key" ON "clinical_stock_transfers"("transferNo");
CREATE INDEX IF NOT EXISTS "clinical_stock_transfers_orgId_idx" ON "clinical_stock_transfers"("orgId");
CREATE INDEX IF NOT EXISTS "clinical_stock_transfers_fromBranchId_idx" ON "clinical_stock_transfers"("fromBranchId");
CREATE INDEX IF NOT EXISTS "clinical_stock_transfers_toBranchId_idx" ON "clinical_stock_transfers"("toBranchId");
CREATE INDEX IF NOT EXISTS "clinical_stock_transfers_supplyRequestId_idx" ON "clinical_stock_transfers"("supplyRequestId");
CREATE INDEX IF NOT EXISTS "clinical_stock_transfers_status_idx" ON "clinical_stock_transfers"("status");

ALTER TABLE "clinical_stock_transfers" ADD CONSTRAINT "clinical_stock_transfers_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_transfers" ADD CONSTRAINT "clinical_stock_transfers_supplyRequestId_fkey" FOREIGN KEY ("supplyRequestId") REFERENCES "clinical_supply_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_transfers" ADD CONSTRAINT "clinical_stock_transfers_fromBranchId_fkey" FOREIGN KEY ("fromBranchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_transfers" ADD CONSTRAINT "clinical_stock_transfers_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: clinical_stock_transfer_items
CREATE TABLE IF NOT EXISTS "clinical_stock_transfer_items" (
    "id" SERIAL NOT NULL,
    "transferId" INTEGER NOT NULL,
    "clinicalItemId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "batchNo" VARCHAR(64),
    "expiryDate" DATE,
    "qtySent" INTEGER NOT NULL,
    "qtyReceived" INTEGER,
    "qtyDamaged" INTEGER,

    CONSTRAINT "clinical_stock_transfer_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "clinical_stock_transfer_items_transferId_idx" ON "clinical_stock_transfer_items"("transferId");

ALTER TABLE "clinical_stock_transfer_items" ADD CONSTRAINT "clinical_stock_transfer_items_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "clinical_stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_transfer_items" ADD CONSTRAINT "clinical_stock_transfer_items_clinicalItemId_fkey" FOREIGN KEY ("clinicalItemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_transfer_items" ADD CONSTRAINT "clinical_stock_transfer_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "clinical_item_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
