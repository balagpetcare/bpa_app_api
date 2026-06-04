-- Enterprise hardening: composite indexes for tenant-scoped warehouse queries,
-- ledger reporting, stock-lot FEFO paths, and multi-wave stock requests.
-- Non-destructive (indexes only).
--
-- `inventory_locations.warehouseId` and table `warehouses` are created in
-- 20260428150000_central_warehouse_foundation (runs after this timestamp in the chain).
-- Guard those indexes so shadow DB / fresh replay succeeds.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_locations' AND column_name = 'warehouseId'
  ) THEN
    CREATE INDEX IF NOT EXISTS "inventory_locations_warehouseId_isActive_idx"
      ON "inventory_locations" ("warehouseId", "isActive");
    CREATE INDEX IF NOT EXISTS "inventory_locations_branchId_warehouseId_idx"
      ON "inventory_locations" ("branchId", "warehouseId");
  END IF;
END $$;

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

DO $$
BEGIN
  IF to_regclass('public.warehouses') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "warehouses_orgId_isActive_idx"
      ON "warehouses" ("orgId", "isActive");
  END IF;
END $$;
