-- Phase 4: QC inspection, warehouse zones/bins, ledger types, recall allocation release, audit export foundation

-- AlterEnum
ALTER TYPE "StockLedgerType" ADD VALUE 'QC_REJECT';
ALTER TYPE "StockLedgerType" ADD VALUE 'QUARANTINE_IN';
ALTER TYPE "StockLedgerType" ADD VALUE 'QUARANTINE_OUT';

ALTER TYPE "WarehouseStaffRole" ADD VALUE 'QC_OFFICER';
ALTER TYPE "WarehouseStaffRole" ADD VALUE 'AUDIT_OFFICER';

-- CreateEnum
CREATE TYPE "WarehouseZonePurpose" AS ENUM ('RECEIVING', 'STORAGE', 'PICKING', 'PACKING', 'DAMAGE', 'RETURN_HOLD', 'QUARANTINE', 'STAGING', 'GENERAL');
CREATE TYPE "QcInspectionStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'PARTIAL');
CREATE TYPE "QcDisposition" AS ENUM ('ACCEPT', 'QUARANTINE', 'REJECT', 'RETURN_TO_VENDOR');
CREATE TYPE "WarehouseAuditCategory" AS ENUM ('QC', 'QUARANTINE', 'RECALL', 'ZONE', 'ESCALATION');

-- AlterTable warehouses
ALTER TABLE "warehouses" ADD COLUMN "qcInboundEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "warehouses" ADD COLUMN "qcEscalationFailedQtyThreshold" INTEGER;
ALTER TABLE "warehouses" ADD COLUMN "poReceiveEscalationMinTotal" DECIMAL(14,2);

-- AlterTable batch_recalls
ALTER TABLE "batch_recalls" ADD COLUMN "allocationReleasedAt" TIMESTAMP(3);
ALTER TABLE "batch_recalls" ADD COLUMN "allocationReleasedByUserId" INTEGER;
ALTER TABLE "batch_recalls" ADD CONSTRAINT "batch_recalls_allocationReleasedByUserId_fkey" FOREIGN KEY ("allocationReleasedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable inventory_locations
ALTER TABLE "inventory_locations" ADD COLUMN "zoneId" INTEGER;

-- CreateTable warehouse_zones
CREATE TABLE "warehouse_zones" (
    "id" SERIAL NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "purpose" "WarehouseZonePurpose" NOT NULL DEFAULT 'GENERAL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_zones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "warehouse_zones_warehouseId_code_key" ON "warehouse_zones"("warehouseId", "code");
CREATE INDEX "warehouse_zones_warehouseId_isActive_idx" ON "warehouse_zones"("warehouseId", "isActive");

ALTER TABLE "warehouse_zones" ADD CONSTRAINT "warehouse_zones_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "warehouse_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "inventory_locations_zoneId_idx" ON "inventory_locations"("zoneId");

-- CreateTable qc_inspections
CREATE TABLE "qc_inspections" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "warehouseId" INTEGER,
    "grnId" INTEGER NOT NULL,
    "grnLineId" INTEGER,
    "locationId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "status" "QcInspectionStatus" NOT NULL DEFAULT 'PENDING',
    "inspectedQty" INTEGER,
    "passedQty" INTEGER,
    "failedQty" INTEGER,
    "failureReason" TEXT,
    "disposition" "QcDisposition",
    "quarantineLocationId" INTEGER,
    "quarantineRemainingQty" INTEGER,
    "releasedFromQuarantineAt" TIMESTAMP(3),
    "inspectedByUserId" INTEGER,
    "inspectedAt" TIMESTAMP(3),
    "escalationFlag" BOOLEAN NOT NULL DEFAULT false,
    "evidenceFileKey1" VARCHAR(512),
    "evidenceFileKey2" VARCHAR(512),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_inspections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "qc_inspections_orgId_status_idx" ON "qc_inspections"("orgId", "status");
CREATE INDEX "qc_inspections_warehouseId_status_idx" ON "qc_inspections"("warehouseId", "status");
CREATE INDEX "qc_inspections_grnId_idx" ON "qc_inspections"("grnId");
CREATE INDEX "qc_inspections_grnLineId_idx" ON "qc_inspections"("grnLineId");
CREATE INDEX "qc_inspections_locationId_lotId_idx" ON "qc_inspections"("locationId", "lotId");

ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "grns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_grnLineId_fkey" FOREIGN KEY ("grnLineId") REFERENCES "grn_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_quarantineLocationId_fkey" FOREIGN KEY ("quarantineLocationId") REFERENCES "inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_inspectedByUserId_fkey" FOREIGN KEY ("inspectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable warehouse_audit_events
CREATE TABLE "warehouse_audit_events" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "warehouseId" INTEGER,
    "category" "WarehouseAuditCategory" NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "entityType" VARCHAR(80),
    "entityId" VARCHAR(64),
    "metadata" JSONB,
    "actorUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "warehouse_audit_events_orgId_createdAt_idx" ON "warehouse_audit_events"("orgId", "createdAt");
CREATE INDEX "warehouse_audit_events_warehouseId_createdAt_idx" ON "warehouse_audit_events"("warehouseId", "createdAt");
CREATE INDEX "warehouse_audit_events_category_createdAt_idx" ON "warehouse_audit_events"("category", "createdAt");

ALTER TABLE "warehouse_audit_events" ADD CONSTRAINT "warehouse_audit_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "warehouse_audit_events" ADD CONSTRAINT "warehouse_audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
