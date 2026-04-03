-- Central warehouse foundation: MemberRole / location / dispatch enum extensions,
-- WarehouseType / WarehouseStaffRole / DeliveryAssignmentStatus, tables, inventory_locations.warehouseId
-- Enum adds are idempotent (safe if labels already exist from db push / prior attempts).

-- MemberRole (org membership; branch templates may mirror these codes)
DO $wr$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'MemberRole' AND e.enumlabel = 'WAREHOUSE_MANAGER') THEN
    ALTER TYPE "MemberRole" ADD VALUE 'WAREHOUSE_MANAGER';
  END IF;
END $wr$;
DO $wr$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'MemberRole' AND e.enumlabel = 'RECEIVING_STAFF') THEN
    ALTER TYPE "MemberRole" ADD VALUE 'RECEIVING_STAFF';
  END IF;
END $wr$;
DO $wr$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'MemberRole' AND e.enumlabel = 'DISPATCH_STAFF') THEN
    ALTER TYPE "MemberRole" ADD VALUE 'DISPATCH_STAFF';
  END IF;
END $wr$;

-- InventoryLocationType
DO $ilt$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'InventoryLocationType' AND e.enumlabel = 'PHARMACY') THEN
    ALTER TYPE "InventoryLocationType" ADD VALUE 'PHARMACY';
  END IF;
END $ilt$;
DO $ilt$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'InventoryLocationType' AND e.enumlabel = 'QUARANTINE') THEN
    ALTER TYPE "InventoryLocationType" ADD VALUE 'QUARANTINE';
  END IF;
END $ilt$;
DO $ilt$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'InventoryLocationType' AND e.enumlabel = 'STAGING') THEN
    ALTER TYPE "InventoryLocationType" ADD VALUE 'STAGING';
  END IF;
END $ilt$;

-- StockDispatchStatus
DO $sds$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'StockDispatchStatus' AND e.enumlabel = 'CANCELLED') THEN
    ALTER TYPE "StockDispatchStatus" ADD VALUE 'CANCELLED';
  END IF;
END $sds$;
DO $sds$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'StockDispatchStatus' AND e.enumlabel = 'FAILED') THEN
    ALTER TYPE "StockDispatchStatus" ADD VALUE 'FAILED';
  END IF;
END $sds$;

-- New enums for warehouse domain (skip if type already exists)
DO $$ BEGIN CREATE TYPE "WarehouseType" AS ENUM ('CENTRAL', 'REGIONAL', 'TRANSIT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "WarehouseStaffRole" AS ENUM ('WAREHOUSE_MANAGER', 'RECEIVING_STAFF', 'DISPATCH_STAFF', 'INVENTORY_CONTROLLER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "DeliveryAssignmentStatus" AS ENUM ('ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'COMPLETED', 'FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE "warehouses" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(50),
    "type" "WarehouseType" NOT NULL DEFAULT 'CENTRAL',
    "addressJson" JSONB,
    "location" JSONB NOT NULL DEFAULT '{}',
    "managerId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "warehouses_orgId_idx" ON "warehouses"("orgId");
CREATE INDEX "warehouses_isActive_idx" ON "warehouses"("isActive");
CREATE INDEX "warehouses_managerId_idx" ON "warehouses"("managerId");

ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "warehouse_staff_assignments" (
    "id" SERIAL NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "WarehouseStaffRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "warehouse_staff_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "warehouse_staff_assignments_warehouseId_userId_role_key" ON "warehouse_staff_assignments"("warehouseId", "userId", "role");
CREATE INDEX "warehouse_staff_assignments_warehouseId_isActive_idx" ON "warehouse_staff_assignments"("warehouseId", "isActive");
CREATE INDEX "warehouse_staff_assignments_userId_idx" ON "warehouse_staff_assignments"("userId");

ALTER TABLE "warehouse_staff_assignments" ADD CONSTRAINT "warehouse_staff_assignments_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "warehouse_staff_assignments" ADD CONSTRAINT "warehouse_staff_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "delivery_assignments" (
    "id" SERIAL NOT NULL,
    "dispatchId" INTEGER NOT NULL,
    "assignedToUserId" INTEGER NOT NULL,
    "assignedByUserId" INTEGER,
    "status" "DeliveryAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "note" TEXT,
    "failureReason" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "receivedByName" VARCHAR(200),
    "podNote" TEXT,
    "gpsLat" DECIMAL(10, 7),
    "gpsLng" DECIMAL(10, 7),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "delivery_assignments_dispatchId_idx" ON "delivery_assignments"("dispatchId");
CREATE INDEX "delivery_assignments_assignedToUserId_status_idx" ON "delivery_assignments"("assignedToUserId", "status");
CREATE INDEX "delivery_assignments_status_idx" ON "delivery_assignments"("status");
CREATE INDEX "delivery_assignments_assignedAt_idx" ON "delivery_assignments"("assignedAt");

ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "stock_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_locations" ADD COLUMN "warehouseId" INTEGER;

CREATE INDEX "inventory_locations_warehouseId_idx" ON "inventory_locations"("warehouseId");

ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
