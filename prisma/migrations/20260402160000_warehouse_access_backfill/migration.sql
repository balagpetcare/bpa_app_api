-- Warehouse access backfill: BranchAccessPermission for active BranchMembers missing a row,
-- WarehouseStaffAssignment for warehouse-role members at linked warehouses,
-- and BRANCH_MANAGER at warehouse-classification branches (multi-tenant safe; idempotent inserts).

-- 1) Approve branch access for active members who have no BAP row yet
INSERT INTO "branch_access_permissions" ("branchId", "userId", "status", "role", "approvedAt", "createdAt", "updatedAt")
SELECT
  bm."branchId",
  bm."userId",
  'APPROVED'::"BranchAccessPermissionStatus",
  bm."role",
  bm."createdAt",
  NOW(),
  NOW()
FROM "branch_members" bm
WHERE bm."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "branch_access_permissions" bap
    WHERE bap."branchId" = bm."branchId" AND bap."userId" = bm."userId"
  );

-- 2) Link warehouse staff rows for existing WH / receiving / dispatch branch members (MemberRole matches WarehouseStaffRole subset)
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

-- 3) Branch managers at warehouse-type branches: grant WAREHOUSE_MANAGER assignment when a warehouse row exists (no duplicate active rows)
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
