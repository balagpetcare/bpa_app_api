-- Warehouse Phase 1: rack/bin hierarchy + stock request line on transfer items
-- Non-destructive: additive columns and tables only.

CREATE TABLE "warehouse_racks" (
    "id" SERIAL NOT NULL,
    "zoneId" INTEGER NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_racks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "warehouse_bins" (
    "id" SERIAL NOT NULL,
    "rackId" INTEGER NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_bins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "warehouse_racks_zoneId_code_key" ON "warehouse_racks"("zoneId", "code");

CREATE INDEX "warehouse_racks_zoneId_isActive_idx" ON "warehouse_racks"("zoneId", "isActive");

CREATE UNIQUE INDEX "warehouse_bins_rackId_code_key" ON "warehouse_bins"("rackId", "code");

CREATE INDEX "warehouse_bins_rackId_isActive_idx" ON "warehouse_bins"("rackId", "isActive");

-- FK to warehouse_zones deferred: table is created in 20260430140000_warehouse_phase4_qc_zones_audit.
-- Applied in 20260430140100_warehouse_racks_zone_id_fkey_deferred.

ALTER TABLE "warehouse_bins" ADD CONSTRAINT "warehouse_bins_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "warehouse_racks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_locations" ADD COLUMN "binId" INTEGER;

CREATE INDEX "inventory_locations_binId_idx" ON "inventory_locations"("binId");

ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_binId_fkey" FOREIGN KEY ("binId") REFERENCES "warehouse_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_items" ADD COLUMN "stockRequestItemId" INTEGER;

CREATE INDEX "stock_transfer_items_stockRequestItemId_idx" ON "stock_transfer_items"("stockRequestItemId");

ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_stockRequestItemId_fkey" FOREIGN KEY ("stockRequestItemId") REFERENCES "stock_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
