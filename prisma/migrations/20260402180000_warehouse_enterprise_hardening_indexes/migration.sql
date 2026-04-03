-- Enterprise hardening: composite indexes for tenant-scoped warehouse queries,
-- ledger reporting, stock-lot FEFO paths, and multi-wave stock requests.
-- Non-destructive (indexes only).

CREATE INDEX IF NOT EXISTS "inventory_locations_warehouseId_isActive_idx"
  ON "inventory_locations" ("warehouseId", "isActive");

CREATE INDEX IF NOT EXISTS "inventory_locations_branchId_warehouseId_idx"
  ON "inventory_locations" ("branchId", "warehouseId");

CREATE INDEX IF NOT EXISTS "stock_ledgers_orgId_locationId_createdAt_idx"
  ON "stock_ledgers" ("orgId", "locationId", "createdAt");

CREATE INDEX IF NOT EXISTS "stock_ledgers_orgId_variantId_createdAt_idx"
  ON "stock_ledgers" ("orgId", "variantId", "createdAt");

CREATE INDEX IF NOT EXISTS "stock_ledgers_orgId_lotId_idx"
  ON "stock_ledgers" ("orgId", "lotId");

CREATE INDEX IF NOT EXISTS "stock_transfers_stockRequestId_status_idx"
  ON "stock_transfers" ("stockRequestId", "status");

CREATE INDEX IF NOT EXISTS "stock_transfers_stockRequestId_status_createdAt_idx"
  ON "stock_transfers" ("stockRequestId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "stock_lots_orgId_variantId_idx"
  ON "stock_lots" ("orgId", "variantId");

CREATE INDEX IF NOT EXISTS "stock_lots_orgId_variantId_expDate_idx"
  ON "stock_lots" ("orgId", "variantId", "expDate");

CREATE INDEX IF NOT EXISTS "warehouses_orgId_isActive_idx"
  ON "warehouses" ("orgId", "isActive");
