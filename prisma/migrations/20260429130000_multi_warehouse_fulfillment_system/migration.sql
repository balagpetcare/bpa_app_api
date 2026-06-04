-- Multi-Warehouse Fulfillment System (runs after allocation_plans + warehouses exist).
-- Replaces substantive DDL from 20260411180000 (placeholder). All changes additive.

-- 1. New enums (idempotent; duplicate_object if replayed)
DO $$ BEGIN CREATE TYPE "AllocationScope" AS ENUM ('SINGLE_SOURCE', 'MULTI_SOURCE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AllocationSourceStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PICKING', 'PICKED', 'DISPATCHED', 'CANCELLED', 'SKIPPED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BackorderStatus" AS ENUM ('OPEN', 'LINKED', 'PROCUREMENT_LINKED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CLOSED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Legacy installs may have BackorderStatus without LINKED (older migration body).
DO $bs$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BackorderStatus') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'BackorderStatus' AND e.enumlabel = 'LINKED') THEN
      ALTER TYPE "BackorderStatus" ADD VALUE 'LINKED';
    END IF;
  END IF;
END $bs$;

-- 2. Extend AllocationPlanStatus (PG-safe: no ADD VALUE IF NOT EXISTS)
DO $aps$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'AllocationPlanStatus' AND e.enumlabel = 'PARTIALLY_CONFIRMED') THEN
    ALTER TYPE "AllocationPlanStatus" ADD VALUE 'PARTIALLY_CONFIRMED';
  END IF;
END $aps$;
DO $aps2$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'AllocationPlanStatus' AND e.enumlabel = 'PARTIALLY_DISPATCHED') THEN
    ALTER TYPE "AllocationPlanStatus" ADD VALUE 'PARTIALLY_DISPATCHED';
  END IF;
END $aps2$;

-- 3. allocation_plans (camelCase column names per Prisma schema)
ALTER TABLE "allocation_plans" ADD COLUMN IF NOT EXISTS "allocationScope" "AllocationScope" NOT NULL DEFAULT 'SINGLE_SOURCE';
ALTER TABLE "allocation_plans" ADD COLUMN IF NOT EXISTS "sourceCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "allocation_plans" ADD COLUMN IF NOT EXISTS "parentPlanId" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "allocation_plans_parentPlanId_key" ON "allocation_plans"("parentPlanId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocation_plans_parentPlanId_fkey') THEN
    ALTER TABLE "allocation_plans" ADD CONSTRAINT "allocation_plans_parentPlanId_fkey"
      FOREIGN KEY ("parentPlanId") REFERENCES "allocation_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- From `20260411200000_backorder_status_linked` (moved here for ordering): one primary allocation plan per
-- stock request; supplementary rows use parentPlanId and are exempt from uniqueness on stockRequestId alone.
DROP INDEX IF EXISTS "allocation_plans_stockRequestId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "allocation_plans_one_primary_stock_request_uidx"
  ON "allocation_plans" ("stockRequestId")
  WHERE "parentPlanId" IS NULL AND "stockRequestId" IS NOT NULL;

-- 4. allocation_plan_lines.sourceWarehouseId
ALTER TABLE "allocation_plan_lines" ADD COLUMN IF NOT EXISTS "sourceWarehouseId" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocation_plan_lines_sourceWarehouseId_fkey') THEN
    ALTER TABLE "allocation_plan_lines" ADD CONSTRAINT "allocation_plan_lines_sourceWarehouseId_fkey"
      FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "allocation_plan_lines_allocationPlanId_locationId_idx" ON "allocation_plan_lines"("allocationPlanId", "locationId");

-- 5. allocation_source_summaries
CREATE TABLE IF NOT EXISTS "allocation_source_summaries" (
  "id" SERIAL NOT NULL,
  "orgId" INTEGER NOT NULL,
  "allocationPlanId" INTEGER NOT NULL,
  "locationId" INTEGER NOT NULL,
  "warehouseId" INTEGER,
  "totalAllocatedQty" INTEGER NOT NULL DEFAULT 0,
  "totalLineCount" INTEGER NOT NULL DEFAULT 0,
  "sourceStatus" "AllocationSourceStatus" NOT NULL DEFAULT 'PENDING',
  "confirmedAt" TIMESTAMP(3),
  "pickListId" INTEGER,
  "pickCompletedAt" TIMESTAMP(3),
  "dispatchId" INTEGER,
  "dispatchedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "allocation_source_summaries_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocation_source_summaries_allocationPlanId_fkey') THEN
    ALTER TABLE "allocation_source_summaries" ADD CONSTRAINT "allocation_source_summaries_allocationPlanId_fkey"
      FOREIGN KEY ("allocationPlanId") REFERENCES "allocation_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocation_source_summaries_locationId_fkey') THEN
    ALTER TABLE "allocation_source_summaries" ADD CONSTRAINT "allocation_source_summaries_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocation_source_summaries_warehouseId_fkey') THEN
    ALTER TABLE "allocation_source_summaries" ADD CONSTRAINT "allocation_source_summaries_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocation_source_summaries_pickListId_fkey') THEN
    ALTER TABLE "allocation_source_summaries" ADD CONSTRAINT "allocation_source_summaries_pickListId_fkey"
      FOREIGN KEY ("pickListId") REFERENCES "pick_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocation_source_summaries_dispatchId_fkey') THEN
    ALTER TABLE "allocation_source_summaries" ADD CONSTRAINT "allocation_source_summaries_dispatchId_fkey"
      FOREIGN KEY ("dispatchId") REFERENCES "stock_dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "allocation_source_summaries_allocationPlanId_locationId_key" ON "allocation_source_summaries"("allocationPlanId", "locationId");
CREATE UNIQUE INDEX IF NOT EXISTS "allocation_source_summaries_pickListId_key" ON "allocation_source_summaries"("pickListId");
CREATE UNIQUE INDEX IF NOT EXISTS "allocation_source_summaries_dispatchId_key" ON "allocation_source_summaries"("dispatchId");
CREATE INDEX IF NOT EXISTS "allocation_source_summaries_orgId_sourceStatus_idx" ON "allocation_source_summaries"("orgId", "sourceStatus");
CREATE INDEX IF NOT EXISTS "allocation_source_summaries_warehouseId_sourceStatus_idx" ON "allocation_source_summaries"("warehouseId", "sourceStatus");

-- 6. backorders
CREATE TABLE IF NOT EXISTS "backorders" (
  "id" SERIAL NOT NULL,
  "orgId" INTEGER NOT NULL,
  "stockRequestId" INTEGER NOT NULL,
  "stockRequestItemId" INTEGER,
  "allocationPlanId" INTEGER NOT NULL,
  "variantId" INTEGER NOT NULL,
  "shortageQty" INTEGER NOT NULL,
  "fulfilledQty" INTEGER NOT NULL DEFAULT 0,
  "remainingQty" INTEGER NOT NULL DEFAULT 0,
  "status" "BackorderStatus" NOT NULL DEFAULT 'OPEN',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "procurementDemandLineId" INTEGER,
  "supplementaryPlanId" INTEGER,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "backorders_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backorders_orgId_fkey') THEN
    ALTER TABLE "backorders" ADD CONSTRAINT "backorders_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backorders_stockRequestId_fkey') THEN
    ALTER TABLE "backorders" ADD CONSTRAINT "backorders_stockRequestId_fkey"
      FOREIGN KEY ("stockRequestId") REFERENCES "stock_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backorders_stockRequestItemId_fkey') THEN
    ALTER TABLE "backorders" ADD CONSTRAINT "backorders_stockRequestItemId_fkey"
      FOREIGN KEY ("stockRequestItemId") REFERENCES "stock_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backorders_allocationPlanId_fkey') THEN
    ALTER TABLE "backorders" ADD CONSTRAINT "backorders_allocationPlanId_fkey"
      FOREIGN KEY ("allocationPlanId") REFERENCES "allocation_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backorders_variantId_fkey') THEN
    ALTER TABLE "backorders" ADD CONSTRAINT "backorders_variantId_fkey"
      FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backorders_procurementDemandLineId_fkey') THEN
    ALTER TABLE "backorders" ADD CONSTRAINT "backorders_procurementDemandLineId_fkey"
      FOREIGN KEY ("procurementDemandLineId") REFERENCES "procurement_demand_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backorders_supplementaryPlanId_fkey') THEN
    ALTER TABLE "backorders" ADD CONSTRAINT "backorders_supplementaryPlanId_fkey"
      FOREIGN KEY ("supplementaryPlanId") REFERENCES "allocation_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "backorders_orgId_status_idx" ON "backorders"("orgId", "status");
CREATE INDEX IF NOT EXISTS "backorders_stockRequestId_idx" ON "backorders"("stockRequestId");
CREATE INDEX IF NOT EXISTS "backorders_variantId_status_idx" ON "backorders"("variantId", "status");
