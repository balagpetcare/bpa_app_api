# Delivery system — implementation progress

> **Last updated:** 2026-04-11 (Phase 6 + 9 receive/legacy pass)

## Phase 1 — Migration chain repair — **SUBSTANTIALLY COMPLETE** (shadow replay OK)

### Done

| Change | Purpose |
|--------|---------|
| `20260404200000_enterprise_allocation_picking_enhancement/migration.sql` | No-op; DDL moved to `20260429120500` |
| `20260408140000_procurement_demand_lines_central_fulfillment/migration.sql` | No-op; DDL moved to `20260429120500` |
| `20260409180000_stock_transfer_enterprise_superseded_allocation_trigger/migration.sql` | No-op; DDL moved to `20260429120500` |
| **NEW** `20260429120500_enterprise_allocation_post_foundation/migration.sql` | Idempotent: enum extensions for `AllocationPlanStatus`, plan/line columns, `allocation_plan_events`, procurement enums + `procurement_demand_lines`, `stock_request_items.backorderStatus`, supersede column + trigger; **section D** deferred wave2 FKs (`purchase_orders`, `warehouses`, inbound) |
| `20260402140000_wave2_procurement_inbound_putaway/migration.sql` | Guards: `purchase_orders`, `purchase_order_lines`, `warehouses`, `warehouse_bins` — FKs/deferred when tables missing |
| `20260408180000_member_role_branch_invite_rbac/migration.sql` | `duplicate_object` guards per `MemberRole` value |
| `20260402160000_warehouse_access_backfill/migration.sql` | Section 1 (BAP) always; sections 2–3 only when `warehouses`, `warehouse_staff_assignments`, `WarehouseStaffRole`, `warehouses.branchId` exist |
| **NEW** `20260503000000_deferred_warehouse_branch_staff_backfill/migration.sql` | `ALTER warehouses ADD branchId` + FK/index; idempotent warehouse staff INSERTs deferred from `02160000` |
| `20260402180000_warehouse_enterprise_hardening_indexes/migration.sql` | Guards indexes that reference `warehouseId` / `warehouses` before those exist; composites appended to `20260428150000` |
| `20260403140000_enterprise_grn_po_line_barcode_void/migration.sql` | `warehouses` + `grn_lines`→`purchase_order_lines` FK guarded; FK + index deferred in `20260429120000` |
| `20260403163736_stock_request_procurement_intent/migration.sql` | `stock_requests`→`purchase_orders` FK deferred to `20260429120000` |
| `20260405120000_controlled_receive_sessions/migration.sql` | Backfill INSERT no longer references `grns.purchaseOrderId` before column exists; PO-only GRN backfill in `20260429120000` |

### Remaining / known issues

| Issue | Notes |
|-------|------|
| **Shadow DB (`prisma migrate diff --from-migrations --to-schema prisma/schema.prisma`)** | **Passes** (2026-04-11). May emit a small SQL drift (e.g. `procurement_demand_lines.updatedAt` default) — reconcile with schema if needed. |
| **Checksum drift** | Any DB that applied **old** contents of edited migrations must run `prisma migrate resolve` / `--fix` per `scripts/check-migration-integrity.js` policy. |
| **`migrate deploy` on production-like DB** | Not run in this task; validate in staging before production. |

### Commands for operators

After pulling these files, on each environment:

```bash
npx prisma validate
npx prisma generate
node scripts/check-migration-integrity.js
# If checksum drift on intentionally edited migrations: governed --fix or resolve
npx prisma migrate deploy
```

---

## Phase 2 — Schema/code sync — **IMPROVED**

| Item | Status |
|------|--------|
| `prisma validate` | Passes |
| `prisma generate` | Passes |
| `npx tsc --noEmit` | Passes (full API tree) |
| `warehouseFulfillmentQueue.service.ts` | Optional `stockRequest` filter removed; status + segment filters in JS (Prisma include + readonly tuple fix) |
| `unifiedStaffOrchestration.service.ts` | `getStaffForBranch` uses `user.branchAccessPermissions` + `warehouseStaffAssignments`; transaction client typing for `generateUniqueUsername`; `WarehouseStaffRole` for warehouse assignments |
| `multiSourceAllocator.service.ts` | Imports `FefoLocationBatchContext` |
| `permissionsRegistry.service.ts` | `PermissionScope` includes `"org"` |
| Misc | `oauth.controller` CJS `appConfig`; `dispatches.controller` gate `ok === false` + `as const` discriminants; `returnAudit`, `media.processor`, `providerProfileBootstrap` TS fixes |
| `repairWarehouseStaffAccess.ts` | Maps `WarehouseStaffRole` → `MemberRole` for `BranchMember` |
| `stockFlowPgCaps.service.ts` | Comment only — runtime PG probe retained for mixed environments |

---

## Phase 3 — Canonical flow decision — **DONE**

- Document: `DELIVERY_SYSTEM_CANONICAL_FLOW_DECISION.md`
- `legacyFulfillmentGuard.service.ts` unchanged (already enforces env + plan + backorder)

---

## Phase 4 — Owner panel — **PARTIAL**

| File | Change |
|------|--------|
| `bpa_web/app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` | Enterprise card: `border-success`, primary CTA button, label “Start allocation plan (recommended)”. Fulfillment guide alert for internal transfer. Legacy “Fulfill & Dispatch” **collapsed** behind “Show legacy quick dispatch (StockTransfer)”. **Pick lists** line shows all waves (`pickLists`) with fallback to legacy `pickList`. |
| `bpa_web/app/owner/(larkon)/inventory/allocation/[id]/page.tsx` | **Multi-wave UX:** `pickLists` table when &gt;1 wave; primary pick for actions via same selection rules as API; **Generate next pick list (wave)** when prior waves are handed off and remaining allocation exists; `PARTIALLY_DISPATCHED` badge styling. |

### Remaining (Phase 4)

- `stock-requests/page.tsx` derived status column
- `warehouse-fulfillment/page.tsx` badges / next-action copy
- Deeper lifecycle timeline / copy for shortage vs extra qty (see master plan)

---

## Phase 5 — Warehouse execution — **PARTIAL** (2026-04-11)

| Item | Status |
|------|--------|
| Multi-wave partial dispatch (e.g. 40/60) | **Done:** `pick_lists.allocationPlanId` no longer unique; `AllocationPlan.pickLists` one-to-many; `createPickListFromPlan` creates lines for **remaining** qty per allocation line; blocks new wave while an open pick exists or a **completed** pick is not handed off. |
| Plan status after pick complete | **Done:** `PICKED` only when every allocation line has `sum(quantityPicked) ≥ quantityAllocated`; else stays `PICKING`. |
| Plan status after dispatch handoff | **Done:** `PARTIALLY_DISPATCHED` while any allocation line still has remaining pick qty; `DISPATCHED` when fully picked. |
| Warehouse queue | **Done:** includes `PARTIALLY_DISPATCHED`; `selectPrimaryPickListForPlan` chooses **active** pick list; `shouldIncludeInternalTransferQueueRow` keeps partial-dispatch plans visible. |
| Migration | `20260411191500_pick_lists_allow_multiple_per_allocation_plan` — drops unique index on `allocationPlanId`, adds `pick_lists_allocationPlanId_idx`. |

### Remaining (Phase 5)

- Per-source pick queue rows for `MULTI_SOURCE` (beyond primary pick list selection)
- Automated tests for multi-wave + queue

---

## Phase 6 — Branch receive + GRN + status sync — **SUBSTANTIALLY COMPLETE** (2026-04-11)

Canonical path was already `dispatches.service.ts` → `receiveDispatch` → `receiveDispatchLedgerInTx` (GRN + `TRANSFER_IN` / `DAMAGE` + `markStockRequestStatusFromDispatchReceive`). This pass **tightens** behavior and docs.

| Item | Change |
|------|--------|
| Stock request status after enterprise receive | **`RECEIVED`** when every `StockDispatch` for the request is `DELIVERED` and every `StockDispatchItem` is fully accounted (`received + damaged + short ≥ dispatched`); otherwise **`PARTIALLY_RECEIVED`** while any DO is not fully delivered. (Replaces `RECEIVED_FULL` for this path — aligns with `deriveRequestStatus` / transition graph `DISPATCHED → RECEIVED`.) |
| Transfer receive vs enterprise | **`markRequestReceivedIfLinked`** skips updating `StockRequest` when any `StockDispatch` exists for that request (enterprise path owns status). |
| **`receiveTransfer`** | Throws if `stockRequestId` is set and any `StockDispatch` exists — prevents mixed **StockTransfer receive** + **StockDispatch** on the same request. |
| Session-only receive (optional prod flag) | **`ENTERPRISE_DISPATCH_RECEIVE_SESSION_ONLY=true`** → `receiveDispatch` rejects `legacy_immediate`; use **verify → submit → confirm** only. |

### Remaining (Phase 6)

- Staff UI hardening (only session flow when flag on); optional “extra received” line semantics if product adds explicit support later.

---

## Phase 9 — Legacy flow cleanup — **SUBSTANTIALLY COMPLETE** (2026-04-11)

| Item | Change |
|------|--------|
| **`assertLegacyFulfillmentAllowedForStockRequest`** | Blocks legacy fulfill/preview/dispatch when **`StockDispatch`** rows exist for the SR (`ENTERPRISE_DISPATCH_BLOCKS_LEGACY:`), in addition to env **`DISABLE_LEGACY_STOCK_REQUEST_FULFILL`**, allocation plan rules, and active backorders. |
| **Owner API** | `ownerStockRequestMutationErrorResponse` maps **`ENTERPRISE_DISPATCH_BLOCKS_LEGACY`** → HTTP 409. |
| **GET stock request(s)** | Adds **`hideLegacyOwnerFulfillUi`**, **`legacyFulfillBlockedByEnterpriseDispatch`**, **`legacyStockRequestFulfillGloballyDisabled`**, **`enterpriseDispatchReceiveSessionOnly`** (env mirrors) for UI. |
| **Owner UI** | `stock-requests/[id]/page.tsx`: **`canDispatch`** / legacy panel gated by **`hideLegacyOwnerFulfillUi`**; info alert when enterprise dispatch or global disable hides legacy. |

### Remaining (Phase 9)

- Optional: set **`DISABLE_LEGACY_STOCK_REQUEST_FULFILL=true`** in production env (code supports it; not forced in repo).

---

## Phases 7, 8, 10 — **OPEN**

| Phase | Scope |
|-------|--------|
| **7** | Backorder supplementary fulfillment (remaining qty, supplementary allocation plans / dispatches) |
| **8** | Full status matrix cleanup across modules (single source of truth, CLOSED semantics) |
| **10** | Concurrency guards, full browser QA matrix, automated flow tests |

See `DELIVERY_SYSTEM_BUILD_BLUEPRINT.md` for the full task list.
