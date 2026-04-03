# Warehouse Access Fix Plan

**Date:** 2026-04-02
**Status:** PLAN — DO NOT IMPLEMENT until reviewed and approved.

---

## Executive Summary

Warehouse staff cannot access their dashboard, sidebar doesn't render warehouse items, and `WarehouseStaffAssignment` is not created for branch-target invites with warehouse roles. This document identifies three root causes and proposes a complete fix across data model, API, RBAC, sidebar, and migration.

---

## 1. Root Cause Analysis

### Root Cause 1: BRANCH-target invite does NOT create `BranchAccessPermission`

**File:** `src/api/v1/modules/auth/auth.controller.ts` lines 1139–1155

When `targetType === "BRANCH"`, the `acceptInvite` handler creates/upserts a `BranchMember` but **never creates a `BranchAccessPermission`**. Compare with the WAREHOUSE path (lines 1098–1112), which correctly upserts both `BranchMember` + `BranchAccessPermission`.

**Impact:** `resolveBranchAccessProfile()` in `branchAccessPermission.service.ts` (line 329) returns `null` when `permission.status !== "APPROVED"` — so any staff member invited via BRANCH-target invite has **zero permissions** in the sidebar. The `resolvePermissionsForUser()` function in `permissions.js` also gates branch-role permissions on `approvedBranchIds.has(m.branchId)` (line 293), meaning non-owner users without a `BranchAccessPermission` row get no `warehouse.*` permission keys.

This is the **primary** reason warehouse dashboard permission is missing and sidebar doesn't render.

### Root Cause 2: BRANCH-target invite with warehouse role does NOT create `WarehouseStaffAssignment`

**File:** `src/api/v1/modules/auth/auth.controller.ts` lines 1139–1155

When a BRANCH-target invite is accepted (even if the branch is a WAREHOUSE-type branch and the role is `WAREHOUSE_MANAGER`), the else-branch only creates `BranchMember`. There is no code to:
1. Detect if the branch has a linked `Warehouse` record
2. Create a `WarehouseStaffAssignment` row

The `unifiedStaffOrchestration.service.ts` `acceptStaffInvitation()` function (lines 413–490) handles this correctly by looking up `StaffInvite.warehouseId` and creating the assignment — but **this function is not called from the production accept flow** in `auth.controller.ts`.

**Impact:** `requireWarehouseAccess()` in `warehouse.controller.ts` checks for `warehouseStaffAssignment` (line 41), so warehouse API calls fail for these users.

### Root Cause 3: Sidebar `warehouse.*` permission keys have two naming schemes

**Frontend (`branchSidebarConfig.ts` lines 88–97):**
- `requiredPerm: "warehouse.operations"` — sidebar expects this key
- `requiredPerm: "warehouse.pick"` — sidebar expects this key
- `requiredPerm: "warehouse.qc"` — sidebar expects this key

**Backend (`branchRoles.ts` BRANCH_ROLE_PERMISSIONS):**
- `WAREHOUSE_MANAGER` has: `warehouse.view`, `warehouse.manage`, `warehouse.dashboard.view`, `warehouse.pick.execute`, `qc.view`, etc.
- There is **no** `warehouse.operations`, `warehouse.pick`, or `warehouse.qc` key in any role definition.

**Frontend (`warehouseRbac.ts`):**
- `operations` capability checks: `"warehouse.operations"` OR `"warehouse.dashboard.view"` OR `"inbound.read"` OR `"warehouse.manage"`
- `pick` capability checks: `"warehouse.pick"` OR `"warehouse.pick.execute"` OR `"outbound.read"`
- `qc` capability checks: `"warehouse.qc"` OR `"qc.view"` OR `"qc.inspect"`

The sidebar uses `anyPerms` fallback arrays (e.g., `anyPerms: ["warehouse.dashboard.view", "inbound.read", "warehouse.manage"]`), so these work IF the user has the base permissions. But the `requiredPerm` primary keys (`warehouse.operations`, `warehouse.pick`, `warehouse.qc`) are **never granted** by any role, making their presence misleading and potentially problematic in future changes.

### Root Cause 4: `permissionsRegistry.service.ts` seed vs `branchRoles.ts` mismatch

The `seedRolesPermissions.ts` seeder defines `inventory.receive` in WAREHOUSE_MANAGER role permissions, but `inventory.receive` is not in the `permissions` array defined earlier in the same file (only `inventory.read`/`inventory.write`). The seeder silently skips missing permission IDs (`if (!permissionId) continue`), causing the DB-backed Role→Permission linkage to be incomplete. The system falls back to `BRANCH_ROLE_PERMISSIONS` in `branchRoles.ts` (which does include `inventory.receive`), so this gap only matters for DB-backed role resolution paths.

---

## 2. Fix Plan

### 2.1 Data Model Fixes

#### 2.1.A — No schema change needed for staff-warehouse mapping

The existing models are sufficient:
- `BranchMember` — staff-to-branch (warehouse branches)
- `BranchAccessPermission` — permission gate (must exist with status APPROVED)
- `WarehouseStaffAssignment` — staff-to-warehouse (for warehouse API access checks)

**No new tables or columns required.**

#### 2.1.B — Permission keys to register

Add these keys to `seedRolesPermissions.ts` permissions array so they exist in the `permissions` table:

| Key | Label | Purpose |
|-----|-------|---------|
| `warehouse.dashboard.view` | View warehouse dashboard | Already seeded — verify exists |
| `warehouse.operations` | Access warehouse operations hub | **NEW** — align with sidebar requiredPerm |
| `warehouse.pick` | View pick list queue | **NEW** — align with sidebar requiredPerm |
| `warehouse.qc` | View QC inspection queue | **NEW** — align with sidebar requiredPerm |
| `inventory.receive` | Receive stock/GRN | **MISSING** from seed permissions array |
| `inbound.read` | View inbound shipments | Already seeded — verify |
| `inbound.receive` | Receive inbound shipments | Already seeded — verify |

Then add them to the relevant role permission sets in the same seeder:

| Role | Add Keys |
|------|----------|
| `WAREHOUSE_MANAGER` | `warehouse.operations`, `warehouse.pick`, `warehouse.qc` |
| `RECEIVING_STAFF` | `warehouse.operations`, `warehouse.qc` |
| `DISPATCH_STAFF` | `warehouse.operations`, `warehouse.pick` |

And add them to `BRANCH_ROLE_PERMISSIONS` in `branchRoles.ts`:

| Role | Add Keys |
|------|----------|
| `WAREHOUSE_MANAGER` | `warehouse.operations`, `warehouse.pick`, `warehouse.qc` |
| `RECEIVING_STAFF` | `warehouse.operations`, `warehouse.qc` |
| `DISPATCH_STAFF` | `warehouse.operations`, `warehouse.pick` |

---

### 2.2 API Fixes

#### 2.2.A — Fix `acceptInvite` for BRANCH-target: create `BranchAccessPermission`

**File:** `src/api/v1/modules/auth/auth.controller.ts`
**Location:** Inside the `else` block (BRANCH path), after the `branchMember.upsert` call (~line 1155).

**Add:**
```typescript
// Upsert BranchAccessPermission as APPROVED (align with WAREHOUSE path)
await tx.branchAccessPermission.upsert({
  where: { branchId_userId: { branchId: staffInvite.branchId, userId: uid } },
  update: { status: "APPROVED", role: staffInvite.role },
  create: {
    branchId: staffInvite.branchId,
    userId: uid,
    status: "APPROVED",
    role: staffInvite.role,
    approvedByUserId: staffInvite.invitedByUserId,
    approvedAt: new Date(),
  },
});
```

#### 2.2.B — Fix `acceptInvite` for BRANCH-target: create `WarehouseStaffAssignment` when applicable

**File:** `src/api/v1/modules/auth/auth.controller.ts`
**Location:** After the `BranchAccessPermission` upsert added in 2.2.A (still inside the else/BRANCH block).

**Add:**
```typescript
// If branch has a linked warehouse AND role is a warehouse role, create WarehouseStaffAssignment
const WAREHOUSE_BRANCH_ROLES = new Set([
  "WAREHOUSE_MANAGER", "RECEIVING_STAFF", "DISPATCH_STAFF"
]);
if (WAREHOUSE_BRANCH_ROLES.has(staffInvite.role)) {
  const linkedWarehouse = await tx.warehouse.findFirst({
    where: { branchId: staffInvite.branchId, isActive: true },
    select: { id: true },
  });
  if (linkedWarehouse) {
    const warehouseRole = mapMemberRoleToWarehouseRole(staffInvite.role);
    if (warehouseRole) {
      await tx.warehouseStaffAssignment.upsert({
        where: {
          warehouseId_userId_role: {
            warehouseId: linkedWarehouse.id,
            userId: uid,
            role: warehouseRole,
          },
        },
        update: { isActive: true, removedAt: null },
        create: {
          warehouseId: linkedWarehouse.id,
          userId: uid,
          role: warehouseRole,
          isActive: true,
        },
      });
    }
  }
}
```

**Helper function** (add at module scope or import from a shared utility):
```typescript
function mapMemberRoleToWarehouseRole(memberRole: string): string | null {
  const MAP: Record<string, string> = {
    WAREHOUSE_MANAGER: "WAREHOUSE_MANAGER",
    RECEIVING_STAFF: "RECEIVING_STAFF",
    DISPATCH_STAFF: "DISPATCH_STAFF",
  };
  return MAP[memberRole] || null;
}
```

#### 2.2.C — Fix `createStaffInvite` to pass `warehouseId` for warehouse-type branches

**File:** `src/api/v1/services/staffInvite.service.ts`
**Location:** Inside `createStaffInvite()`, after branch validation (~line 130).

Currently, `createStaffInvite` accepts an optional `warehouseId` in the body and passes it through. But the caller in `branches.controller.ts` (`inviteBranchMember`) does not resolve `warehouseId` from the branch.

**Fix:** In `branches.controller.ts`, after loading the branch, resolve `warehouseId`:
```typescript
let warehouseId = req.body.warehouseId ? Number(req.body.warehouseId) : undefined;
if (!warehouseId && isWarehouseBranchType(branch)) {
  const linkedWh = await prisma.warehouse.findFirst({
    where: { branchId, isActive: true },
    select: { id: true },
  });
  if (linkedWh) warehouseId = linkedWh.id;
}
```
Then pass `warehouseId` into the `createStaffInvite` body. This ensures the `StaffInvite` row records the warehouse linkage for audit purposes.

#### 2.2.D — Verify `unifiedStaffOrchestration.acceptStaffInvitation()` alignment

The `acceptStaffInvitation()` function in `unifiedStaffOrchestration.service.ts` correctly handles both cases. However, it is NOT called from the production `auth.controller.ts` accept flow.

**Option A (recommended):** Apply fixes 2.2.A and 2.2.B to `auth.controller.ts` directly (smaller blast radius).
**Option B:** Refactor `auth.controller.ts` to call `acceptStaffInvitation()` instead. This is cleaner long-term but involves a larger refactor and testing surface.

Recommend Option A for now, Option B as a follow-up tech debt item.

---

### 2.3 RBAC Rules

#### 2.3.A — `branchRoles.ts` BRANCH_ROLE_PERMISSIONS additions

```typescript
WAREHOUSE_MANAGER: [
  // ... existing keys ...
  "warehouse.operations",     // ADD
  "warehouse.pick",           // ADD
  "warehouse.qc",             // ADD
],
RECEIVING_STAFF: [
  // ... existing keys ...
  "warehouse.operations",     // ADD
  "warehouse.qc",             // ADD
],
DISPATCH_STAFF: [
  // ... existing keys ...
  "warehouse.operations",     // ADD
  "warehouse.pick",           // ADD
],
```

#### 2.3.B — Add `WarehouseStaffRole` → permission mapping for `WarehouseStaffAssignment`-based access

Currently `WarehouseStaffAssignment.role` uses the `WarehouseStaffRole` enum which includes roles not in `MemberRole`:
- `INVENTORY_CONTROLLER`
- `QC_OFFICER`
- `AUDIT_OFFICER`

These roles have **no** permission mapping anywhere. Need to add them to `BRANCH_ROLE_PERMISSIONS`:

```typescript
INVENTORY_CONTROLLER: [
  "branch.view", "dashboard.view", "tasks.view",
  "inventory.read", "inventory.receive", "inventory.adjust",
  "warehouse.view", "warehouse.dashboard.view",
  "warehouse.operations",
  "warehouse.locations.manage",
],
QC_OFFICER: [
  "branch.view", "dashboard.view", "tasks.view",
  "inventory.read",
  "warehouse.view", "warehouse.dashboard.view",
  "warehouse.qc",
  "qc.view", "qc.inspect", "qc.release",
  "quarantine.view", "quarantine.manage",
],
AUDIT_OFFICER: [
  "branch.view", "dashboard.view", "tasks.view",
  "inventory.read",
  "warehouse.view", "warehouse.dashboard.view",
  "audit.view", "audit.export",
],
```

#### 2.3.C — `resolvePermissionsForUser` should include `WarehouseStaffAssignment` permissions

**File:** `src/api/v1/utils/permissions.js`

Currently, `resolvePermissionsForUser` only loads permissions from `BranchMember.role` and `BranchAccessPermission`. It does NOT query `WarehouseStaffAssignment`. For users invited via the WAREHOUSE-target path, their `BranchMember.role` is set to `warehouseRole` (e.g., `WAREHOUSE_MANAGER`), which matches `BRANCH_ROLE_PERMISSIONS`. But for `WarehouseStaffRole`-only values (`INVENTORY_CONTROLLER`, `QC_OFFICER`, `AUDIT_OFFICER`), there is currently no mapping.

**Fix:** After the branch member permissions loop (~line 301), add:
```javascript
// Load warehouse staff assignments for additional permission keys
try {
  const warehouseAssignments = await prisma.warehouseStaffAssignment.findMany({
    where: { userId: Number(userId), isActive: true },
    select: { role: true },
  });
  for (const wa of warehouseAssignments) {
    for (const p of (BRANCH_ROLE_PERMISSIONS[wa.role] || [])) out.add(p);
  }
} catch (_) {
  // model may not exist
}
```

---

### 2.4 Sidebar Behavior

#### 2.4.A — Warehouse section always shows (already implemented)

`getFilteredBranchSidebar()` in `branchSidebarConfig.ts` (lines 284–296) already has a fallback: when the Warehouse group has zero matching items, it renders a "Request Access" item. **No change needed.**

#### 2.4.B — Permission-based submenu (already implemented, but broken by Root Cause 1)

The sidebar items use `requiredPerm` + `anyPerms`. Once permissions are correctly resolved (after fixes 2.2.A + 2.3.A), the warehouse items will render:

| Sidebar Item | requiredPerm | anyPerms | Roles that see it |
|---|---|---|---|
| Dashboard | `warehouse.view` | `warehouse.dashboard.view` | WH_MGR, RECV, DISP |
| Operations hub | `warehouse.operations` | `warehouse.dashboard.view`, `inbound.read`, `warehouse.manage` | WH_MGR, RECV, DISP |
| Pick lists | `warehouse.pick` | `warehouse.pick.execute`, `outbound.read` | WH_MGR, DISP |
| QC queue | `warehouse.qc` | `qc.view`, `qc.inspect` | WH_MGR, RECV |
| My Deliveries | `delivery.view` | `delivery.read`, `delivery.manage` | WH_MGR, DISP |
| Receive stock | `inventory.receive` | `inbound.receive` | WH_MGR, RECV |

#### 2.4.C — Fallback UI for users without warehouse permissions

Already in place via the "Request Access" fallback (line 285 in `branchSidebarConfig.ts`). The warehouse dashboard page (`app/staff/(larkon)/branch/[branchId]/warehouse/page.tsx`) already shows `WarehouseAccessFallback` when `hasAnyWarehouseAccess` is false.

**No additional changes needed for sidebar.**

---

### 2.5 Migration Plan — Fix Existing Users

#### Problem

Existing warehouse staff who accepted BRANCH-target invites are missing:
1. `BranchAccessPermission` row (status APPROVED)
2. `WarehouseStaffAssignment` row (for API access)

#### 2.5.A — Backfill `BranchAccessPermission` for all `BranchMember` rows without one

**SQL (run inside a migration or one-time script):**
```sql
INSERT INTO branch_access_permissions (branch_id, user_id, status, role, approved_at, requested_at, created_at, updated_at)
SELECT
  bm.branch_id,
  bm.user_id,
  'APPROVED',
  bm.role,
  bm.created_at,
  bm.created_at,
  NOW(),
  NOW()
FROM branch_members bm
LEFT JOIN branch_access_permissions bap
  ON bap.branch_id = bm.branch_id AND bap.user_id = bm.user_id
WHERE bap.id IS NULL
  AND bm.status = 'ACTIVE';
```

**Estimated impact:** All active branch members who were invited but never got a `BranchAccessPermission` row.

#### 2.5.B — Backfill `WarehouseStaffAssignment` for warehouse-type branch members

**SQL:**
```sql
INSERT INTO warehouse_staff_assignments (warehouse_id, user_id, role, is_active, assigned_at, created_at, updated_at)
SELECT DISTINCT
  w.id,
  bm.user_id,
  bm.role,  -- WAREHOUSE_MANAGER, RECEIVING_STAFF, DISPATCH_STAFF overlap both enums
  true,
  bm.created_at,
  NOW(),
  NOW()
FROM branch_members bm
JOIN warehouses w ON w.branch_id = bm.branch_id AND w.is_active = true
LEFT JOIN warehouse_staff_assignments wsa
  ON wsa.warehouse_id = w.id AND wsa.user_id = bm.user_id AND wsa.role = bm.role::text::"WarehouseStaffRole"
WHERE wsa.id IS NULL
  AND bm.status = 'ACTIVE'
  AND bm.role IN ('WAREHOUSE_MANAGER', 'RECEIVING_STAFF', 'DISPATCH_STAFF');
```

**Note:** The `role` column in `warehouse_staff_assignments` uses `WarehouseStaffRole` enum. `WAREHOUSE_MANAGER`, `RECEIVING_STAFF`, `DISPATCH_STAFF` exist in both `MemberRole` and `WarehouseStaffRole` enums, so the cast is safe for these values. Adjust the cast syntax for your Postgres version.

#### 2.5.C — Verification queries

After running backfills, verify:

```sql
-- Count branch members still missing BAP
SELECT COUNT(*) FROM branch_members bm
LEFT JOIN branch_access_permissions bap
  ON bap.branch_id = bm.branch_id AND bap.user_id = bm.user_id
WHERE bap.id IS NULL AND bm.status = 'ACTIVE';
-- Expected: 0

-- Count warehouse branch members still missing WSA
SELECT COUNT(*) FROM branch_members bm
JOIN warehouses w ON w.branch_id = bm.branch_id AND w.is_active = true
LEFT JOIN warehouse_staff_assignments wsa
  ON wsa.warehouse_id = w.id AND wsa.user_id = bm.user_id
WHERE wsa.id IS NULL
  AND bm.status = 'ACTIVE'
  AND bm.role IN ('WAREHOUSE_MANAGER', 'RECEIVING_STAFF', 'DISPATCH_STAFF');
-- Expected: 0
```

---

## 3. Implementation Order

| Step | What | Files | Risk |
|------|------|-------|------|
| 1 | Backfill `BranchAccessPermission` (SQL) | Migration script | LOW — additive insert, no deletes |
| 2 | Backfill `WarehouseStaffAssignment` (SQL) | Migration script | LOW — additive insert |
| 3 | Fix `auth.controller.ts` BRANCH accept path | `auth.controller.ts` | MEDIUM — core auth flow |
| 4 | Add permission keys to `branchRoles.ts` | `branchRoles.ts` | LOW — additive |
| 5 | Add warehouse role permissions for WH-only roles | `branchRoles.ts` | LOW — additive |
| 6 | Update `permissions.js` to include WSA roles | `permissions.js` | LOW — additive query |
| 7 | Add permission keys to seeder | `seedRolesPermissions.ts` | LOW — additive seed |
| 8 | Verify sidebar renders after permissions fix | Frontend manual test | N/A |

---

## 4. Files to Touch

### Backend (`backend-api`)

| File | Change Type |
|------|-------------|
| `src/api/v1/modules/auth/auth.controller.ts` | Bug fix: add BAP + WSA creation in BRANCH accept |
| `src/api/v1/constants/branchRoles.ts` | Add `warehouse.operations`, `warehouse.pick`, `warehouse.qc` to WH roles; add INVENTORY_CONTROLLER, QC_OFFICER, AUDIT_OFFICER role entries |
| `src/api/v1/utils/permissions.js` | Add WSA-based permission resolution |
| `prisma/seeders/seedRolesPermissions.ts` | Add missing permission keys; add to role assignments |
| `src/api/v1/modules/branches/branches.controller.ts` | Resolve warehouseId for WH-type branches during invite |

### Frontend (`bpa_web`)

**No frontend changes required.** The sidebar config, `warehouseRbac.ts`, and warehouse pages already handle the permissions correctly via `anyPerms` fallback. Once backend delivers the correct permissions, everything renders.

### Migration

| Script | Purpose |
|--------|---------|
| Backfill BAP for existing BranchMembers | Fix Root Cause 1 for existing users |
| Backfill WSA for warehouse-branch members | Fix Root Cause 2 for existing users |

---

## 5. Testing Checklist

- [ ] New warehouse staff invite (BRANCH target, WAREHOUSE_MANAGER role) → accept → verify BAP, BranchMember, WSA all created
- [ ] New warehouse staff invite (WAREHOUSE target, RECEIVING_STAFF role) → accept → verify same
- [ ] Existing user with backfilled BAP can load `/staff/branch/:id` → sidebar shows Warehouse section
- [ ] Existing user with backfilled WSA can access warehouse API endpoints
- [ ] WAREHOUSE_MANAGER sees: Dashboard, Operations hub, Pick lists, QC queue, My Deliveries, Receive stock
- [ ] RECEIVING_STAFF sees: Dashboard, Operations hub, QC queue, Receive stock
- [ ] DISPATCH_STAFF sees: Dashboard, Operations hub, Pick lists, My Deliveries
- [ ] Non-warehouse staff sees: "Request Access" in Warehouse section
- [ ] Owner can access all warehouse features (implicit access)
- [ ] Permission keys in `/api/v1/auth/me` response include `warehouse.*` keys for WH staff
