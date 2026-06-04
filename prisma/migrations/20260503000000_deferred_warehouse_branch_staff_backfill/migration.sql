-- Deferred from 20260402160000_warehouse_access_backfill: link warehouses to branches and backfill
-- warehouse_staff_assignments once the warehouse domain exists (after 20260428150000).
-- Idempotent: safe if 02160000 already ran sections 2–3 when branchId was present.

ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "branchId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_branchId_fkey'
  ) THEN
    ALTER TABLE "warehouses"
      ADD CONSTRAINT "warehouses_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "warehouses_branchId_idx" ON "warehouses"("branchId");

-- Same logic as 20260402160000 sections 2–3 (skip if prerequisites missing)
DO $$
BEGIN
  IF to_regclass('public.warehouse_staff_assignments') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WarehouseStaffRole')
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'warehouses' AND column_name = 'branchId'
     )
     AND EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'branch_to_types'
     )
     AND EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'branch_types'
     )
  THEN
    INSERT INTO "warehouse_staff_assignments" ("warehouseId", "userId", "role", "isActive", "assignedAt", "removedAt")
    SELECT DISTINCT ON (w."id", bm."userId")
      w."id",
      bm."userId",
      bm."role"::text::"WarehouseStaffRole",
      true,
      bm."createdAt",
      NULL
    FROM "branch_members" bm
    INNER JOIN "warehouses" w ON w."branchId" = bm."branchId" AND w."isActive" = true
    WHERE bm."status" = 'ACTIVE'
      AND bm."role"::text IN ('WAREHOUSE_MANAGER', 'RECEIVING_STAFF', 'DISPATCH_STAFF')
      AND NOT EXISTS (
        SELECT 1 FROM "warehouse_staff_assignments" wsa
        WHERE wsa."warehouseId" = w."id"
          AND wsa."userId" = bm."userId"
          AND wsa."role"::text = bm."role"::text
      )
    ORDER BY w."id", bm."userId";

    INSERT INTO "warehouse_staff_assignments" ("warehouseId", "userId", "role", "isActive", "assignedAt", "removedAt")
    SELECT DISTINCT ON (w."id", bm."userId")
      w."id",
      bm."userId",
      'WAREHOUSE_MANAGER'::"WarehouseStaffRole",
      true,
      bm."createdAt",
      NULL
    FROM "branch_members" bm
    INNER JOIN "warehouses" w ON w."branchId" = bm."branchId" AND w."isActive" = true
    INNER JOIN "branch_to_types" btt ON btt."branchId" = bm."branchId"
    INNER JOIN "branch_types" bt ON bt."id" = btt."typeId"
    WHERE bm."status" = 'ACTIVE'
      AND bm."role" = 'BRANCH_MANAGER'
      AND UPPER(bt."code") IN ('WAREHOUSE', 'CENTRAL_WAREHOUSE', 'WAREHOUSE_DC', 'DISTRIBUTION_CENTER')
      AND NOT EXISTS (
        SELECT 1 FROM "warehouse_staff_assignments" wsa
        WHERE wsa."warehouseId" = w."id"
          AND wsa."userId" = bm."userId"
          AND wsa."isActive" = true
      )
    ORDER BY w."id", bm."userId";
  END IF;
END $$;
