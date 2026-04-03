# Error fix plan: staff invites + warehouse dashboard

## Phase 1 — Audit summary (confirmed root causes)

### A. Warehouse dashboard Prisma validation error

**Symptom:** `Unknown field 'type' for select statement on model 'Branch'` from `inventoryLocation.findMany()` in `warehouseOperations.service.ts`.

**Root cause:** The `Branch` model has **no scalar `type` field**. Branch classification uses the `types` relation (`BranchToType[]` → `BranchType.code`). The dashboard query nested:

`branch: { select: { id, name, type: true, types: { … } } }`

The invalid `type: true` triggers Prisma’s validation error before the query runs.

**Schema reference:** `prisma/schema.prisma` — `model Branch` (lines ~2979–3146): `types BranchToType[]`, `typeLinks BranchTypeOnBranch[]`; no `type` scalar.

### B. Duplicate pending invitation UX and logic

**Symptom:** Raw message: *"An invitation is already pending for this email/phone and branch…"* with poor HTTP/error shape for UI.

**Root causes:**

1. **`createStaffInvite`** (branch) throws a generic `Error` with a long string; controllers map some messages to 400/500 inconsistently.
2. **`unifiedStaffOrchestration.createStaffInvitation`** duplicates the same check and throws a different message (*"…and branch"* without “accepted/revoked”) with `statusCode: 409`, but **warehouse.controller** maps `/already pending/` to **400**, not 409.
3. **No idempotency:** Re-submitting the **same** role + recipient should be a predictable outcome (return existing invite metadata, optional resend path later) instead of looking like a failure.
4. **Warehouse vs unified invite model mismatch (separate bug):** Unified flow creates `StaffInvite` rows with `targetType: BRANCH` and `warehouseId` set. `getStaffOverview` and `resendStaffInviteForWarehouse` / `reinvite` / `cancel` filtered on `targetType: WAREHOUSE`, so invites **disappeared from lists** and **resend/cancel could not find** the row — not the duplicate message, but the same feature area.

### C. Unified orchestration — invalid Branch include

**Root cause:** `createStaffInvitation` used `include: { …, warehouse: true }` on `Branch`. Prisma `Branch` exposes **`warehouses`** (plural), not `warehouse`. That include would fail Prisma validation when exercised.

---

## Schema vs query mismatches (summary)

| Model / concept | Wrong assumption in code | Correct source in schema |
|----------------|--------------------------|---------------------------|
| Branch “type” | Scalar `branch.type` or `select: { type: true }` | `branch.types[].type.code` (and optional `typeLinks`) |
| Branch “warehouse” | `include: { warehouse: true }` | `warehouses Warehouse[]` — query `warehouses` or separate `findFirst` |
| InventoryLocation “type” | (no bug here) | Valid enum `InventoryLocationType` including `QUARANTINE` |

---

## File-by-file fix plan

| File | Change |
|------|--------|
| `src/api/v1/constants/branchRoleMatrix.ts` | Add `prismaBranchSelectTypeCodes` fragment; extend CLINIC/PHARMACY invite roles to match unified orchestration. |
| `src/api/v1/modules/warehouse/warehouseOperations.service.ts` | Remove invalid `branch.type` select; use `prismaBranchSelectTypeCodes` + `getPrimaryBranchTypeCode`. |
| `src/api/v1/services/staffInvite.errors.ts` | **New:** `StaffInviteDuplicatePendingError` + `isStaffInviteDuplicatePendingError` guard. |
| `src/api/v1/services/staffInvite.service.ts` | Shared duplicate resolution: same role → return `existingPending` + no new row; different role → throw structured error; extend branch invite create with optional `warehouseId` on row. |
| `src/api/v1/services/unifiedStaffOrchestration.service.ts` | Remove invalid `warehouse` include; replace inline duplicate/create with delegation to `createStaffInvite` (single creation path, preserves notifications + warehouseId on invite). |
| `src/api/v1/modules/owner/owner.controller.ts` | Map structured duplicate error to 409 + `error` payload; support 200 idempotent response when `existingPending`. |
| `src/api/v1/modules/branches/branches.controller.ts` | Same mapping for branch invite endpoint. |
| `src/api/v1/modules/warehouse/warehouse.controller.ts` | `getStaffOverview`: list invites by `warehouseId` (not only `targetType: WAREHOUSE`); map duplicate error; accept 200 idempotent invite; align resend error regex if needed. |
| `src/api/v1/services/staffInvite.service.ts` (warehouse helpers) | `resendStaffInviteForWarehouse`, `reinviteStaffInviteForWarehouse`, `cancelStaffInviteForWarehouse`: drop strict `targetType: WAREHOUSE` where `warehouseId + id` is sufficient. |
| `bpa_web/app/owner/_components/staff/UnifiedStaffInviteForm.tsx` | Show info state for `existingPending`: copy + link to resend flow; treat as success with distinct message. |

---

## QA checklist

- [ ] Owner `POST /owner/branches/:id/members/invite`: duplicate **same** role → 200, `existingPending: true`, no second row.
- [ ] Duplicate **different** role → 409, `error.code === INVITE_PENDING_DUPLICATE`, `meta` has `inviteId`, `expiresAt`, `nextActions`.
- [ ] Staff `POST /branches/:branchId/members/invite`: same behavior.
- [ ] `POST /warehouse/:id/staff/invite` (unified): creates one row; repeat same payload → 200 idempotent; overview lists invite.
- [ ] Warehouse dashboard (`getWarehouseStaffDashboard`) loads with no Prisma validation error; `branchContext.branchType` populated when `types` exist.
- [ ] Resend/cancel warehouse invitation works for **BRANCH** target invites with `warehouseId` set.
- [ ] Register/accept invite for warehouse staff still works (unchanged accept path).

---

## Rollback notes

- Revert commits touching `staffInvite.service.ts`, `unifiedStaffOrchestration.service.ts`, `warehouseOperations.controller.ts` (if any), `warehouse.controller.ts`, and `branchPrismaSelect.ts`.
- No database migrations required for this fix.
- If idempotent 200 for duplicate same-role is undesirable for a client, gate with header or query (`Idempotency-Key`) in a follow-up — default here is safe and enterprise-friendly.

---

## Final report (post-implementation)

### Confirmed root causes

1. Invalid Prisma field `Branch.type` in `getWarehouseStaffDashboard` location query.
2. Duplicate-invite handling was throw-only, unstructured, and inconsistent between `createStaffInvite` and `unifiedStaffOrchestration`.
3. Warehouse UI/API assumed `targetType: WAREHOUSE` while unified flow writes `targetType: BRANCH` + `warehouseId`.
4. Invalid `warehouse: true` include on `Branch` in unified orchestration.

### Files changed

`branchRoleMatrix.ts`, `staffInvite.errors.ts`, `staffInvite.service.ts`, `unifiedStaffOrchestration.service.ts`, `warehouseOperations.service.ts`, `warehouse.controller.ts`, `owner.controller.ts`, `branches.controller.ts`, `ownerClinic.service.ts`, `bpa_web` `staffs/new/page.jsx`, `UnifiedStaffInviteForm.tsx`, this doc.

### Remaining limitations

- Idempotent duplicate handling does **not** auto-resend email; users use existing **Resend** endpoints or a future `resendIfDuplicate` flag.
- Branch type code remains “primary” heuristic via `getPrimaryBranchTypeCode` when multiple `BranchType` links exist.

---

## Implementation status (2026-04-02)

Delivered as specified: schema-correct warehouse dashboard query, unified + branch invite duplicate behavior with structured 409 + idempotent 200, warehouse overview/resend/cancel aligned with `targetType: BRANCH` invites that carry `warehouseId`, invalid `Branch.warehouse` include removed from unified orchestration, shared `prismaBranchSelectTypeCodes` on `branchRoleMatrix`, frontend handling on owner staff invite + unified form.
