-- Wave-2: Purchase requisitions, inbound shipments, putaway, vendor/bin extensions, GRN links

-- CreateEnum
CREATE TYPE "PurchaseRequisitionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "InboundShipmentStatus" AS ENUM ('ANNOUNCED', 'IN_TRANSIT', 'ARRIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PutawayTaskStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InboundDiscrepancyStatus" AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED');

-- AlterTable vendors
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "defaultLeadTimeDays" INTEGER;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "minOrderValue" DECIMAL(14,2);
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "currencyPreference" VARCHAR(10);
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "asnSupported" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "deliveryWindowsJson" JSONB;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "preferredWarehouseId" INTEGER;

-- AlterTable warehouse_bins
ALTER TABLE "warehouse_bins" ADD COLUMN IF NOT EXISTS "maxUnits" INTEGER;
ALTER TABLE "warehouse_bins" ADD COLUMN IF NOT EXISTS "allowMixedSku" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "warehouse_bins" ADD COLUMN IF NOT EXISTS "storageClass" VARCHAR(32);

-- AlterTable purchase_orders
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "purchaseRequisitionId" INTEGER;

-- AlterTable grns
ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "inboundShipmentId" INTEGER;

-- AlterTable grn_lines
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "inboundShipmentLineId" INTEGER;
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "lineDiscrepancyNote" VARCHAR(500);

-- AddForeignKey vendors -> warehouses
DO $$ BEGIN
 ALTER TABLE "vendors" ADD CONSTRAINT "vendors_preferredWarehouseId_fkey" FOREIGN KEY ("preferredWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable purchase_requisitions
CREATE TABLE IF NOT EXISTS "purchase_requisitions" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "prNumber" VARCHAR(80) NOT NULL,
    "status" "PurchaseRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "warehouseId" INTEGER,
    "vendorId" INTEGER,
    "notes" TEXT,
    "requestedByUserId" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" INTEGER,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_requisitions_orgId_prNumber_key" ON "purchase_requisitions"("orgId", "prNumber");
CREATE INDEX IF NOT EXISTS "purchase_requisitions_orgId_status_idx" ON "purchase_requisitions"("orgId", "status");

ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable purchase_requisition_lines
CREATE TABLE IF NOT EXISTS "purchase_requisition_lines" (
    "id" SERIAL NOT NULL,
    "purchaseRequisitionId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "requestedQty" INTEGER NOT NULL,
    "convertedQty" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,4),
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requisition_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "purchase_requisition_lines_purchaseRequisitionId_idx" ON "purchase_requisition_lines"("purchaseRequisitionId");
CREATE INDEX IF NOT EXISTS "purchase_requisition_lines_variantId_idx" ON "purchase_requisition_lines"("variantId");

ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_purchaseRequisitionId_fkey" FOREIGN KEY ("purchaseRequisitionId") REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK purchase_orders -> purchase_requisitions
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_purchaseRequisitionId_fkey" FOREIGN KEY ("purchaseRequisitionId") REFERENCES "purchase_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "purchase_orders_purchaseRequisitionId_idx" ON "purchase_orders"("purchaseRequisitionId");

-- CreateTable inbound_shipments
CREATE TABLE IF NOT EXISTS "inbound_shipments" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "purchaseOrderId" INTEGER,
    "reference" VARCHAR(120) NOT NULL,
    "status" "InboundShipmentStatus" NOT NULL DEFAULT 'ANNOUNCED',
    "expectedArrivalAt" TIMESTAMP(3),
    "shipToWarehouseId" INTEGER,
    "shipFromJson" JSONB,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_shipments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inbound_shipments_orgId_vendorId_reference_key" ON "inbound_shipments"("orgId", "vendorId", "reference");
CREATE INDEX IF NOT EXISTS "inbound_shipments_orgId_status_idx" ON "inbound_shipments"("orgId", "status");
CREATE INDEX IF NOT EXISTS "inbound_shipments_vendorId_idx" ON "inbound_shipments"("vendorId");
CREATE INDEX IF NOT EXISTS "inbound_shipments_purchaseOrderId_idx" ON "inbound_shipments"("purchaseOrderId");

ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_shipToWarehouseId_fkey" FOREIGN KEY ("shipToWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable inbound_shipment_lines
CREATE TABLE IF NOT EXISTS "inbound_shipment_lines" (
    "id" SERIAL NOT NULL,
    "inboundShipmentId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "purchaseOrderLineId" INTEGER,
    "batchHint" VARCHAR(120),
    "receivedQtySnapshot" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_shipment_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inbound_shipment_lines_inboundShipmentId_idx" ON "inbound_shipment_lines"("inboundShipmentId");
CREATE INDEX IF NOT EXISTS "inbound_shipment_lines_variantId_idx" ON "inbound_shipment_lines"("variantId");

ALTER TABLE "inbound_shipment_lines" ADD CONSTRAINT "inbound_shipment_lines_inboundShipmentId_fkey" FOREIGN KEY ("inboundShipmentId") REFERENCES "inbound_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbound_shipment_lines" ADD CONSTRAINT "inbound_shipment_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inbound_shipment_lines" ADD CONSTRAINT "inbound_shipment_lines_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable putaway_tasks
CREATE TABLE IF NOT EXISTS "putaway_tasks" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "warehouseId" INTEGER,
    "grnId" INTEGER,
    "grnLineId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "fromLocationId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "PutawayTaskStatus" NOT NULL DEFAULT 'OPEN',
    "recommendationJson" JSONB,
    "toLocationId" INTEGER,
    "stockTransferId" INTEGER,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" INTEGER,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "putaway_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "putaway_tasks_grnLineId_key" ON "putaway_tasks"("grnLineId");
CREATE UNIQUE INDEX IF NOT EXISTS "putaway_tasks_stockTransferId_key" ON "putaway_tasks"("stockTransferId");
CREATE INDEX IF NOT EXISTS "putaway_tasks_orgId_status_idx" ON "putaway_tasks"("orgId", "status");
CREATE INDEX IF NOT EXISTS "putaway_tasks_warehouseId_status_idx" ON "putaway_tasks"("warehouseId", "status");

ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "grns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_grnLineId_fkey" FOREIGN KEY ("grnLineId") REFERENCES "grn_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_stockTransferId_fkey" FOREIGN KEY ("stockTransferId") REFERENCES "stock_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable inbound_discrepancies
CREATE TABLE IF NOT EXISTS "inbound_discrepancies" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "grnId" INTEGER NOT NULL,
    "grnLineId" INTEGER,
    "purchaseOrderLineId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "discrepancyType" VARCHAR(32) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reasonCode" VARCHAR(64),
    "notes" TEXT,
    "status" "InboundDiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" INTEGER,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_discrepancies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inbound_discrepancies_orgId_status_idx" ON "inbound_discrepancies"("orgId", "status");
CREATE INDEX IF NOT EXISTS "inbound_discrepancies_grnId_idx" ON "inbound_discrepancies"("grnId");

ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "grns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_grnLineId_fkey" FOREIGN KEY ("grnLineId") REFERENCES "grn_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable grns FK inbound_shipments
DO $$ BEGIN
 ALTER TABLE "grns" ADD CONSTRAINT "grns_inboundShipmentId_fkey" FOREIGN KEY ("inboundShipmentId") REFERENCES "inbound_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "grns_inboundShipmentId_idx" ON "grns"("inboundShipmentId");

-- AlterTable grn_lines FK inbound_shipment_lines
DO $$ BEGIN
 ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_inboundShipmentLineId_fkey" FOREIGN KEY ("inboundShipmentLineId") REFERENCES "inbound_shipment_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "grn_lines_inboundShipmentLineId_idx" ON "grn_lines"("inboundShipmentLineId");
