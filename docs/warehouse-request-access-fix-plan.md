# Warehouse Request Access — Fix Plan

**Status:** Implemented (2026-04-02). See **Files changed** below.

## Root cause

1. **UI:** `WarehouseAccessFallback.tsx` used `window.alert` only — **no HTTP call**, so no `BranchAccessPermission` row was created or updated for warehouse requests.
2. **Domain:** Staff on the warehouse page typically already have **`BranchAccessPermission.status = APPROVED`** (otherwise `GET /branches/:id/me` returns 403 and they cannot load branch context). The existing `POST /api/v1/branch-access/request` path either updates a **PENDING** row or returns the **APPROVED** row unchanged — **no owner-visible queue entry** for “extra” warehouse access.

## Target flow

1. Staff clicks **Request Access** → `POST /api/v1/branch-access/request` with `requestScope: "WAREHOUSE"`, optional `warehouseId`, optional `requestedRole`.
2. Backend records intent on the **same** `branch_access_permissions` row (multi-tenant: scoped by `branch.orgId` via branch):
   - If status is **PENDING**: unchanged behavior (branch access request).
   - If status is **APPROVED**: merge `permissionOverrides.pendingWarehouseAccess` (JSON) with metadata; **do not** revoke branch access.
3. Owner **`GET /api/v1/owner/branch-access?status=PENDING`** returns:
   - All `status = PENDING` rows, **plus** `status = APPROVED` rows that have `pendingWarehouseAccess` (shown as pending warehouse extension).
4. Owner **Approve** / **Reject**:
   - **Approve:** if `pendingWarehouseAccess` present → upgrade `BranchMember.role` if requested, create **`WarehouseStaffAssignment`**, clear pending JSON, notify staff.
   - **Reject:** if only warehouse pending → clear pending JSON, store rejection in overrides, **keep** branch access **APPROVED**.
   - Otherwise existing approve/reject for full branch PENDING/revoke.

## API contract

### `POST /api/v1/branch-access/request`

Body (existing + new):

| Field | Type | Required |
|-------|------|----------|
| `branchId` | number | Yes |
| `role` | string | No (MemberRole hint) |
| `requestScope` | `"BRANCH"` \| `"WAREHOUSE"` | No (default `BRANCH`) |
| `warehouseId` | number \| null | No |
| `requestedRole` | string | No (e.g. `WAREHOUSE_MANAGER`) |

Response: `{ success, data: BranchAccessPermission, message }`.

### `permissionOverrides` shape (JSON)

```json
{
  "pendingWarehouseAccess": {
    "requestScope": "WAREHOUSE",
    "warehouseId": 123,
    "requestedAt": "ISO-8601",
    "requestedByUserId": 1,
    "requestedRole": "WAREHOUSE_MANAGER",
    "requestedPermissionKeys": ["warehouse.dashboard.view"]
  },
  "warehouseAccessRejection": {
    "reason": "…",
    "rejectedAt": "ISO-8601",
    "rejectedByUserId": 2
  }
}
```

## Dedupe rules

- Same user + branch + `warehouseId` (normalized: `null` = default warehouse for branch): **refresh** `requestedAt`, do not duplicate notifications spam (optional throttle in service).

## Owner panel visibility

- Rows appear under **Pending** filter when:
  - `status === "PENDING"`, **or**
  - `status === "APPROVED"` **and** `permissionOverrides.pendingWarehouseAccess` is set.
- UI shows a **Warehouse** badge for extension requests.

## Backward compatibility

- Clients that only send `branchId` + `role` behave as before.
- Existing approve/reject for **PENDING** branch access unchanged.
- Full **REVOKED** path only when rejecting a true **PENDING** branch request or revoking full access — not when rejecting warehouse-only extension.

## Notifications / audit

- Reuse `notifyOwnerOfAccessRequest` when a new warehouse request is submitted.
- Reuse `notifyStaffOfApproval` / revocation flows where applicable after warehouse fulfillment.

## Test steps

1. Staff with APPROVED branch access, no warehouse perms → open warehouse page → Request Access → toast success.
2. Owner → `/owner/access/requests`, filter Pending → see row with **Warehouse** badge.
3. Approve → staff gains warehouse permissions / assignment; pending JSON cleared.
4. Reject warehouse-only → branch access remains; pending cleared; reason stored.

## Files changed

| Area | Path |
|------|------|
| Core logic | `src/api/v1/services/branchAccessPermission.service.ts` |
| Staff request API | `src/api/v1/modules/branch_access/branch_access.controller.ts` |
| Owner reject | `src/api/v1/modules/owner/owner.controller.ts` |
| Owner notifications | `src/api/v1/services/branchAccessNotification.service.ts` |
| Staff UI + API client | `bpa_web/.../warehouse/_components/WarehouseAccessFallback.tsx`, `bpa_web/lib/api.ts` |
| Owner queue UI | `bpa_web/app/owner/(larkon)/branches/access-requests/page.jsx` |
