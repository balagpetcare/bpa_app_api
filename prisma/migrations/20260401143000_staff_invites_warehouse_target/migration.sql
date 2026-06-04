-- Extend staff_invites to support warehouse-scoped invitations
--
-- Prerequisite: "WarehouseStaffRole" is created in 20260428150000_central_warehouse_foundation.
-- This migration runs earlier in the chain; create the enum idempotently so shadow DB replay succeeds.
-- The foundation migration uses the same CREATE ... duplicate_object pattern.

DO $$ BEGIN
  CREATE TYPE "WarehouseStaffRole" AS ENUM ('WAREHOUSE_MANAGER', 'RECEIVING_STAFF', 'DISPATCH_STAFF', 'INVENTORY_CONTROLLER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StaffInviteTargetType') THEN
    CREATE TYPE "StaffInviteTargetType" AS ENUM ('BRANCH', 'WAREHOUSE');
  END IF;
END $$;

ALTER TABLE "staff_invites"
  ADD COLUMN IF NOT EXISTS "targetType" "StaffInviteTargetType" NOT NULL DEFAULT 'BRANCH',
  ADD COLUMN IF NOT EXISTS "warehouseId" INTEGER,
  ADD COLUMN IF NOT EXISTS "warehouseRole" "WarehouseStaffRole";

ALTER TABLE "staff_invites"
  ALTER COLUMN "branchId" DROP NOT NULL,
  ALTER COLUMN "role" DROP NOT NULL;

-- warehouses table is created in 20260428150000; defer FK until that exists (see 20260428150100).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'warehouses'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'staff_invites_warehouseId_fkey'
      AND table_name = 'staff_invites'
  ) THEN
    ALTER TABLE "staff_invites"
      ADD CONSTRAINT "staff_invites_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS "staff_invites_orgId_branchId_status_idx";
CREATE INDEX IF NOT EXISTS "staff_invites_orgId_targetType_status_idx"
  ON "staff_invites"("orgId", "targetType", "status");
CREATE INDEX IF NOT EXISTS "staff_invites_branchId_status_idx"
  ON "staff_invites"("branchId", "status");
CREATE INDEX IF NOT EXISTS "staff_invites_warehouseId_status_idx"
  ON "staff_invites"("warehouseId", "status");
