-- Phase 3: Purchase orders, allocation plans, pick lists, proof of delivery, GRN→PO link
--
-- medicine_requisitions must exist before allocation_plans FK (shadow DB replays migrations in order;
-- these tables were in schema without an earlier migration).

CREATE TYPE "MedicineRequisitionStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'READY_TO_DISPATCH',
  'DISPATCHED',
  'IN_TRANSIT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "MedicineRequisitionUrgency" AS ENUM ('NORMAL', 'URGENT', 'CRITICAL');

CREATE TABLE "medicine_requisitions" (
    "id" SERIAL NOT NULL,
    "requisitionNumber" TEXT NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "requestedByUserId" INTEGER NOT NULL,
    "urgency" "MedicineRequisitionUrgency" NOT NULL DEFAULT 'NORMAL',
    "status" "MedicineRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "reviewedByUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" INTEGER,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "stockDispatchId" INTEGER,
    "stockTransferId" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" INTEGER,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_requisitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "medicine_requisitions_requisitionNumber_key" ON "medicine_requisitions"("requisitionNumber");
CREATE INDEX "medicine_requisitions_orgId_idx" ON "medicine_requisitions"("orgId");
CREATE INDEX "medicine_requisitions_branchId_idx" ON "medicine_requisitions"("branchId");
CREATE INDEX "medicine_requisitions_status_idx" ON "medicine_requisitions"("status");
CREATE INDEX "medicine_requisitions_urgency_idx" ON "medicine_requisitions"("urgency");
CREATE INDEX "medicine_requisitions_createdAt_idx" ON "medicine_requisitions"("createdAt");

ALTER TABLE "medicine_requisitions" ADD CONSTRAINT "medicine_requisitions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medicine_requisitions" ADD CONSTRAINT "medicine_requisitions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medicine_requisitions" ADD CONSTRAINT "medicine_requisitions_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medicine_requisitions" ADD CONSTRAINT "medicine_requisitions_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medicine_requisitions" ADD CONSTRAINT "medicine_requisitions_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medicine_requisitions" ADD CONSTRAINT "medicine_requisitions_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medicine_requisitions" ADD CONSTRAINT "medicine_requisitions_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medicine_requisitions" ADD CONSTRAINT "medicine_requisitions_stockDispatchId_fkey" FOREIGN KEY ("stockDispatchId") REFERENCES "stock_dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medicine_requisitions" ADD CONSTRAINT "medicine_requisitions_stockTransferId_fkey" FOREIGN KEY ("stockTransferId") REFERENCES "stock_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "medicine_requisition_items" (
    "id" SERIAL NOT NULL,
    "requisitionId" INTEGER NOT NULL,
    "medicineListingId" INTEGER NOT NULL,
    "productId" INTEGER,
    "variantId" INTEGER,
    "requestedQty" INTEGER NOT NULL,
    "approvedQty" INTEGER,
    "dispensedQty" INTEGER,
    "receivedQty" INTEGER,
    "unit" VARCHAR(50),
    "note" VARCHAR(500),
    "allowSubstitute" BOOLEAN NOT NULL DEFAULT false,
    "substitutedListingId" INTEGER,
    "substitutionReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_requisition_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "medicine_requisition_items_requisitionId_idx" ON "medicine_requisition_items"("requisitionId");
CREATE INDEX "medicine_requisition_items_medicineListingId_idx" ON "medicine_requisition_items"("medicineListingId");

ALTER TABLE "medicine_requisition_items" ADD CONSTRAINT "medicine_requisition_items_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "medicine_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medicine_requisition_items" ADD CONSTRAINT "medicine_requisition_items_medicineListingId_fkey" FOREIGN KEY ("medicineListingId") REFERENCES "country_medicine_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medicine_requisition_items" ADD CONSTRAINT "medicine_requisition_items_substitutedListingId_fkey" FOREIGN KEY ("substitutedListingId") REFERENCES "country_medicine_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medicine_requisition_items" ADD CONSTRAINT "medicine_requisition_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medicine_requisition_items" ADD CONSTRAINT "medicine_requisition_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "medicine_requisition_timeline" (
    "id" SERIAL NOT NULL,
    "requisitionId" INTEGER NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "performedByUserId" INTEGER,
    "note" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicine_requisition_timeline_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "medicine_requisition_timeline_requisitionId_createdAt_idx" ON "medicine_requisition_timeline"("requisitionId", "createdAt");

ALTER TABLE "medicine_requisition_timeline" ADD CONSTRAINT "medicine_requisition_timeline_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "medicine_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medicine_requisition_timeline" ADD CONSTRAINT "medicine_requisition_timeline_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED', 'REJECTED');
CREATE TYPE "AllocationPlanStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PICKING', 'PICKED', 'DISPATCHED', 'CANCELLED');
CREATE TYPE "PickListStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "purchase_orders" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "warehouseId" INTEGER,
    "poNumber" VARCHAR(80) NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(10),
    "subtotal" DECIMAL(14,2),
    "taxTotal" DECIMAL(14,2),
    "grandTotal" DECIMAL(14,2),
    "expectedDeliveryDate" TIMESTAMP(3),
    "notes" TEXT,
    "internalNote" TEXT,
    "createdByUserId" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" INTEGER,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_orders_orgId_poNumber_key" ON "purchase_orders"("orgId", "poNumber");
CREATE INDEX "purchase_orders_orgId_status_idx" ON "purchase_orders"("orgId", "status");
CREATE INDEX "purchase_orders_vendorId_idx" ON "purchase_orders"("vendorId");

CREATE TABLE "purchase_order_lines" (
    "id" SERIAL NOT NULL,
    "purchaseOrderId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "orderedQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,4),
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_order_lines_purchaseOrderId_idx" ON "purchase_order_lines"("purchaseOrderId");
CREATE INDEX "purchase_order_lines_variantId_idx" ON "purchase_order_lines"("variantId");

CREATE TABLE "allocation_plans" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "stockRequestId" INTEGER,
    "medicineRequisitionId" INTEGER,
    "fromLocationId" INTEGER NOT NULL,
    "warehouseId" INTEGER,
    "status" "AllocationPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allocation_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "allocation_plans_stockRequestId_key" ON "allocation_plans"("stockRequestId");
CREATE UNIQUE INDEX "allocation_plans_medicineRequisitionId_key" ON "allocation_plans"("medicineRequisitionId");
CREATE INDEX "allocation_plans_orgId_status_idx" ON "allocation_plans"("orgId", "status");

CREATE TABLE "allocation_plan_lines" (
    "id" SERIAL NOT NULL,
    "allocationPlanId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "quantityAllocated" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allocation_plan_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "allocation_plan_lines_allocationPlanId_idx" ON "allocation_plan_lines"("allocationPlanId");
CREATE INDEX "allocation_plan_lines_variantId_idx" ON "allocation_plan_lines"("variantId");
CREATE INDEX "allocation_plan_lines_lotId_idx" ON "allocation_plan_lines"("lotId");

CREATE TABLE "pick_lists" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "allocationPlanId" INTEGER NOT NULL,
    "status" "PickListStatus" NOT NULL DEFAULT 'DRAFT',
    "assignedPickerUserId" INTEGER,
    "fromLocationId" INTEGER NOT NULL,
    "stockDispatchId" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pick_lists_pkey" PRIMARY KEY ("id")
);

-- Non-unique: multiple pick lists per allocation plan (multi-wave dispatch). Consolidated ordering fix
-- replaces prior early migration `20260411191500_pick_lists_allow_multiple_per_allocation_plan`.
CREATE INDEX "pick_lists_allocationPlanId_idx" ON "pick_lists"("allocationPlanId");
CREATE UNIQUE INDEX "pick_lists_stockDispatchId_key" ON "pick_lists"("stockDispatchId");
CREATE INDEX "pick_lists_orgId_status_idx" ON "pick_lists"("orgId", "status");
CREATE INDEX "pick_lists_assignedPickerUserId_idx" ON "pick_lists"("assignedPickerUserId");

CREATE TABLE "pick_list_lines" (
    "id" SERIAL NOT NULL,
    "pickListId" INTEGER NOT NULL,
    "allocationPlanLineId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "quantityToPick" INTEGER NOT NULL,
    "quantityPicked" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pick_list_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pick_list_lines_pickListId_idx" ON "pick_list_lines"("pickListId");

CREATE TABLE "proof_of_deliveries" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "dispatchId" INTEGER NOT NULL,
    "deliveryAssignmentId" INTEGER,
    "recipientName" VARCHAR(200),
    "recipientPhone" VARCHAR(50),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "signatureFileKey" VARCHAR(512),
    "photoFileKey" VARCHAR(512),
    "gpsLat" DECIMAL(10,7),
    "gpsLng" DECIMAL(10,7),
    "recordedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proof_of_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proof_of_deliveries_dispatchId_key" ON "proof_of_deliveries"("dispatchId");
CREATE UNIQUE INDEX "proof_of_deliveries_deliveryAssignmentId_key" ON "proof_of_deliveries"("deliveryAssignmentId");
CREATE INDEX "proof_of_deliveries_orgId_idx" ON "proof_of_deliveries"("orgId");
CREATE INDEX "proof_of_deliveries_receivedAt_idx" ON "proof_of_deliveries"("receivedAt");

ALTER TABLE "grns" ADD COLUMN "purchaseOrderId" INTEGER;
CREATE INDEX "grns_purchaseOrderId_idx" ON "grns"("purchaseOrderId");

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "allocation_plans" ADD CONSTRAINT "allocation_plans_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allocation_plans" ADD CONSTRAINT "allocation_plans_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "stock_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allocation_plans" ADD CONSTRAINT "allocation_plans_medicineRequisitionId_fkey" FOREIGN KEY ("medicineRequisitionId") REFERENCES "medicine_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allocation_plans" ADD CONSTRAINT "allocation_plans_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocation_plans" ADD CONSTRAINT "allocation_plans_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "allocation_plans" ADD CONSTRAINT "allocation_plans_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "allocation_plan_lines" ADD CONSTRAINT "allocation_plan_lines_allocationPlanId_fkey" FOREIGN KEY ("allocationPlanId") REFERENCES "allocation_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allocation_plan_lines" ADD CONSTRAINT "allocation_plan_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocation_plan_lines" ADD CONSTRAINT "allocation_plan_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocation_plan_lines" ADD CONSTRAINT "allocation_plan_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pick_lists" ADD CONSTRAINT "pick_lists_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pick_lists" ADD CONSTRAINT "pick_lists_allocationPlanId_fkey" FOREIGN KEY ("allocationPlanId") REFERENCES "allocation_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pick_lists" ADD CONSTRAINT "pick_lists_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pick_lists" ADD CONSTRAINT "pick_lists_assignedPickerUserId_fkey" FOREIGN KEY ("assignedPickerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pick_lists" ADD CONSTRAINT "pick_lists_stockDispatchId_fkey" FOREIGN KEY ("stockDispatchId") REFERENCES "stock_dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pick_list_lines" ADD CONSTRAINT "pick_list_lines_pickListId_fkey" FOREIGN KEY ("pickListId") REFERENCES "pick_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pick_list_lines" ADD CONSTRAINT "pick_list_lines_allocationPlanLineId_fkey" FOREIGN KEY ("allocationPlanLineId") REFERENCES "allocation_plan_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pick_list_lines" ADD CONSTRAINT "pick_list_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pick_list_lines" ADD CONSTRAINT "pick_list_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pick_list_lines" ADD CONSTRAINT "pick_list_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "proof_of_deliveries" ADD CONSTRAINT "proof_of_deliveries_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proof_of_deliveries" ADD CONSTRAINT "proof_of_deliveries_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "stock_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proof_of_deliveries" ADD CONSTRAINT "proof_of_deliveries_deliveryAssignmentId_fkey" FOREIGN KEY ("deliveryAssignmentId") REFERENCES "delivery_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "proof_of_deliveries" ADD CONSTRAINT "proof_of_deliveries_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "grns" ADD CONSTRAINT "grns_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Deferred from 20260405120000: backfill vendor receive sessions for PO-only GRNs (column added above)
INSERT INTO "vendor_receive_sessions" ("orgId", "grnId", "status", "createdAt", "updatedAt")
SELECT g."orgId", g."id", 'DRAFT'::"VendorReceiveSessionStatus", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "grns" g
WHERE g."status" = 'DRAFT'
  AND g."stockDispatchId" IS NULL
  AND g."purchaseOrderId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "vendor_receive_sessions" v WHERE v."grnId" = g."id");

-- Deferred from 20260403140000 when `purchase_order_lines` did not exist yet
DO $$
BEGIN
  IF to_regclass('public.grn_lines') IS NOT NULL
     AND to_regclass('public.purchase_order_lines') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grn_lines_purchaseOrderLineId_fkey')
  THEN
    ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_purchaseOrderLineId_fkey"
      FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "grn_lines_purchaseOrderLineId_idx" ON "grn_lines" ("purchaseOrderLineId");

-- Deferred from 20260403163736_stock_request_procurement_intent
DO $$
BEGIN
  IF to_regclass('public.stock_requests') IS NOT NULL
     AND to_regclass('public.purchase_orders') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_requests_linkedPurchaseOrderId_fkey')
  THEN
    ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_linkedPurchaseOrderId_fkey"
      FOREIGN KEY ("linkedPurchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
