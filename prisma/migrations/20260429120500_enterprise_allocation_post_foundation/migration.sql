-- Consolidated DDL from migrations that ran before `allocation_plans` existed (shadow DB / fresh deploy fix).
-- Supersedes substantive content of:
--   20260404200000_enterprise_allocation_picking_enhancement
--   20260408140000_procurement_demand_lines_central_fulfillment
--   20260409180000_stock_transfer_enterprise_superseded_allocation_trigger
-- Those migrations are no-ops; this runs immediately after 20260429120000_warehouse_enterprise_po_allocation_pick_pod.

-- ---------------------------------------------------------------------------
-- A) Enterprise allocation & picking (from 20260404200000)
-- ---------------------------------------------------------------------------

DO $enum_alloc$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'AllocationPlanStatus' AND e.enumlabel = 'ALLOCATED') THEN
    ALTER TYPE "AllocationPlanStatus" ADD VALUE 'ALLOCATED';
  END IF;
END $enum_alloc$;
DO $enum_alloc2$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'AllocationPlanStatus' AND e.enumlabel = 'PARTIALLY_ALLOCATED') THEN
    ALTER TYPE "AllocationPlanStatus" ADD VALUE 'PARTIALLY_ALLOCATED';
  END IF;
END $enum_alloc2$;
DO $enum_alloc3$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'AllocationPlanStatus' AND e.enumlabel = 'ON_HOLD') THEN
    ALTER TYPE "AllocationPlanStatus" ADD VALUE 'ON_HOLD';
  END IF;
END $enum_alloc3$;
DO $enum_alloc4$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'AllocationPlanStatus' AND e.enumlabel = 'FAILED') THEN
    ALTER TYPE "AllocationPlanStatus" ADD VALUE 'FAILED';
  END IF;
END $enum_alloc4$;

ALTER TABLE "allocation_plans" ADD COLUMN IF NOT EXISTS "totalDemandQty" INTEGER;
ALTER TABLE "allocation_plans" ADD COLUMN IF NOT EXISTS "totalAllocatedQty" INTEGER;
ALTER TABLE "allocation_plans" ADD COLUMN IF NOT EXISTS "shortageQty" INTEGER;
ALTER TABLE "allocation_plans" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "allocation_plans" ADD COLUMN IF NOT EXISTS "allocationMethod" VARCHAR(32);

ALTER TABLE "allocation_plan_lines" ADD COLUMN IF NOT EXISTS "demandQty" INTEGER;
ALTER TABLE "allocation_plan_lines" ADD COLUMN IF NOT EXISTS "quantityShort" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "allocation_plan_lines" ADD COLUMN IF NOT EXISTS "lineStatus" VARCHAR(32);
ALTER TABLE "allocation_plan_lines" ADD COLUMN IF NOT EXISTS "allocationMethod" VARCHAR(32);

CREATE TABLE IF NOT EXISTS "allocation_plan_events" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "allocationPlanId" INTEGER NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "fromStatus" VARCHAR(32),
    "toStatus" VARCHAR(32),
    "metadata" JSONB,
    "performedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "allocation_plan_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "allocation_plan_events_orgId_idx" ON "allocation_plan_events"("orgId");
CREATE INDEX IF NOT EXISTS "allocation_plan_events_allocationPlanId_createdAt_idx" ON "allocation_plan_events"("allocationPlanId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocation_plan_events_orgId_fkey') THEN
    ALTER TABLE "allocation_plan_events" ADD CONSTRAINT "allocation_plan_events_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocation_plan_events_allocationPlanId_fkey') THEN
    ALTER TABLE "allocation_plan_events" ADD CONSTRAINT "allocation_plan_events_allocationPlanId_fkey"
      FOREIGN KEY ("allocationPlanId") REFERENCES "allocation_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocation_plan_events_performedByUserId_fkey') THEN
    ALTER TABLE "allocation_plan_events" ADD CONSTRAINT "allocation_plan_events_performedByUserId_fkey"
      FOREIGN KEY ("performedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- B) Procurement demand lines (from 20260408140000), aligned with schema.prisma
-- ---------------------------------------------------------------------------

DO $$ BEGIN CREATE TYPE "StockRequestItemBackorderStatus" AS ENUM ('NONE', 'PENDING_PROCUREMENT', 'PROCUREMENT_LINKED', 'READY_TO_FULFILL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ProcurementDemandStatus" AS ENUM ('PENDING', 'PO_LINKED', 'PARTIALLY_RECEIVED', 'FULFILLED', 'DISPATCHED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "stock_request_items" ADD COLUMN IF NOT EXISTS "backorderStatus" "StockRequestItemBackorderStatus" NOT NULL DEFAULT 'NONE';

CREATE INDEX IF NOT EXISTS "stock_request_items_backorderStatus_idx" ON "stock_request_items"("backorderStatus");

CREATE TABLE IF NOT EXISTS "procurement_demand_lines" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "stockRequestId" INTEGER NOT NULL,
    "stockRequestItemId" INTEGER NOT NULL,
    "allocationPlanId" INTEGER,
    "allocationPlanLineId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "demandQty" INTEGER NOT NULL,
    "fulfilledQty" INTEGER NOT NULL DEFAULT 0,
    "purchaseOrderId" INTEGER,
    "purchaseOrderLineId" INTEGER,
    "fulfillmentDispatchId" INTEGER,
    "status" "ProcurementDemandStatus" NOT NULL DEFAULT 'PENDING',
    "priority" VARCHAR(20),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "procurement_demand_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "procurement_demand_lines_stockRequestItemId_allocationPlanId_key" ON "procurement_demand_lines"("stockRequestItemId", "allocationPlanId");
CREATE INDEX IF NOT EXISTS "procurement_demand_lines_orgId_status_createdAt_idx" ON "procurement_demand_lines"("orgId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "procurement_demand_lines_purchaseOrderId_idx" ON "procurement_demand_lines"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "procurement_demand_lines_purchaseOrderLineId_idx" ON "procurement_demand_lines"("purchaseOrderLineId");
CREATE INDEX IF NOT EXISTS "procurement_demand_lines_variantId_status_idx" ON "procurement_demand_lines"("variantId", "status");
CREATE INDEX IF NOT EXISTS "procurement_demand_lines_stockRequestId_idx" ON "procurement_demand_lines"("stockRequestId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_demand_lines_orgId_fkey') THEN
    ALTER TABLE "procurement_demand_lines" ADD CONSTRAINT "procurement_demand_lines_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_demand_lines_stockRequestId_fkey') THEN
    ALTER TABLE "procurement_demand_lines" ADD CONSTRAINT "procurement_demand_lines_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "stock_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_demand_lines_stockRequestItemId_fkey') THEN
    ALTER TABLE "procurement_demand_lines" ADD CONSTRAINT "procurement_demand_lines_stockRequestItemId_fkey" FOREIGN KEY ("stockRequestItemId") REFERENCES "stock_request_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_demand_lines_allocationPlanId_fkey') THEN
    ALTER TABLE "procurement_demand_lines" ADD CONSTRAINT "procurement_demand_lines_allocationPlanId_fkey" FOREIGN KEY ("allocationPlanId") REFERENCES "allocation_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_demand_lines_allocationPlanLineId_fkey') THEN
    ALTER TABLE "procurement_demand_lines" ADD CONSTRAINT "procurement_demand_lines_allocationPlanLineId_fkey" FOREIGN KEY ("allocationPlanLineId") REFERENCES "allocation_plan_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_demand_lines_variantId_fkey') THEN
    ALTER TABLE "procurement_demand_lines" ADD CONSTRAINT "procurement_demand_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_demand_lines_purchaseOrderId_fkey') THEN
    ALTER TABLE "procurement_demand_lines" ADD CONSTRAINT "procurement_demand_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_demand_lines_purchaseOrderLineId_fkey') THEN
    ALTER TABLE "procurement_demand_lines" ADD CONSTRAINT "procurement_demand_lines_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_demand_lines_fulfillmentDispatchId_fkey') THEN
    ALTER TABLE "procurement_demand_lines" ADD CONSTRAINT "procurement_demand_lines_fulfillmentDispatchId_fkey" FOREIGN KEY ("fulfillmentDispatchId") REFERENCES "stock_dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- C) Legacy transfer supersede marker + trigger (from 20260409180000)
-- ---------------------------------------------------------------------------

ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "enterpriseSupersededAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "stock_transfers_enterpriseSupersededAt_idx" ON "stock_transfers" ("enterpriseSupersededAt");

CREATE OR REPLACE FUNCTION prevent_stock_transfer_when_allocation_plan_active()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."stockRequestId" IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM "allocation_plans" ap
      WHERE ap."stockRequestId" = NEW."stockRequestId"
        AND ap."status" <> 'CANCELLED'::"AllocationPlanStatus"
    ) THEN
      RAISE EXCEPTION 'STOCK_TRANSFER_BLOCKED_ACTIVE_ALLOCATION_PLAN: stock_request_id=%', NEW."stockRequestId"
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_transfers_block_active_allocation_plan ON "stock_transfers";
CREATE TRIGGER stock_transfers_block_active_allocation_plan
  BEFORE INSERT OR UPDATE OF "stockRequestId" ON "stock_transfers"
  FOR EACH ROW
  EXECUTE PROCEDURE prevent_stock_transfer_when_allocation_plan_active();

-- ---------------------------------------------------------------------------
-- D) Deferred from 20260402140000_wave2 when purchase_orders did not exist yet
-- ---------------------------------------------------------------------------

ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "purchaseRequisitionId" INTEGER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_requisitions') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_purchaseRequisitionId_fkey') THEN
      ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_purchaseRequisitionId_fkey" FOREIGN KEY ("purchaseRequisitionId") REFERENCES "purchase_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "purchase_orders_purchaseRequisitionId_idx" ON "purchase_orders"("purchaseRequisitionId");

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_orders')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inbound_shipments') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_shipments_purchaseOrderId_fkey') THEN
      ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_order_lines')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inbound_shipment_lines') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_shipment_lines_purchaseOrderLineId_fkey') THEN
      ALTER TABLE "inbound_shipment_lines" ADD CONSTRAINT "inbound_shipment_lines_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_order_lines')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inbound_discrepancies') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_discrepancies_purchaseOrderLineId_fkey') THEN
      ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Deferred wave2 → warehouses FKs (warehouses table is created in 20260428150000; wave2 runs earlier)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'warehouses')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vendors') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_preferredWarehouseId_fkey') THEN
      ALTER TABLE "vendors" ADD CONSTRAINT "vendors_preferredWarehouseId_fkey" FOREIGN KEY ("preferredWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'warehouses')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_requisitions') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requisitions_warehouseId_fkey') THEN
      ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'warehouses')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inbound_shipments') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_shipments_shipToWarehouseId_fkey') THEN
      ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_shipToWarehouseId_fkey" FOREIGN KEY ("shipToWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'warehouses')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'putaway_tasks') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'putaway_tasks_warehouseId_fkey') THEN
      ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
