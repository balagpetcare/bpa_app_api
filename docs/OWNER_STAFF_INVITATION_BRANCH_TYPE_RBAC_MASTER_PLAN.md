# Owner Staff Invitation — Branch-Type RBAC Master Plan

**Document path:** `docs/OWNER_STAFF_INVITATION_BRANCH_TYPE_RBAC_MASTER_PLAN.md`
**Created:** 2026-04-08
**Status:** IMPLEMENTED + VERIFIED (2026-04-08)
**Branch:** `release/V-A1.0.7` (backend) / `release/V-A1.0.8` (frontend)

**Verification:** See `docs/OWNER_STAFF_INVITATION_BRANCH_TYPE_RBAC_VERIFICATION_SUMMARY.md` (code-path review, risks, QA checklist, seed/migrate order).

---

## 0. Implementation status checklist

| Item | Status |
|------|--------|
| Prisma `MemberRole` enum extended | Done |
| SQL migration `ADD VALUE` for new enum members | Done |
| `branchRoleMatrix.ts` — canonical types, union roles, manager invite list | Done |
| `owner.controller.ts` — `addBranchMember` / `updateBranchMember` use matrix | Done |
| `owner.routes.ts` — `GET .../members/invite-allowed-roles` | Done |
| `auth.controller.ts` — `memberRoleForBranchAccessPermission` extended | Done |
| `seedBranchTypes.ts` — alias branch types | Done |
| `seedRolesPermissions.ts` — `DOCTOR`, `PHARMACIST`, service staff roles | Done |
| `branchRoleMatrix.test.ts` — warehouse/pharmacy/clinic cases | Done |
| Frontend `UnifiedStaffInviteForm` — API-driven roles + labels | Done |
| `unifiedStaffOrchestration.service.ts` — delegates to `branchRoleMatrix` | Done |
| `branchRoles.ts` — dashboard permissions for new MemberRole values | Done |
| `updateOwnerInvitation` — validates role change against matrix | Done |
| Owner `invite-allowed-roles` — `roleLabels` in response (label drift hardening) | Done |

**Migration:** `prisma/migrations/20260408180000_member_role_branch_invite_rbac/migration.sql`

**Deploy (operators):** `npx prisma migrate deploy` → `npx prisma generate` → run `node scripts/check-migration-integrity.js` → re-run `seedRolesPermissions` / full seed as needed for new role rows.

---

## 1. Executive Summary

The BPA/WPA system currently has a functioning but **incomplete branch-type-aware staff invitation system**. The core architecture — `StaffInvite` table, token lifecycle, invite/accept flow, `branchRoleMatrix.ts` — is sound and reusable. However, there are **critical gaps** between:

- The `BranchType` codes seeded into the database (`CLINIC`, `PET_SHOP`, `DELIVERY_HUB`, `WAREHOUSE_DC`, `GROOMING_SPA`, `BOARDING_DAYCARE`, `FOSTER_SHELTER`, `TRAINING_BEHAVIOR`, `PHARMACY_DIAGNOSTICS`)
- The codes recognized in `branchRoleMatrix.ts` (`SHOP`, `PET_SHOP`, `CLINIC`, `DELIVERY_HUB`, `DELIVERY`, `HUB`, `WAREHOUSE`, `CENTRAL_WAREHOUSE`, `PHARMACY`)
- The `MemberRole` enum in Prisma (`OWNER`, `ORG_ADMIN`, `BRANCH_MANAGER`, `BRANCH_STAFF`, `SELLER`, `DELIVERY_MANAGER`, `DELIVERY_STAFF`, `WAREHOUSE_MANAGER`, `RECEIVING_STAFF`, `DISPATCH_STAFF`)
- The roles seeded in `seedRolesPermissions.ts` (which includes `CLINIC_STAFF`, `CLINIC_RECEPTION`, `CLINIC_INVENTORY_STAFF` — **not present in `MemberRole` enum**)
- The legacy `isRoleAllowedForBranch()` function in `owner.controller.ts` (only allows 3 shop roles or 2 delivery roles — completely ignores clinic, pharmacy, warehouse types)

The result: when an owner invites clinic, pharmacy, warehouse-type or grooming/boarding staff, either the validation silently defaults to `SHOP` rules (returning "Invalid role for this branch type") or bypasses type-specific checks entirely.

**This plan provides:** root cause diagnosis, a complete branch-type to role matrix, full migration strategy, backward-safe Prisma changes, seeder updates, backend controller fixes, and frontend dropdown alignment — all without breaking existing staff records.

---

## 2. Root Cause Analysis

### 2.1 Primary Root Cause: `branchRoleMatrix.ts` branch code mismatch

The `getPrimaryBranchTypeCode()` function in `branchRoleMatrix.ts` maps branch types from `branch.types[].type.code`, but the seeded `BranchType` codes are **different** from what the matrix expects:

| Seeded Code (`branch_types` table) | Matrix Key Recognized | Result |
|---|---|---|
| `CLINIC` | `CLINIC` ✅ | Correct |
| `PET_SHOP` | `PET_SHOP` ✅ | Correct (maps to SHOP roles) |
| `DELIVERY_HUB` | `DELIVERY_HUB` ✅ | Correct |
| `WAREHOUSE_DC` | Not present ❌ | Falls through to `SHOP` default |
| `GROOMING_SPA` | Not present ❌ | Falls through to `SHOP` default |
| `BOARDING_DAYCARE` | Not present ❌ | Falls through to `SHOP` default |
| `FOSTER_SHELTER` | Not present ❌ | Falls through to `SHOP` default |
| `TRAINING_BEHAVIOR` | Not present ❌ | Falls through to `SHOP` default |
| `PHARMACY_DIAGNOSTICS` | Not present ❌ | Falls through to `SHOP` default |

When a branch has type `WAREHOUSE_DC`, `getPrimaryBranchTypeCode()` loops through all types, finds no match in `ALLOWED_INVITE_ROLES_BY_BRANCH_TYPE`, falls through both fallbacks, and returns `"SHOP"`. The allowed roles become `["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER"]`. Then when the owner selects `WAREHOUSE_MANAGER`, `canInviteRole()` returns `{ allowed: false, message: "Invalid role for this branch type" }`.

### 2.2 Secondary Root Cause: Legacy `isRoleAllowedForBranch()` in `owner.controller.ts`

The `addBranchMember` and `updateBranchMember` handlers in `owner.controller.ts` use a **separate, legacy** validation function:

```typescript
function isRoleAllowedForBranch(isDeliveryHub, role) {
  const r = String(role || "");
  if (["OWNER", "ORG_ADMIN"].includes(r)) return false;
  if (isDeliveryHub) return ["DELIVERY_MANAGER", "DELIVERY_STAFF"].includes(r);
  return ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER"].includes(r);
}
```

This function:
- Ignores clinic, pharmacy, warehouse, grooming types completely
- Only allows 3 roles for non-delivery branches
- Does NOT use the `branchRoleMatrix.ts` single source of truth

### 2.3 Tertiary Root Cause: `MemberRole` enum vs seeded roles mismatch

The seeder creates `CLINIC_STAFF`, `CLINIC_RECEPTION`, `CLINIC_INVENTORY_STAFF`, `PRODUCER_OWNER`, `PRODUCER_MANAGER`, `PRODUCER_STAFF`, `PRODUCER_AUDITOR`, `PRODUCER_VIEWER` roles, but **none of these exist in the `MemberRole` Prisma enum**. The `BranchMember.role` and `StaffInvite.role` columns are typed as `MemberRole?` in the schema, so these seeded role keys exist only in the `roles`/`permissions` RBAC tables — they are not assignable as branch membership roles.

### 2.4 Quaternary Root Cause: Frontend `ROLES_BY_BRANCH_TYPE` vs backend matrix

`UnifiedStaffInviteForm.tsx` maintains its own `ROLES_BY_BRANCH_TYPE` mapping and includes `INVENTORY_CONTROLLER`, `QC_OFFICER`, `AUDIT_OFFICER` for `WAREHOUSE`/`CENTRAL_WAREHOUSE` types. But these roles are **not in the `MemberRole` enum** — they exist only in `WarehouseStaffRole` enum. The backend `createStaffInvite()` service uses `MemberRole` for the `role` field on `StaffInvite`. So the frontend sends roles that the backend cannot store in the `StaffInvite.role` field (typed as `MemberRole?`).

### 2.5 Summary of Error Trigger Paths

**Path A (most common):** Owner selects branch with type `WAREHOUSE_DC` → selects role `WAREHOUSE_MANAGER` → POST to `/api/v1/owner/branches/:id/members/invite` → `createStaffInvite()` → `getPrimaryBranchTypeCode()` returns `"SHOP"` → `getAllowedInviteRolesForBranch()` returns `["BRANCH_MANAGER","BRANCH_STAFF","SELLER"]` → `canInviteRole()` returns `{ allowed: false, message: "Invalid role for this branch type" }` → **400 error**.

**Path B:** Owner selects branch with type `PHARMACY_DIAGNOSTICS` → selects role `PHARMACIST` → same flow → `getPrimaryBranchTypeCode()` returns `"SHOP"` → `PHARMACIST` not in `["BRANCH_MANAGER","BRANCH_STAFF","SELLER"]` → **400 error**.

**Path C:** Owner selects clinic branch → selects role `CLINIC_STAFF` → `canInviteRole()` — `CLINIC_STAFF` not in `CLINIC`'s allowed list `["BRANCH_MANAGER","BRANCH_STAFF","SELLER","DOCTOR"]` → **400 error** (plus `CLINIC_STAFF` is not in `MemberRole` enum).

---

## 3. Current-State Inventory

### 3.1 Backend Files

| File | Status | Notes |
|---|---|---|
| `src/api/v1/constants/branchRoleMatrix.ts` | Partial | Core logic correct; branch type codes incomplete (missing `WAREHOUSE_DC`, `PHARMACY_DIAGNOSTICS`, `GROOMING_SPA`, etc.) |
| `src/api/v1/services/staffInvite.service.ts` | Correct | Uses `branchRoleMatrix.ts` correctly; warehouse invite path is separate and clean |
| `src/api/v1/modules/branches/branches.controller.ts` | Correct | Uses `branchRoleMatrix.ts` via `createStaffInvite()` |
| `src/api/v1/modules/owner/owner.controller.ts` | Conflicting | `inviteBranchMember` delegates to service (good), but `addBranchMember`/`updateBranchMember` use legacy `isRoleAllowedForBranch()` (bad) |
| `src/api/v1/modules/auth/auth.controller.ts` | Correct | Invite accept/verify flow is target-type-aware; handles both BRANCH and WAREHOUSE |
| `prisma/schema.prisma` — `MemberRole` enum | Partial | Missing: `CLINIC_STAFF`, `CLINIC_RECEPTION`, `CLINIC_INVENTORY_STAFF`, `PHARMACIST`, `DOCTOR`, `INVENTORY_CONTROLLER`, `QC_OFFICER`, `AUDIT_OFFICER` |
| `prisma/schema.prisma` — `BranchTypeCode` enum | Legacy/Unused | Exists as a legacy standalone enum; actual branch type codes live in `BranchType.code` (string-based); not used by invitation logic |
| `prisma/seeders/seedBranchTypes.ts` | Correct | Seeds 9 types; uses real codes from `branch_types` table |
| `prisma/seeders/seedRolesPermissions.ts` | Partial | Seeds rich RBAC roles including `CLINIC_STAFF`, `CLINIC_RECEPTION` etc. but those are in `roles` table only — not in `MemberRole` enum |

### 3.2 Frontend Files

| File | Status | Notes |
|---|---|---|
| `app/owner/(larkon)/staffs/new/page.jsx` | Correct | Delegates to `UnifiedStaffInviteForm`; no branch type logic itself |
| `app/owner/_components/staff/UnifiedStaffInviteForm.tsx` | Partial | Has `ROLES_BY_BRANCH_TYPE` mapping, but uses `WAREHOUSE`/`CENTRAL_WAREHOUSE` keys not `WAREHOUSE_DC`; includes `INVENTORY_CONTROLLER`, `QC_OFFICER`, `AUDIT_OFFICER` which aren't in `MemberRole` |
| `app/owner/(larkon)/invitations/` | Correct | Invitation CRUD works; no role validation |
| `app/owner/(larkon)/branches/[id]/staff/page.jsx` | Not reviewed | Branch-specific staff page |

### 3.3 Database / Schema

| Entity | Status | Notes |
|---|---|---|
| `BranchType` table | Correct | 9 types seeded with real string codes |
| `BranchTypeCode` enum | Legacy | Defined in schema but not used in invitation flow; inconsistent with table |
| `MemberRole` enum | Incomplete | Missing clinic/pharmacy/grooming operational roles |
| `WarehouseStaffRole` enum | Correct | Covers warehouse operational roles |
| `StaffInvite` model | Correct | `targetType BRANCH/WAREHOUSE`, `role MemberRole?`, `warehouseRole WarehouseStaffRole?` |
| `BranchMember` model | Correct | `role MemberRole` — constrained to enum |
| `roles` table (RBAC) | Rich | Has many operational roles not in `MemberRole` enum |

---

## 4. Branch-Type Matrix (Current + Target)

### 4.1 Seeded Branch Types (from `branch_types` table)

| Code | Display Name | Family |
|---|---|---|
| `CLINIC` | Clinic | Healthcare |
| `PET_SHOP` | Pet Shop | Retail |
| `DELIVERY_HUB` | Delivery Hub | Logistics |
| `WAREHOUSE_DC` | Warehouse / Distribution Center | Warehouse |
| `GROOMING_SPA` | Pet Grooming & Spa | Service |
| `BOARDING_DAYCARE` | Pet Boarding / Daycare | Service |
| `FOSTER_SHELTER` | Pet Foster Care / Shelter | Service |
| `TRAINING_BEHAVIOR` | Training / Behavior Center | Service |
| `PHARMACY_DIAGNOSTICS` | Pharmacy / Diagnostics | Healthcare |

### 4.2 Additional Codes Used (not in seed, may exist in legacy data)

| Code | Where Used | Should Be |
|---|---|---|
| `SHOP` | `branchRoleMatrix.ts` | Add to seed as alias or keep as runtime default |
| `WAREHOUSE` | `branchRoleMatrix.ts`, frontend | Alias for `WAREHOUSE_DC` |
| `CENTRAL_WAREHOUSE` | `branchRoleMatrix.ts`, frontend | Sub-type of `WAREHOUSE_DC` or separate entry |
| `DELIVERY` | `branchRoleMatrix.ts` | Alias for `DELIVERY_HUB` |
| `HUB` | `branchRoleMatrix.ts` | Alias for `DELIVERY_HUB` |
| `PHARMACY` | `branchRoleMatrix.ts` | Alias for `PHARMACY_DIAGNOSTICS` |

---

## 5. Role Matrix (Current + Target)

### 5.1 Current `MemberRole` Enum (Prisma)

```
OWNER, ORG_ADMIN, BRANCH_MANAGER, BRANCH_STAFF, SELLER,
DELIVERY_MANAGER, DELIVERY_STAFF, WAREHOUSE_MANAGER, RECEIVING_STAFF, DISPATCH_STAFF
```

### 5.2 Missing Roles Needed for Invitation (Target)

| Role Key | Use Case | Affected Branch Types | In `WarehouseStaffRole`? | In `roles` Table? |
|---|---|---|---|---|
| `DOCTOR` | Clinic doctor invitation | `CLINIC` | No | No |
| `PHARMACIST` | Pharmacy staff | `PHARMACY_DIAGNOSTICS` | No | No |
| `CLINIC_STAFF` | Clinical operational staff | `CLINIC` | No | Yes (seeded) |
| `CLINIC_RECEPTION` | Reception / front-desk | `CLINIC` | No | Yes (seeded) |
| `CLINIC_INVENTORY_STAFF` | Clinic pharmacy/stock | `CLINIC`, `PHARMACY_DIAGNOSTICS` | No | Yes (seeded) |
| `INVENTORY_CONTROLLER` | Warehouse inventory control | `WAREHOUSE_DC` | Yes | No |
| `QC_OFFICER` | Quality control | `WAREHOUSE_DC` | Yes | No |
| `AUDIT_OFFICER` | Warehouse audit | `WAREHOUSE_DC` | Yes | No |
| `GROOMING_STAFF` | Grooming/spa technician | `GROOMING_SPA` | No | No |
| `BOARDING_STAFF` | Boarding/daycare staff | `BOARDING_DAYCARE`, `FOSTER_SHELTER` | No | No |
| `TRAINING_STAFF` | Animal trainer | `TRAINING_BEHAVIOR` | No | No |

### 5.3 Role Assignment Architecture Decision

There are two models to consider:

**Option A (Simple Extension):** Add missing roles to `MemberRole` enum in Prisma. All branch membership uses a single enum. Clean, consistent, but requires migration.

**Option B (Split model):** Keep `MemberRole` for branch staff; use `WarehouseStaffRole` for warehouse-linked staff (already implemented). Operational roles like `CLINIC_STAFF` would only exist in RBAC `roles` table and be enforced differently.

**Decision: Option A for branch-type roles (DOCTOR, PHARMACIST, CLINIC_STAFF, CLINIC_RECEPTION, CLINIC_INVENTORY_STAFF, GROOMING_STAFF, BOARDING_STAFF, TRAINING_STAFF), keeping WarehouseStaffRole for warehouse-specific operational roles that remain in WarehouseStaffAssignment.**

The warehouse invite flow already separately handles `WarehouseStaffRole` — that path is clean and should not be changed. The `INVENTORY_CONTROLLER`, `QC_OFFICER`, `AUDIT_OFFICER` warehouse roles stay in `WarehouseStaffRole` only and must be sent via the warehouse invite endpoint, not the branch invite endpoint.

---

## 6. Permission Matrix (Existing — No Changes Proposed to Core Permissions)

The `seedRolesPermissions.ts` already contains a comprehensive permission set. The permissions themselves are not broken; the issue is only about which roles are assignable to `BranchMember.role` (which is the `MemberRole` enum).

### 6.1 Roles That Need Permission Mappings Added/Verified in Seeder

| New MemberRole | Permissions to Assign | Basis |
|---|---|---|
| `DOCTOR` | All `clinic.*` permissions (create/edit/finalize prescriptions, EMR write, visits, etc.) | Mirror `CLINIC_DOCTOR` seeded role |
| `PHARMACIST` | `clinic.prescription.read`, `medicine.dispense.*`, `inventory.read`, `inventory.receive`, `clinic.catalog.view/search` | New role |
| `CLINIC_STAFF` | Already seeded in `roles` table | Just add to `MemberRole` enum |
| `CLINIC_RECEPTION` | Already seeded in `roles` table | Just add to `MemberRole` enum |
| `CLINIC_INVENTORY_STAFF` | Already seeded in `roles` table | Just add to `MemberRole` enum |
| `GROOMING_STAFF` | `orders.read`, `customers.read`, `inventory.read` | New minimal role |
| `BOARDING_STAFF` | `orders.read`, `customers.read`, `inventory.read` | New minimal role |
| `TRAINING_STAFF` | `orders.read`, `customers.read` | New minimal role |

---

## 7. Target Branch-Type → Allowed Roles Matrix

This is the **single source of truth** target state for `branchRoleMatrix.ts`:

| Branch Type Code(s) | Allowed Invite Roles |
|---|---|
| `CLINIC` | `BRANCH_MANAGER`, `CLINIC_STAFF`, `CLINIC_RECEPTION`, `CLINIC_INVENTORY_STAFF`, `DOCTOR` |
| `PHARMACY_DIAGNOSTICS`, `PHARMACY` | `BRANCH_MANAGER`, `BRANCH_STAFF`, `PHARMACIST`, `CLINIC_INVENTORY_STAFF` |
| `PET_SHOP`, `SHOP` | `BRANCH_MANAGER`, `BRANCH_STAFF`, `SELLER` |
| `DELIVERY_HUB`, `DELIVERY`, `HUB` | `DELIVERY_MANAGER`, `DELIVERY_STAFF` |
| `WAREHOUSE_DC`, `WAREHOUSE`, `CENTRAL_WAREHOUSE` | `WAREHOUSE_MANAGER`, `RECEIVING_STAFF`, `DISPATCH_STAFF`, `DELIVERY_STAFF` |
| `GROOMING_SPA` | `BRANCH_MANAGER`, `GROOMING_STAFF`, `BRANCH_STAFF` |
| `BOARDING_DAYCARE`, `FOSTER_SHELTER` | `BRANCH_MANAGER`, `BOARDING_STAFF`, `BRANCH_STAFF` |
| `TRAINING_BEHAVIOR` | `BRANCH_MANAGER`, `TRAINING_STAFF`, `BRANCH_STAFF` |
| DEFAULT (unknown) | `BRANCH_MANAGER`, `BRANCH_STAFF`, `SELLER` |

> Note: `INVENTORY_CONTROLLER`, `QC_OFFICER`, `AUDIT_OFFICER` are **not** in this table. Those roles belong exclusively to `WarehouseStaffRole` and are only usable via the warehouse invite endpoint (`/api/v1/owner/warehouse/:warehouseId/staff/invite`).

---

## 8. Invitation Flow Design (Target)

### 8.1 Branch Staff Invitation (existing flow — fix only)

```
Owner Panel → /owner/staffs/new
  → Select Branch (loads types from API)
  → Role Dropdown (filtered by branch type via ROLES_BY_BRANCH_TYPE in frontend)
  → POST /api/v1/owner/branches/:id/members/invite
    → createStaffInvite() in service
      → branch.types[].type.code resolved
      → getPrimaryBranchTypeCode() returns correct code
      → canInviteRole() validates against correct allowed list
      → StaffInvite created (targetType=BRANCH, role=MemberRole)
      → Email/SMS sent
  → Accept link → /api/v1/auth/invites/accept
    → BranchMember created with correct MemberRole
    → BranchAccessPermission upserted
```

### 8.2 Warehouse Staff Invitation (already working — no change)

```
Owner Panel → /owner/warehouse/[warehouseId]/staff
  → Invite form (role = WarehouseStaffRole)
  → POST /api/v1/owner/warehouse/:warehouseId/staff/invite
    → createWarehouseStaffInvite()
      → validates against ALLOWED_WAREHOUSE_INVITE_ROLES
      → StaffInvite created (targetType=WAREHOUSE, warehouseRole=WarehouseStaffRole)
  → Accept → WarehouseStaffAssignment + BranchMember created
```

### 8.3 Role Dropdown Population (Target)

Frontend `UnifiedStaffInviteForm.tsx` must use the same type code mappings as the backend matrix. The dropdown must be populated based on branch types returned from the API (`branch.types[].type.code`), mapped through `ROLES_BY_BRANCH_TYPE` that mirrors `branchRoleMatrix.ts`.

---

## 9. Backend Changes Required

### 9.1 `prisma/schema.prisma` — Extend `MemberRole` enum

**File:** `prisma/schema.prisma`
**Change:** Add new values to `MemberRole` enum.

```prisma
enum MemberRole {
  OWNER
  ORG_ADMIN
  BRANCH_MANAGER
  BRANCH_STAFF
  SELLER
  DELIVERY_MANAGER
  DELIVERY_STAFF
  WAREHOUSE_MANAGER
  RECEIVING_STAFF
  DISPATCH_STAFF
  // New: Clinic roles
  DOCTOR
  CLINIC_STAFF
  CLINIC_RECEPTION
  CLINIC_INVENTORY_STAFF
  // New: Pharmacy role
  PHARMACIST
  // New: Service branch roles
  GROOMING_STAFF
  BOARDING_STAFF
  TRAINING_STAFF
}
```

**Migration required:** Yes — Prisma enum extension (add-only, non-destructive).

### 9.2 `prisma/seeders/seedBranchTypes.ts` — Add missing branch type codes

**File:** `prisma/seeders/seedBranchTypes.ts`
**Change:** Add `SHOP`, `WAREHOUSE`, `CENTRAL_WAREHOUSE`, `DELIVERY`, `HUB`, `PHARMACY` as additional seeded types (idempotent upsert).

These are needed because:
- Existing legacy branches may have been created with these codes
- The `branchRoleMatrix.ts` uses these codes for lookups

### 9.3 `src/api/v1/constants/branchRoleMatrix.ts` — Fix type code mappings

**File:** `src/api/v1/constants/branchRoleMatrix.ts`
**Changes:**
1. Update `BRANCH_TYPE_CODES` array to include all supported codes.
2. Update `ALLOWED_INVITE_ROLES_BY_BRANCH_TYPE` to include all target mappings from section 7.
3. Update `getPrimaryBranchTypeCode()` to handle aliasing (e.g., `WAREHOUSE_DC` → `WAREHOUSE_DC`, `PHARMACY_DIAGNOSTICS` → `PHARMACY_DIAGNOSTICS`).
4. Update `DEFAULT_ALLOWED_ROLES` to remain as `["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER"]`.

### 9.4 `src/api/v1/modules/owner/owner.controller.ts` — Replace legacy role validation

**File:** `src/api/v1/modules/owner/owner.controller.ts`
**Change:** Replace `isRoleAllowedForBranch()` with `canInviteRole()` from `branchRoleMatrix.ts` in `addBranchMember()` and `updateBranchMember()`. These functions must query branch types to pass to the matrix function.

### 9.5 `prisma/seeders/seedRolesPermissions.ts` — Add missing role/permission seeds

**File:** `prisma/seeders/seedRolesPermissions.ts`
**Changes:**
1. Add `DOCTOR` role seeding (if not present) with full clinic permissions.
2. Add `PHARMACIST` role seeding with pharmacy permissions.
3. Add `GROOMING_STAFF`, `BOARDING_STAFF`, `TRAINING_STAFF` minimal roles.
4. Verify `CLINIC_STAFF`, `CLINIC_RECEPTION`, `CLINIC_INVENTORY_STAFF` are seeded (they are — but add them with `scope: "BRANCH"` if missing scope).

### 9.6 `src/api/v1/modules/branches/branches.controller.ts` — Minor validation update

**File:** `src/api/v1/modules/branches/branches.controller.ts`
**Change:** The `getBranchInviteAllowedRoles` and `inviteBranchMember` handlers use `getInviteableRolesForInviter()` which in turn calls the matrix. No code change needed here — the fix in `branchRoleMatrix.ts` will cascade.

---

## 10. Frontend Changes Required

### 10.1 `app/owner/_components/staff/UnifiedStaffInviteForm.tsx`

**Change 1:** Update `ROLES_BY_BRANCH_TYPE` to align with backend matrix:
- Replace `WAREHOUSE`/`CENTRAL_WAREHOUSE` keys with `WAREHOUSE_DC`
- Add `PHARMACY_DIAGNOSTICS` key (remove `PHARMACY`)
- Add `GROOMING_SPA`, `BOARDING_DAYCARE`, `FOSTER_SHELTER`, `TRAINING_BEHAVIOR`
- Remove `INVENTORY_CONTROLLER`, `QC_OFFICER`, `AUDIT_OFFICER` from branch invite roles (those are warehouse-only)
- Add new roles: `DOCTOR`, `CLINIC_STAFF`, `CLINIC_RECEPTION`, `CLINIC_INVENTORY_STAFF`, `PHARMACIST`, `GROOMING_STAFF`, `BOARDING_STAFF`, `TRAINING_STAFF`

**Change 2:** Update `ROLE_LABELS` to include labels for all new roles.

**Change 3:** Add multi-type support: if a branch has multiple types, union the allowed roles from each type.

### 10.2 Optional: Load allowed roles from API

An alternative (and more robust) approach is to replace the hardcoded `ROLES_BY_BRANCH_TYPE` map with a call to:

```
GET /api/v1/branches/:branchId/members/invite-allowed-roles
```

This endpoint already exists (`getBranchInviteAllowedRoles` handler) and returns the list from the backend matrix. This would make the frontend and backend always in sync.

**Recommendation:** Implement the API-driven approach in addition to the static map fix. The API call should be made when a branch is selected (not on every render).

---

## 11. Database / Schema / Migration Strategy

### 11.1 Migration: Extend `MemberRole` enum

**File to create:** `prisma/migrations/20260408200000_member_role_extend_branch_types/migration.sql`

```sql
-- Add new MemberRole values (PostgreSQL enum extension)
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'DOCTOR';
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'CLINIC_STAFF';
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'CLINIC_RECEPTION';
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'CLINIC_INVENTORY_STAFF';
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'PHARMACIST';
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'GROOMING_STAFF';
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'BOARDING_STAFF';
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'TRAINING_STAFF';
```

**Important:** PostgreSQL `ALTER TYPE ... ADD VALUE` is **non-destructive** (add-only). This is the correct non-breaking migration per `PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`. No data migration required — existing `BranchMember.role` values are unchanged.

**Prisma migration notes:**
- Run `node scripts/check-migration-integrity.js` before and after.
- Use `migrate deploy` — never `db push` or `migrate reset` on this database.
- `prisma generate` must be run after migration to update client types.

---

## 12. Backward Compatibility Strategy

1. **Existing `BranchMember` records:** Zero impact. Enum extension only adds new values; existing `BRANCH_MANAGER`, `BRANCH_STAFF`, etc. records are untouched.
2. **Existing `StaffInvite` records:** Zero impact. The `role` column is `MemberRole?` (nullable). Existing invites with valid roles remain valid.
3. **Existing `WarehouseStaffAssignment` records:** Zero impact. These use `WarehouseStaffRole`, which is unchanged.
4. **Existing `CLINIC_STAFF` etc. in RBAC `roles` table:** These remain; they are used for permission assignment. After the enum extension, they can now also be assigned as `BranchMember.role`.
5. **Frontend:** Old RBAC-only roles (`CLINIC_STAFF` etc.) that were previously mapped through `roles` table but not `BranchMember.role` will now be properly assignable. Any branch members who were assigned these roles via a bypass path may need a data review (low risk — likely none exist given the error was blocking invites).

---

## 13. Seeder Idempotency Verification

All seeders use upsert logic:
- `seedBranchTypes.ts`: `prisma.branchType.upsert({ where: { code } })` — safe to re-run.
- `seedRolesPermissions.ts`: `prisma.permission.upsert({ where: { key } })` and `prisma.role.upsert({ where: { key } })` — safe to re-run.

New entries for `SHOP`, `WAREHOUSE`, etc. branch types must also use upsert pattern.

---

## 14. Test Plan

### 14.1 Backend Unit Tests

| Test | Expected |
|---|---|
| `getPrimaryBranchTypeCode({ types: [{ type: { code: "WAREHOUSE_DC" } }] })` | Returns `"WAREHOUSE_DC"` |
| `getPrimaryBranchTypeCode({ types: [{ type: { code: "PHARMACY_DIAGNOSTICS" } }] })` | Returns `"PHARMACY_DIAGNOSTICS"` |
| `getAllowedInviteRolesForBranch` for `WAREHOUSE_DC` branch | Returns `["WAREHOUSE_MANAGER","RECEIVING_STAFF","DISPATCH_STAFF","DELIVERY_STAFF"]` |
| `canInviteRole("OWNER", "WAREHOUSE_MANAGER", WAREHOUSE_DC_branch)` | `{ allowed: true }` |
| `canInviteRole("OWNER", "CLINIC_STAFF", CLINIC_branch)` | `{ allowed: true }` |
| `canInviteRole("OWNER", "PHARMACIST", PHARMACY_DIAGNOSTICS_branch)` | `{ allowed: true }` |
| `canInviteRole("OWNER", "INVENTORY_CONTROLLER", WAREHOUSE_DC_branch)` | `{ allowed: false }` (warehouse-only role) |
| `canInviteRole("BRANCH_MANAGER", "BRANCH_MANAGER", CLINIC_branch)` | `{ allowed: false, message: "Manager cannot invite..." }` |

### 14.2 Backend Integration Tests (curl / HTTP)

| Scenario | Endpoint | Expected |
|---|---|---|
| Owner invites WAREHOUSE_MANAGER to WAREHOUSE_DC branch | POST `/api/v1/owner/branches/:id/members/invite` | 201 Created |
| Owner invites PHARMACIST to PHARMACY_DIAGNOSTICS branch | POST `/api/v1/owner/branches/:id/members/invite` | 201 Created |
| Owner invites CLINIC_STAFF to CLINIC branch | POST `/api/v1/owner/branches/:id/members/invite` | 201 Created |
| Owner invites DOCTOR to CLINIC branch | POST `/api/v1/owner/branches/:id/members/invite` | 201 Created |
| Owner invites GROOMING_STAFF to GROOMING_SPA branch | POST `/api/v1/owner/branches/:id/members/invite` | 201 Created |
| Owner invites BRANCH_MANAGER to WAREHOUSE_DC branch | POST `/api/v1/owner/branches/:id/members/invite` | 400 Invalid role |
| Owner invites WAREHOUSE_MANAGER to CLINIC branch | POST `/api/v1/owner/branches/:id/members/invite` | 400 Invalid role |
| Invite accepted for CLINIC_STAFF invite | POST `/api/v1/auth/invites/accept` | 200; BranchMember role=CLINIC_STAFF |

### 14.3 Frontend Tests

| Test | Expected |
|---|---|
| Select WAREHOUSE_DC branch → role dropdown | Shows: Warehouse Manager, Receiving Staff, Dispatch Staff, Delivery Staff |
| Select CLINIC branch → role dropdown | Shows: Branch Manager, Clinic Staff, Clinic Reception, Clinic Inventory Staff, Doctor |
| Select PHARMACY_DIAGNOSTICS branch → role dropdown | Shows: Branch Manager, Branch Staff, Pharmacist, Clinic Inventory Staff |
| Select GROOMING_SPA branch → role dropdown | Shows: Branch Manager, Grooming Staff, Branch Staff |
| Select PET_SHOP branch → role dropdown | Shows: Branch Manager, Branch Staff, Seller |
| Submit WAREHOUSE_MANAGER for WAREHOUSE_DC branch | API returns 201, success shown |
| Submit DOCTOR for CLINIC branch | API returns 201, success shown |

### 14.4 Security / Authorization Tests

| Test | Expected |
|---|---|
| Non-owner user (BRANCH_STAFF) attempts invite | 403 Forbidden |
| BRANCH_MANAGER attempts to invite BRANCH_MANAGER | 400/403 "Manager cannot invite..." |
| Cross-org invite (branch not owned by requester) | 403 Forbidden |
| Expired token accept | 400 Invite expired |

---

## 15. Rollout Order

### Phase 1 — Backend Schema + Seeder (Day 1)

1. Create migration SQL: add new `MemberRole` values
2. Run `node scripts/check-migration-integrity.js` (before)
3. Apply migration: `npx prisma migrate deploy`
4. Run `npx prisma generate`
5. Run `node scripts/check-migration-integrity.js` (after)
6. Update `seedBranchTypes.ts` to add `SHOP`, `WAREHOUSE`, `CENTRAL_WAREHOUSE`, `DELIVERY`, `HUB`, `PHARMACY` alias types
7. Update `seedRolesPermissions.ts` to add new role seeds (`DOCTOR`, `PHARMACIST`, `GROOMING_STAFF`, `BOARDING_STAFF`, `TRAINING_STAFF`)
8. Re-run seed: `npm run seed` (idempotent)

### Phase 2 — Backend Logic Fix (Day 1–2)

9. Update `branchRoleMatrix.ts`:
   - Add all missing `ALLOWED_INVITE_ROLES_BY_BRANCH_TYPE` entries
   - Update `BRANCH_TYPE_CODES` constant
   - Add alias handling in `getPrimaryBranchTypeCode()`
10. Update `owner.controller.ts`:
    - Replace `isRoleAllowedForBranch()` with `canInviteRole()` from matrix in `addBranchMember`/`updateBranchMember`
11. Deploy backend: `npm run build && npm run start` (or `npm run dev:api`)

### Phase 3 — Frontend Fix (Day 2)

12. Update `UnifiedStaffInviteForm.tsx`:
    - Align `ROLES_BY_BRANCH_TYPE` with backend matrix
    - Add new role labels
    - Optionally migrate to API-driven role loading

### Phase 4 — QA + Validation (Day 3)

13. Run integration tests per test plan (section 14)
14. Manual QA: owner panel → staffs/new → select each branch type → verify dropdown
15. Manual QA: invite + accept flow for each new role type

---

## 16. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `MemberRole` enum extension breaks Prisma client | Low | High | Use `ADD VALUE IF NOT EXISTS`; run `prisma generate` after |
| Legacy branches with unknown type codes get wrong roles | Medium | Medium | `getPrimaryBranchTypeCode()` fallback to `"SHOP"` is existing behavior; no regression |
| `CLINIC_STAFF` etc. role keys in RBAC `roles` table vs new `MemberRole` values create confusion | Low | Low | They are the same key string; RBAC lookup by `key` field will still work |
| Frontend sends `INVENTORY_CONTROLLER` to branch invite endpoint | Medium | Medium | Backend rejects it (not in `MemberRole`); frontend fix removes it from branch dropdowns |
| Auth accept flow doesn't handle new `MemberRole` values | Low | High | Accept flow creates `BranchMember` with whatever `role` is on the invite; if role is valid `MemberRole`, Prisma will accept it |
| `memberRoleForBranchAccessPermission()` in `auth.controller.ts` maps only known roles | Medium | Medium | Audit this function; add mappings for new roles |

---

## 17. Exact File-by-File Implementation Checklist

### Backend (`D:\BPA_Data\backend-api`)

- [ ] **`prisma/schema.prisma`**
  Add 8 new values to `MemberRole` enum: `DOCTOR`, `CLINIC_STAFF`, `CLINIC_RECEPTION`, `CLINIC_INVENTORY_STAFF`, `PHARMACIST`, `GROOMING_STAFF`, `BOARDING_STAFF`, `TRAINING_STAFF`

- [ ] **`prisma/migrations/20260408200000_member_role_extend_branch_types/migration.sql`** (new file)
  `ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS` for each of the 8 new values

- [ ] **`prisma/seeders/seedBranchTypes.ts`**
  Add upsert entries for: `SHOP`, `WAREHOUSE`, `CENTRAL_WAREHOUSE`, `DELIVERY`, `HUB`, `PHARMACY`

- [ ] **`prisma/seeders/seedRolesPermissions.ts`**
  Add seeded roles: `DOCTOR` (map to clinic doctor permissions), `PHARMACIST` (map to pharmacy permissions), `GROOMING_STAFF`, `BOARDING_STAFF`, `TRAINING_STAFF` (minimal permissions). Verify `CLINIC_STAFF`, `CLINIC_RECEPTION`, `CLINIC_INVENTORY_STAFF` have correct `scope: "BRANCH"`.

- [ ] **`src/api/v1/constants/branchRoleMatrix.ts`**
  Update `ALLOWED_INVITE_ROLES_BY_BRANCH_TYPE`: add all entries from section 7. Update `BRANCH_TYPE_CODES`. Update `getPrimaryBranchTypeCode()` to resolve `WAREHOUSE_DC`→`WAREHOUSE_DC`, `PHARMACY_DIAGNOSTICS`→`PHARMACY_DIAGNOSTICS`, add aliases `PHARMACY`→`PHARMACY_DIAGNOSTICS`, `WAREHOUSE`→`WAREHOUSE_DC`, `CENTRAL_WAREHOUSE`→`WAREHOUSE_DC`.

- [ ] **`src/api/v1/modules/owner/owner.controller.ts`**
  Replace `isRoleAllowedForBranch()` function and its callers in `addBranchMember` and `updateBranchMember` with `canInviteRole()` from `branchRoleMatrix.ts`.

- [ ] **`src/api/v1/modules/auth/auth.controller.ts`**
  Review `memberRoleForBranchAccessPermission()` helper; add mappings for new `MemberRole` values if missing.

### Frontend (`D:\BPA_Data\bpa_web`)

- [ ] **`app/owner/_components/staff/UnifiedStaffInviteForm.tsx`**
  Update `ROLES_BY_BRANCH_TYPE`: add `WAREHOUSE_DC`, `PHARMACY_DIAGNOSTICS`, `GROOMING_SPA`, `BOARDING_DAYCARE`, `FOSTER_SHELTER`, `TRAINING_BEHAVIOR` as keys. Remove `INVENTORY_CONTROLLER`, `QC_OFFICER`, `AUDIT_OFFICER` from branch invite roles. Update `ROLE_LABELS` for all new roles.

---

## 18. Appendix: Existing Architecture Patterns to Reuse

1. **`branchRoleMatrix.ts`** — single source of truth for validation; already imported by service layer; no new validation logic needed.
2. **`createStaffInvite()`** — already correct; fix only requires the matrix to return correct roles.
3. **`StaffInvite` + lifecycle** — proven; no changes to model or lifecycle.
4. **`seedRolesPermissions.ts` upsert pattern** — idempotent; extend by adding new entries.
5. **`canInviteRole()` return shape** — `{ allowed: boolean, message?: string }` — already used in controllers for 400 responses.
6. **`getBranchInviteAllowedRoles` endpoint** — already exists; frontend can call this to load roles dynamically after the backend fix, eliminating the need to maintain a static map in the frontend.

---

## 19. Summary of Facts vs Proposed Changes

### Confirmed Facts (from code analysis)

1. `branchRoleMatrix.ts` is the canonical backend validation source and uses `ALLOWED_INVITE_ROLES_BY_BRANCH_TYPE` keyed by string codes.
2. The `BranchType` table stores type codes as strings (not enum-constrained); actual seeded codes are `CLINIC`, `PET_SHOP`, `DELIVERY_HUB`, `WAREHOUSE_DC`, `GROOMING_SPA`, `BOARDING_DAYCARE`, `FOSTER_SHELTER`, `TRAINING_BEHAVIOR`, `PHARMACY_DIAGNOSTICS`.
3. The matrix's `getPrimaryBranchTypeCode()` has no entry for `WAREHOUSE_DC` → silently falls through to default `"SHOP"`.
4. `owner.controller.ts` contains a legacy `isRoleAllowedForBranch()` function that is **not** from the shared matrix.
5. `MemberRole` enum has 10 values; the RBAC `roles` table has significantly more entries (e.g., `CLINIC_STAFF`, `CLINIC_RECEPTION` seeded but not in enum).
6. The warehouse invite flow is separate and correct; `WarehouseStaffRole` covers warehouse operational roles.
7. Frontend `UnifiedStaffInviteForm.tsx` uses `WAREHOUSE_DC`-incompatible key names (`WAREHOUSE`, `CENTRAL_WAREHOUSE`) and includes `INVENTORY_CONTROLLER`, `QC_OFFICER`, `AUDIT_OFFICER` in branch role lists erroneously.
8. The `inviteBranchMember` handler in `owner.controller.ts` correctly delegates to `createStaffInvite()` service (no legacy code in invite path).

### Proposed Changes (not yet implemented)

1. Prisma `MemberRole` enum: add 8 new values.
2. New non-destructive migration.
3. `branchRoleMatrix.ts`: add all missing type → role mappings.
4. `owner.controller.ts`: replace legacy `isRoleAllowedForBranch()` with matrix calls.
5. `seedBranchTypes.ts`: add 6 alias types.
6. `seedRolesPermissions.ts`: add 5 new role seeds.
7. `UnifiedStaffInviteForm.tsx`: align frontend map with backend, fix role keys.

---

*Plan created: 2026-04-08*
*Next action: Review and approve plan → begin Phase 1 implementation*
