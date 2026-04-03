-- ============================================================================
-- WAREHOUSE STAFF TEST USER SEED SCRIPT
-- ============================================================================
-- This script creates a test warehouse staff user for development/testing.
-- Run this in your database to create a working warehouse staff login.
--
-- TEST LOGIN CREDENTIALS:
--   Email: warehouse.test@bpa.com
--   Password: test1234
--   Branch: Branch ID 1 (assumes branch with ID 1 exists)
--
-- WAREHOUSE TEST URLs (after logging in):
--   http://localhost:3100/staff/branch/1/warehouse
--   http://localhost:3100/staff/branch/1/warehouse/operations
--   http://localhost:3100/staff/branch/1/warehouse/delivery
--   http://localhost:3100/staff/branch/1/warehouse/pick-lists
--   http://localhost:3100/staff/branch/1/warehouse/qc
--   http://localhost:3100/staff/branch/1/inventory
--   http://localhost:3100/staff/branch/1/inventory/receive
--   http://localhost:3100/staff/branch/1/inventory/incoming
--   http://localhost:3100/staff/branch/1/inventory/transfers
--   http://localhost:3100/staff/branch/1/inventory/adjustments
--   http://localhost:3100/staff/branch/1/inventory/stock-requests
-- ============================================================================

-- ============================================================================
-- STEP 1: Create the base User record
-- ============================================================================
INSERT INTO "User" ("status", "createdAt", "updatedAt")
VALUES ('ACTIVE', NOW(), NOW())
RETURNING "id";

-- Note: Capture the returned userId for use in subsequent steps
-- For this script, we'll use a placeholder @USER_ID that you need to replace

-- ============================================================================
-- STEP 2: Create UserAuth record (email + password)
-- Password hash is for "test1234" (bcrypt with 10 rounds)
-- ============================================================================
INSERT INTO "UserAuth" ("userId", "provider", "email", "passwordHash", "createdAt", "updatedAt")
VALUES (
  @USER_ID,  -- Replace with actual user ID from Step 1
  'LOCAL',
  'warehouse.test@bpa.com',
  '$2b$10$YourHashedPasswordHere',  -- Generate: await bcrypt.hash('test1234', 10)
  NOW(),
  NOW()
);

-- ============================================================================
-- STEP 3: Create UserProfile record
-- ============================================================================
INSERT INTO "UserProfile" ("userId", "displayName", "username", "createdAt", "updatedAt")
VALUES (
  @USER_ID,  -- Replace with actual user ID from Step 1
  'Warehouse Test Staff',
  'warehouse_test',
  NOW(),
  NOW()
);

-- ============================================================================
-- STEP 4: Create BranchMember record (link user to branch 1)
-- ============================================================================
-- Assumes branch with ID 1 exists and belongs to org with ID 1
-- Adjust orgId and branchId as needed for your data
INSERT INTO "BranchMember" ("userId", "branchId", "orgId", "role", "status", "createdAt", "updatedAt")
VALUES (
  @USER_ID,  -- Replace with actual user ID from Step 1
  1,         -- Branch ID (adjust if needed)
  1,         -- Org ID (adjust to match branch's org)
  'WAREHOUSE_STAFF',
  'ACTIVE',
  NOW(),
  NOW()
)
ON CONFLICT ("userId", "branchId") DO UPDATE
SET "status" = 'ACTIVE', "role" = 'WAREHOUSE_STAFF', "updatedAt" = NOW();

-- ============================================================================
-- STEP 5: Assign warehouse-related permissions via Role (optional)
-- ============================================================================
-- Option A: If you have a predefined warehouse staff role
-- INSERT INTO "BranchMemberRole" ("branchMemberId", "roleId", "createdAt")
-- SELECT bm."id", r."id", NOW()
-- FROM "BranchMember" bm
-- JOIN "Role" r ON r."key" = 'warehouse_staff'
-- WHERE bm."userId" = @USER_ID AND bm."branchId" = 1;

-- Option B: Create direct permissions (if using user permissions table)
-- This depends on your specific permission system

-- ============================================================================
-- STEP 6: Create BranchAccessPermission (if your system requires it)
-- With the fix applied, this is optional for legacy compatibility
-- ============================================================================
INSERT INTO "BranchAccessPermission" ("userId", "branchId", "status", "createdAt", "updatedAt")
VALUES (
  @USER_ID,  -- Replace with actual user ID from Step 1
  1,         -- Branch ID
  'APPROVED', -- or 'ACTIVE' depending on your system
  NOW(),
  NOW()
)
ON CONFLICT ("userId", "branchId") DO UPDATE
SET "status" = 'APPROVED', "updatedAt" = NOW();

-- ============================================================================
-- ALTERNATIVE: Complete single-query version (requires known IDs)
-- ============================================================================
-- If you know the next user ID sequence value, you can run this as a single transaction:

/*
WITH new_user AS (
  INSERT INTO "User" ("status", "createdAt", "updatedAt")
  VALUES ('ACTIVE', NOW(), NOW())
  RETURNING "id"
),
user_auth AS (
  INSERT INTO "UserAuth" ("userId", "provider", "email", "passwordHash", "createdAt", "updatedAt")
  SELECT "id", 'LOCAL', 'warehouse.test@bpa.com', '$2b$10$...', NOW(), NOW()
  FROM new_user
),
user_profile AS (
  INSERT INTO "UserProfile" ("userId", "displayName", "username", "createdAt", "updatedAt")
  SELECT "id", 'Warehouse Test Staff', 'warehouse_test', NOW(), NOW()
  FROM new_user
),
branch_member AS (
  INSERT INTO "BranchMember" ("userId", "branchId", "orgId", "role", "status", "createdAt", "updatedAt")
  SELECT "id", 1, 1, 'WAREHOUSE_STAFF', 'ACTIVE', NOW(), NOW()
  FROM new_user
  ON CONFLICT ("userId", "branchId") DO UPDATE
  SET "status" = 'ACTIVE', "role" = 'WAREHOUSE_STAFF', "updatedAt" = NOW()
)
INSERT INTO "BranchAccessPermission" ("userId", "branchId", "status", "createdAt", "updatedAt")
SELECT "id", 1, 'APPROVED', NOW(), NOW()
FROM new_user
ON CONFLICT ("userId", "branchId") DO UPDATE
SET "status" = 'APPROVED', "updatedAt" = NOW();
*/

-- ============================================================================
-- VERIFICATION QUERIES (run these to verify the setup)
-- ============================================================================

-- Check user exists:
-- SELECT * FROM "User" u
-- JOIN "UserAuth" ua ON ua."userId" = u."id"
-- WHERE ua."email" = 'warehouse.test@bpa.com';

-- Check branch membership:
-- SELECT * FROM "BranchMember"
-- WHERE "userId" = @USER_ID;

-- Check access permission:
-- SELECT * FROM "BranchAccessPermission"
-- WHERE "userId" = @USER_ID AND "branchId" = 1;

-- ============================================================================
-- NOTES FOR MANUAL TESTING
-- ============================================================================
-- 1. Ensure branch with ID 1 exists:
--    SELECT * FROM "Branch" WHERE "id" = 1;
--
-- 2. Ensure branch has warehouse type or linked warehouse:
--    SELECT * FROM "BranchTypeLink" WHERE "branchId" = 1;
--    SELECT * FROM "InventoryLocation" WHERE "branchId" = 1 AND "warehouseId" IS NOT NULL;
--
-- 3. If branch 1 doesn't exist, pick another branch ID and update the script.
--
-- 4. To generate the password hash, use Node.js:
--    const bcrypt = require('bcrypt');
--    const hash = await bcrypt.hash('test1234', 10);
--    console.log(hash);
--
-- 5. Login test:
--    curl -X POST http://localhost:3000/api/v1/auth/staff/login \
--      -H "Content-Type: application/json" \
--      -d '{"email":"warehouse.test@bpa.com","password":"test1234"}'
-- ============================================================================
