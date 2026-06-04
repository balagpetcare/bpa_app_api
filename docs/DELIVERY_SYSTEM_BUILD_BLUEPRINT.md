# DELIVERY SYSTEM — BUILD BLUEPRINT

> **Date:** 2026-04-11
> **Purpose:** Implementation-ready, phase-by-phase work packages for a coding agent
> **Source:** CODE_TRUTH_AUDIT, GAP_ANALYSIS, MASTER_EXECUTION_PLAN — all verified against live code

### Implementation status (2026-04-11)

| Phase | Status |
|-------|--------|
| 1 Migration repair | **Improved (2026-04-11)** — `20260402160000` guards sections 2–3; **NEW** `20260503000000` adds `warehouses.branchId` + deferred staff backfill; `20260402180000` / `20260403140000` / `20260403163736` / `20260405120000` ordering guards + deferred DDL in `20260428150000` / `20260429120000`; `prisma migrate diff --from-migrations` **passes** (minor schema drift line possible). Checksum drift still possible on edited migrations — use governed `--fix` / `migrate resolve`. |
| 2 Schema/code sync | **Improved** — `npx tsc --noEmit` passes; `getStaffForBranch` uses `branchAccessPermissions` + `warehouseStaffAssignments`; warehouse queue post-filters `StockRequest` status; misc TS fixes (OAuth `appConfig`, dispatch gate narrowing, permissions `org` scope, multi-source FEFo import, etc.) |
| 3 Canonical decision | **Done** — `DELIVERY_SYSTEM_CANONICAL_FLOW_DECISION.md` |
| 4 Owner UI | **Partial** — SR detail: enterprise primary, legacy collapsed |
| 5–10 | **Not started** in this pass |

Authoritative log: `docs/DELIVERY_SYSTEM_IMPLEMENTATION_PROGRESS.md`.

---

## 1. FINAL SYSTEM DECISION

### Canonical Flow

**Enterprise path is the ONLY new-order fulfillment path:**

```
StockRequest → AllocationPlan → PickList → StockDispatch → DispatchReceiveSession → GRN
```

### Deprecated Flow

**Legacy StockTransfer path is deprecated:**

```
StockRequest → StockTransfer → transfers.receiveTransfer  ← DEPRECATED
```

Deprecated endpoints:
- `PATCH /api/v1/stock-requests/:id/fulfill` — `fulfillStockRequestFlexible`
- `POST /api/v1/stock-requests/:id/dispatch` — `fulfillAndDispatch`
- `POST /api/v1/transfers/:id/send` — `sendTransfer`
- `POST /api/v1/transfers/:id/receive` — `receiveTransfer`

### Backward Compatibility (Temporary)

| Component | Keep Until | Reason |
|-----------|-----------|--------|
| `legacyFulfillmentGuard.service.ts` | Phase 9 complete | Guards enterprise boundary |
| Transfer read endpoints (`GET /transfers`, `GET /transfers/:id`) | Indefinite | Historical data query |
| `branchInboundQueue` showing `kind: "TRANSFER"` items | Indefinite | In-flight legacy transfers must complete |
| `POST /transfers/:id/receive` | All in-flight transfers complete | Cannot break mid-flight receives |
| Legacy `Inventory` model | Out of scope | Used by non-delivery features |

### Locked Decisions (Do Not Revisit)

| Decision | Rationale |
|----------|-----------|
| No `READY_TO_FULFILL` enum value — use `APPROVED` | Code already uses `APPROVED`; `deriveRequestStatus` maps `CONFIRMED` plan → `APPROVED` SR |
| No `BranchReceiveSession` model — use `DispatchReceiveSession` + facade | Already implemented in `branchReceiveSession.service.ts` |
| `allocationScope` stays as-is — `SINGLE_SOURCE` default, `MULTI_SOURCE` behind flag | Schema + migration already in place (`20260429130000`) |
| `FULFILLMENT_RESERVATION_ENABLED` defaults to true | Reservation via ledger is the safe default |

---

## 2. PHASE-BY-PHASE WORK PACKAGES

---

### PHASE 1: Migration Chain Repair

**Objective:** Make `prisma migrate deploy` succeed from an empty database. Unblock shadow DB, CI/CD, and developer onboarding.

**Backend scope:**
- No application code changes

**Frontend scope:**
- None

**Schema/migration scope:**

| Migration file | Exact change |
|----------------|-------------|
| `20260404200000_.../migration.sql` | Replace entire contents with `-- DDL moved to 20260429120000; SELECT 1;` |
| `20260408140000_.../migration.sql` | Replace entire contents with `-- DDL moved to 20260429120000; SELECT 1;` |
| `20260409180000_.../migration.sql` | Replace entire contents with `-- DDL moved to 20260429120000; SELECT 1;` |
| `20260429120000_.../migration.sql` | Append absorbed DDL from the three no-op'd files. Every statement must use `IF NOT EXISTS` / `DO $$ ... END $$` guards. Specifically: (a) `ALTER TYPE "AllocationPlanStatus" ADD VALUE IF NOT EXISTS ...` for values added by `20260404200000`, (b) columns/indexes from `20260404200000` via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, (c) `CREATE TABLE IF NOT EXISTS "procurement_demand_lines"` + FKs from `20260408140000`, (d) `CREATE TYPE IF NOT EXISTS "ProcurementDemandStatus"` + `"StockRequestItemBackorderStatus"`, (e) enterprise-superseded trigger + column from `20260409180000` |
| `20260408180000_.../migration.sql` | Wrap each `ALTER TYPE "MemberRole" ADD VALUE` in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` |
| `20260501000000_.../migration.sql` | Prefix every `CREATE TABLE` with `IF NOT EXISTS`, every `CREATE TYPE` with guard, every `ALTER TABLE ADD COLUMN` with `IF NOT EXISTS`. Or convert to `SELECT 1;` if all DDL is already covered by prior migrations |

**API scope:** None

**Status model impact:** None

**Permission impact:** None

**QA scenarios:**
1. Fresh empty PG → `prisma migrate deploy` → success, zero errors
2. Existing dev DB → `prisma migrate resolve --applied "20260404200000_..."` (repeat for all 3 no-op'd) → `prisma migrate deploy` → success
3. `prisma validate` → passes
4. `node scripts/check-migration-integrity.js` → passes
5. `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-migrations prisma/migrations` → no unexpected drift

**Acceptance criteria:**
- Shadow database creation succeeds
- `prisma generate` produces clean client
- CI migration step green

---

### PHASE 2: Schema/Code Sync

**Objective:** Confirm that every Prisma field accessed in delivery services exists in the generated client. Eliminate runtime risks.

**Backend scope:**

| File | Task |
|------|------|
| `services/stockFlowPgCaps.service.ts` | If Phase 1 guarantees `stock_transfers.enterpriseSupersededAt` exists via migration, replace the raw PG metadata check with a constant `true`. Keep the file as a no-op wrapper for compatibility. |
| `modules/allocation_plans/allocationPlan.service.ts` | Grep every `prisma.allocationPlanLine` field access. Verify `lineStatus`, `allocationMethod`, `sourceWarehouseId`, `demandQty` exist in generated client. They do — no change needed, but document that `lineStatus`/`allocationMethod` are free-form strings. |
| `modules/dispatches/dispatches.service.ts` | Verify all `stockDispatchItem` field accesses. `quantityShort` is in schema — OK. |

**Frontend scope:** None

**Schema/migration scope:** None (no DB changes)

**API scope:** None

**Status model impact:** None

**Permission impact:** None

**QA scenarios:**
1. `npm run build` → zero TypeScript errors
2. Smoke test: `POST /api/v1/fulfillment/stock-requests/:id/start` returns 200 (on valid SR)
3. Smoke test: `GET /api/v1/allocation-plans/:id` returns plan with all fields populated

**Acceptance criteria:**
- Clean TS build
- All delivery endpoints return expected shapes

---

### PHASE 3: Canonical Flow Decision (Document Only)

**Objective:** Record the decisions from Section 1 of this blueprint in a standalone decision doc and verify guard enforcement.

**Backend scope:**

| File | Task |
|------|------|
| `services/legacyFulfillmentGuard.service.ts` | Read-only review. Confirm: (a) `DISABLE_LEGACY_STOCK_REQUEST_FULFILL=true` blocks `PATCH /fulfill`, (b) any non-CANCELLED plan blocks legacy, (c) active backorders block legacy. All three are verified — no code change needed. |

**Frontend scope:**
- No changes yet (UI cleanup is Phase 4)

**Schema/migration scope:** None

**API scope:** None

**Status model impact:** None

**Permission impact:** None

**QA scenarios:** None (documentation phase)

**Acceptance criteria:**
- `docs/DELIVERY_SYSTEM_CANONICAL_FLOW_DECISION.md` created with decisions from Section 1

---

### PHASE 4: Owner Panel Operational Cleanup

**Objective:** Owner SR detail page has one clear primary CTA (enterprise). Legacy action de-emphasized. Warehouse queue shows lifecycle progress.

**Backend scope:**

| File | Task |
|------|------|
| `services/warehouseFulfillmentQueue.service.ts` | No changes needed — `nextAction` and `derivedEffectiveStatus` already computed |

**Frontend scope:**

| File | Task |
|------|------|
| `bpa_web/app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` | (a) Move "Start Allocation Plan" to primary CTA position. (b) Wrap legacy "Fulfill & Dispatch" in a collapsible "Quick Dispatch (Legacy)" section with warning text. (c) Hide legacy section entirely when `allocationPlanBlocksLegacyFulfill === true`. (d) Add enterprise status card showing: plan status, pick progress, dispatch count, receive status — data from `GET /fulfillment/stock-requests/:id/status`. |
| `bpa_web/app/owner/(larkon)/inventory/stock-requests/page.tsx` | Add a `derivedStatus` column. Use the fulfillment status API or client-side derivation from plan/dispatch data included in list response. |
| `bpa_web/app/owner/(larkon)/inventory/warehouse-fulfillment/page.tsx` | Add plan status badge (CONFIRMED/PICKING/PICKED). Improve `nextAction` display text to be user-friendly ("Start picking", "Create dispatch", etc.). |
| `bpa_web/app/owner/(larkon)/inventory/allocation/[id]/page.tsx` | Add lifecycle timeline: Plan Created → Allocated → Confirmed → Picking → Picked → Dispatched → Delivered. Show current step highlighted. Add dispatch link when dispatch exists. |

**Schema/migration scope:** None

**API scope:** No new endpoints. Uses existing `GET /fulfillment/stock-requests/:id/status`.

**Status model impact:** None (display-only changes)

**Permission impact:** None

**QA scenarios:**
1. Open owner SR detail for SUBMITTED SR → "Start Allocation Plan" is primary CTA, legacy section collapsed
2. Start allocation → plan card appears with status
3. Confirm plan → SR shows APPROVED, plan shows CONFIRMED
4. Owner SR list shows derived status column
5. Warehouse queue shows plan status badges and human-readable next-action
6. Allocation detail page shows lifecycle timeline with current step

**Acceptance criteria:**
- No dual-action confusion on owner SR detail
- Legacy path visually subordinate
- Queue and allocation pages show lifecycle progress

---

### PHASE 5: Enterprise Allocation Completion

**Objective:** AllocationPlan status transitions through PICKING/PICKED. AllocationSourceSummary status updates. Completion summary function.

**Backend scope:**

| File | Task |
|------|------|
| `modules/allocation_plans/allocationPlan.service.ts` | Add `startPicking(planId, orgId, actorUserId)`: validate plan `status === "CONFIRMED"`, update to `PICKING`, log `PLAN_PICKING_STARTED` event. If multi-source: update matching `AllocationSourceSummary` rows to `sourceStatus: "PICKING"`. |
| `modules/allocation_plans/allocationPlan.service.ts` | Add `completePicking(planId, orgId, actorUserId)`: validate plan `status === "PICKING"`, verify all pick list lines have `quantityPicked > 0`, update plan to `PICKED`, log event. If multi-source: update source summaries to `PICKED`. |
| `modules/allocation_plans/allocationPlan.routes.ts` | Add `POST /:id/start-picking` → `startPicking`. Add `POST /:id/complete-picking` → `completePicking`. |
| `modules/dispatches/dispatches.service.ts` | In `sendDispatch`, after setting dispatch `IN_TRANSIT`: if `dispatch.pickList?.allocationSourceSummaryId` or if the dispatch has a linked `allocationSourceSummary`, update that summary's `sourceStatus` to `"DISPATCHED"` and set `dispatchedAt`. |
| `services/stockRequestQuantity.service.ts` | Add `computeAllocationCompletionSummary(stockRequestId)`: load SR items, all dispatches (dispatched qty), all backorders (remaining qty), all cancelled lines. Return `{ totalDemand, totalDispatched, totalBackordered, totalCancelled, isFullyAccountedFor }`. |
| `modules/allocation_plans/allocationPlan.controller.ts` | Wire the two new route handlers. |

**Frontend scope:**

| File | Task |
|------|------|
| `bpa_web/app/owner/(larkon)/inventory/allocation/[id]/page.tsx` | Add "Start Picking" button (visible when plan CONFIRMED). Add "Complete Picking" button (visible when plan PICKING). Wire to new endpoints. |

**Schema/migration scope:** None (PICKING, PICKED already in `AllocationPlanStatus` enum; PICKING, PICKED, DISPATCHED already in `AllocationSourceStatus` enum)

**API scope:**
- `POST /api/v1/allocation-plans/:id/start-picking` — new
- `POST /api/v1/allocation-plans/:id/complete-picking` — new

**Status model impact:**

| Model | Transition | Trigger |
|-------|-----------|---------|
| AllocationPlan | CONFIRMED → PICKING | `startPicking` called |
| AllocationPlan | PICKING → PICKED | `completePicking` called |
| AllocationSourceSummary | CONFIRMED → PICKING | `startPicking` (multi-source) |
| AllocationSourceSummary | PICKING → PICKED | `completePicking` (multi-source) |
| AllocationSourceSummary | PICKED → DISPATCHED | `sendDispatch` (when linked) |

**Permission impact:** New endpoints need `inventory.fulfill` or equivalent permission check.

**QA scenarios:**
1. Confirm plan → call `start-picking` → plan is PICKING
2. Call `start-picking` on non-CONFIRMED plan → 400 error
3. Complete all pick lines → call `complete-picking` → plan is PICKED
4. Call `complete-picking` with unpicked lines → 400 error
5. Send dispatch linked to source summary → summary status is DISPATCHED
6. `computeAllocationCompletionSummary` returns correct totals

**Acceptance criteria:**
- Plan transitions: CONFIRMED → PICKING → PICKED are enforced
- Source summary tracks per-source lifecycle
- Warehouse queue filters work for all three statuses

---

### PHASE 6: Warehouse Queue/Pick/Dispatch Completion

**Objective:** Complete pick list management. Auto-create dispatch from pick. Pagination. Print.

**Backend scope:**

| File | Task |
|------|------|
| `modules/allocation_plans/allocationPlan.service.ts` | Add `createPickListFromPlan(planId, orgId)`: (a) validate plan CONFIRMED or PICKING, (b) if pick list already exists and is not CANCELLED, return it, (c) create PickList with `status: "PENDING"`, lines from `allocationPlanLines` where `quantityAllocated > 0`, (d) link to `AllocationSourceSummary` if single-source. For multi-source: create one pick list per source summary — requires **removing the unique constraint** on `PickList.allocationPlanId` (see migration scope). |
| `modules/allocation_plans/allocationPlan.service.ts` | Add `updatePickListLine(pickListLineId, quantityPicked, orgId)`: validate PickList is `PENDING` or `IN_PROGRESS`, update line, set PickList to `IN_PROGRESS` if still `PENDING`. |
| `modules/dispatches/dispatches.service.ts` | Add `createDispatchFromPickList(pickListId, orgId, data)`: (a) load pick list with lines, plan, SR, (b) validate pick list `COMPLETED`, (c) create StockDispatch with items from picked lines (variantId, lotId, quantityDispatched = quantityPicked), (d) link dispatch to pick list via `pickList.stockDispatchId`, (e) link to AllocationSourceSummary if available. |
| `services/warehouseFulfillmentQueue.service.ts` | Add pagination: accept `{ limit?: number, offset?: number }` in opts. Default `limit: 50`. Apply to the Prisma query. Return `{ items: [...], total: number }`. |
| `modules/allocation_plans/allocationPlan.routes.ts` | Add `POST /:id/pick-list` → `createPickListFromPlan`. Add `PATCH /pick-list-lines/:lineId` → `updatePickListLine`. Add `POST /pick-lists/:id/complete` → `completePicking` (marks pick list COMPLETED + plan PICKED if all pick lists done). |
| `modules/dispatches/dispatches.routes.ts` | Add `POST /from-pick-list/:pickListId` → `createDispatchFromPickList`. |
| Print service | Add `GET /api/v1/allocation-plans/:id/print/pick-list` returning HTML with: plan details, SR reference, per-line variant/lot/location/qty-to-pick. |

**Frontend scope:**

| File | Task |
|------|------|
| `bpa_web/app/owner/(larkon)/inventory/allocation/[id]/page.tsx` | Add pick list section: (a) "Create Pick List" button when plan CONFIRMED and no active pick list, (b) pick line table with `quantityToPick` and editable `quantityPicked`, (c) "Mark Picked" per-line, (d) "Complete Pick List" button when all lines picked, (e) "Create Dispatch" button when pick list COMPLETED, (f) "Print Pick List" link. |
| `bpa_web/app/owner/(larkon)/inventory/warehouse-fulfillment/page.tsx` | Add pagination controls. Call API with `limit` and `offset`. Show page indicator. |

**Schema/migration scope:**

New migration required: `prisma/migrations/2026MMDD_pick_list_per_source/migration.sql`
```sql
-- Remove unique constraint on PickList.allocationPlanId to allow per-source pick lists
ALTER TABLE "pick_lists" DROP CONSTRAINT IF EXISTS "pick_lists_allocationPlanId_key";
-- Add non-unique index for query performance
CREATE INDEX IF NOT EXISTS "pick_lists_allocationPlanId_idx" ON "pick_lists" ("allocationPlanId");
```
Update `prisma/schema.prisma`: change `allocationPlanId` on `PickList` from `@unique` to have `@@index([allocationPlanId])`.

**API scope:**
- `POST /api/v1/allocation-plans/:id/pick-list` — new
- `PATCH /api/v1/allocation-plans/pick-list-lines/:lineId` — new
- `POST /api/v1/allocation-plans/pick-lists/:id/complete` — new
- `POST /api/v1/inventory/dispatches/from-pick-list/:pickListId` — new
- `GET /api/v1/allocation-plans/:id/print/pick-list` — new

**Status model impact:**

| Model | Transition | Trigger |
|-------|-----------|---------|
| PickList | (created) → PENDING | `createPickListFromPlan` |
| PickList | PENDING → IN_PROGRESS | first `updatePickListLine` |
| PickList | IN_PROGRESS → COMPLETED | `completePicking` (all lines picked) |

**Permission impact:** Pick list endpoints need `warehouse.operations` or `inventory.fulfill`.

**QA scenarios:**
1. Create pick list from confirmed plan → pick list with correct lines
2. Update pick line quantities → pick list moves to IN_PROGRESS
3. Complete all lines → mark complete → pick list COMPLETED, plan PICKED
4. Create dispatch from completed pick list → dispatch CREATED with correct items
5. Send dispatch → dispatch IN_TRANSIT
6. Warehouse queue with 60+ plans → paginated response, page 1 shows 50
7. Print pick list → readable HTML with variant/lot/location

**Acceptance criteria:**
- Full pick → dispatch cycle works end-to-end from UI
- Queue is paginated
- Pick list printable

---

### PHASE 7: Branch Receive/GRN/Discrepancy Completion

**Objective:** Harden the session-based receive. Add concurrent guards. Verify partial receive. Improve branch UX.

**Backend scope:**

| File | Task |
|------|------|
| `modules/dispatches/dispatches.service.ts` | In `receiveDispatch` (all modes): add `SELECT ... FOR UPDATE` on `StockDispatch` row at the start of the transaction, before any session or ledger operations. This prevents concurrent receives for the same dispatch. |
| `modules/dispatches/dispatches.service.ts` | In `confirmDispatchReceiveFromSession`: after ledger posting, if `allReceived` is true and dispatch has `stockRequest.allocationPlan`, find the corresponding `AllocationSourceSummary` and verify its status reflects completion. No new status needed — `DISPATCHED` on summary is sufficient since delivery is tracked at the dispatch level. |
| `modules/dispatches/dispatches.service.ts` | Verify partial receive behavior (already confirmed in code): when `confirmDispatchReceiveFromSession` runs and `allReceived === false`, session goes back to `DRAFT`, session lines are deleted, dispatch stays `IN_TRANSIT`. This is correct — no change needed. Document this behavior in code comments. |
| `modules/dispatches/dispatches.service.ts` | In `resolveDispatchDiscrepancy`: verify it creates a `StockAdjustmentRequest` or directly adjusts `StockBalance`. If it only updates the discrepancy status without balance adjustment, add: create `StockLedger` entry with type `ADJUSTMENT` for the discrepancy quantity and update `StockBalance`. |
| `services/branchInboundQueue.service.ts` | Add `sessionStatus` field to queue items: if `dispatchReceiveSession` exists, include its `status` (DRAFT, AWAITING_CONFIRMATION, POSTED, CANCELLED). |

**Frontend scope:**

| File | Task |
|------|------|
| `bpa_web/app/staff/(larkon)/branch/[branchId]/inventory/incoming/[dispatchId]/page.jsx` | (a) Add step indicator: "1. Verify items → 2. Submit for review → 3. Manager confirms". Highlight current step based on session status. (b) Show "Awaiting Manager Confirmation" banner when session is AWAITING_CONFIRMATION. (c) After partial receive (session back to DRAFT), show "Partial receive complete. Verify remaining items." message. |
| `bpa_web/app/staff/(larkon)/branch/[branchId]/inventory/incoming/page.jsx` | Add session status badge per item: "Draft", "Awaiting Confirm", "Posted". Use `sessionStatus` from inbound queue response. |

**Schema/migration scope:** None

**API scope:** No new endpoints. Existing session endpoints already handle all modes.

**Status model impact:**

Existing behavior (verified, no changes):

| Receive outcome | Dispatch status | Session status | SR status |
|-----------------|----------------|----------------|-----------|
| All items received | DELIVERED | POSTED | RECEIVED_FULL |
| Partial items received | IN_TRANSIT (unchanged) | DRAFT (reset, lines deleted) | PARTIALLY_RECEIVED |
| All dispatches delivered, all lines accounted | DELIVERED | POSTED | RECEIVED_FULL |
| Some dispatches delivered, some not | Mix | Mix | PARTIALLY_RECEIVED |

**Permission impact:** None

**QA scenarios:**
1. Full receive: verify all → submit → manager confirm → dispatch DELIVERED, GRN created, SR RECEIVED_FULL
2. Partial receive: verify 3 of 5 items → submit → confirm → dispatch stays IN_TRANSIT, session reset to DRAFT, SR PARTIALLY_RECEIVED
3. After partial: verify remaining 2 items → submit → confirm → dispatch DELIVERED, SR RECEIVED_FULL
4. Concurrent: open two browser tabs on same dispatch receive → first confirm succeeds, second gets lock error
5. Discrepancy: receive with damaged items → StockDispatchDiscrepancy created → resolve discrepancy → balance adjusted
6. Branch inbound queue shows session status badges

**Acceptance criteria:**
- No data corruption from concurrent receives
- Partial receive cycle works cleanly
- Session step indicator visible
- Discrepancy resolution adjusts balances

---

### PHASE 8: Backorder/Supplementary Fulfillment Completion

**Objective:** Close the second-wave fulfillment loop. Backorder → supplementary plan → pick → dispatch → receive.

**Backend scope:**

| File | Task |
|------|------|
| `modules/allocation_plans/allocationPlan.service.ts` | Add `createSupplementaryPlan(parentPlanId, orgId, actorUserId, opts?)`: (a) Load parent plan + its backorders where `status === "OPEN"`. (b) Validate parent plan is CONFIRMED or later. (c) Create new `AllocationPlan` with `parentPlanId`, same `stockRequestId`, same `fromLocationId` / `warehouseId`. (d) Run FEFO for backordered variants. (e) Update each resolved backorder: `fulfilledQty += allocated`, `remainingQty -= allocated`, `supplementaryPlanId = newPlan.id`. If `remainingQty <= 0`, set `status: "FULFILLED"`. If partially resolved, set `status: "PARTIALLY_FULFILLED"`. (f) Log event `SUPPLEMENTARY_PLAN_CREATED`. |
| `modules/backorders/backorder.service.ts` | Add `resolveBackorder(backorderId, orgId, actorUserId)`: (a) Load backorder, validate `status === "OPEN" or "PARTIALLY_FULFILLED"`. (b) Call `createSupplementaryPlan` with the parent `allocationPlanId`. (c) Return the supplementary plan. |
| `modules/backorders/backorder.routes.ts` | Add `POST /:id/resolve` → `resolveBackorder`. |
| `modules/backorders/backorder.controller.ts` | Wire `resolve` handler. |
| `services/stockRequestStatus.service.ts` | Update `deriveRequestStatus`: if `request` has multiple allocation plans (via supplementary chain), consider dispatches from ALL plans, not just the first. This requires passing `allPlans` or `allDispatches` into the function. The simplest change: the function already accepts `dispatches?: Array<{ status: string }>` — callers must pass ALL dispatches for the SR, which `markStockRequestStatusFromDispatchReceive` already does (it queries `stockDispatch.findMany({ where: { stockRequestId } })`). So `deriveRequestStatus` is already correct for multi-plan. Verify and add a code comment. |
| `modules/stock_requests/stock_requests.service.ts` | Add `closeRequest(requestId, orgId)`: validate `canTransitionTo(current, "CLOSED", { allLinesAccountedFor: true })`. If allowed, set `status: "CLOSED"`. |
| `modules/stock_requests/stock_requests.routes.ts` | Add `POST /:id/close` → `closeRequest`. |

**Frontend scope:**

| File | Task |
|------|------|
| `bpa_web/app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` | If SR has backorders: show backorder section with table (variant, shortageQty, status). "Resolve" button per open backorder → calls `POST /backorders/:id/resolve`. Link to supplementary plan when created. |
| `bpa_web/app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` | If SR is RECEIVED_FULL or all lines accounted: show "Close Request" button → calls `POST /stock-requests/:id/close`. |
| New or existing page | Backorder list page: `app/owner/(larkon)/inventory/backorders/page.tsx`. Table of backorders with filters (status, variant). "Resolve" action per row. Link to parent plan and supplementary plan. |

**Schema/migration scope:** None (parentPlanId, supplementaryPlanId already exist)

**API scope:**
- `POST /api/v1/backorders/:id/resolve` — new
- `POST /api/v1/stock-requests/:id/close` — new

**Status model impact:**

| Model | Transition | Trigger |
|-------|-----------|---------|
| Backorder | OPEN → FULFILLED | `resolveBackorder` (full allocation) |
| Backorder | OPEN → PARTIALLY_FULFILLED | `resolveBackorder` (partial allocation) |
| AllocationPlan (supplementary) | DRAFT → ALLOCATED/PARTIAL | `createSupplementaryPlan` (FEFO run) |
| StockRequest | RECEIVED_FULL → CLOSED | `closeRequest` |
| StockRequest | CANCELLED → CLOSED | `closeRequest` |

**Permission impact:** `backorders.resolve` permission (or `inventory.fulfill`). `stock-requests.close` permission (or `inventory.update`).

**QA scenarios:**
1. Confirm plan with shortage → backorder created with correct `shortageQty`
2. Resolve backorder → supplementary plan created with `parentPlanId` set
3. Supplementary plan runs FEFO → allocates available stock
4. Confirm supplementary plan → pick → dispatch → receive → SR moves to RECEIVED_FULL
5. Backorder status is FULFILLED after supplementary dispatch received
6. Close SR after all waves complete → SR is CLOSED
7. Attempt close on SR with open backorders → rejected (allLinesAccountedFor is false)

**Acceptance criteria:**
- Backorder → supplementary plan → full lifecycle works
- SR CLOSED status reachable
- Multi-wave fulfillment correctly reflected in SR status

---

### PHASE 9: Legacy Retirement

**Objective:** Gate legacy write operations. Enterprise is the only path for new orders.

**Backend scope:**

| File | Task |
|------|------|
| `modules/transfers/transfers.routes.ts` | Add middleware to all POST/PATCH routes: check `process.env.LEGACY_TRANSFERS_ENABLED !== "false"` (default: `"false"`). If disabled, return `410 Gone` with body `{ error: "Legacy transfers are disabled. Use allocation plan flow.", code: "LEGACY_DISABLED" }`. Keep GET routes open for read access. |
| `modules/stock_requests/stock_requests.controller.ts` | In `fulfill` handler: add early check `if (process.env.DISABLE_LEGACY_STOCK_REQUEST_FULFILL !== "false") return res.status(410).json(...)`. Default `DISABLE_LEGACY_STOCK_REQUEST_FULFILL` to `"true"`. |
| `modules/stock_requests/stock_requests.controller.ts` | In `dispatch` handler: same gate as above. |
| `services/legacyFulfillmentGuard.service.ts` | Simplify: if `DISABLE_LEGACY_STOCK_REQUEST_FULFILL` is truthy (default), always throw. Remove complex plan/backorder checks (they become redundant). Keep the function signature for backward compatibility. |

**Frontend scope:**

| File | Task |
|------|------|
| `bpa_web/app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` | Remove the "Quick Dispatch (Legacy)" section entirely. Only show enterprise fulfillment path. |
| `bpa_web/app/staff/(larkon)/branch/[branchId]/inventory/incoming/page.jsx` | Keep legacy transfer items in the list for in-flight transfers. Add "(Legacy)" badge. Do not show "Receive" action for legacy items unless transfer is in SENT/IN_TRANSIT state. |

**Schema/migration scope:** None

**API scope:** No new endpoints. Existing endpoints gated.

**Status model impact:** None

**Permission impact:** None

**QA scenarios:**
1. With `LEGACY_TRANSFERS_ENABLED=false`: `POST /transfers` returns 410
2. With `DISABLE_LEGACY_STOCK_REQUEST_FULFILL=true`: `PATCH /stock-requests/:id/fulfill` returns 410
3. Legacy transfer in SENT state: `POST /transfers/:id/receive` still works (read the flag, but in-flight transfers bypass)
4. UI does not show legacy buttons
5. Enterprise path works normally
6. With both flags set to allow legacy (emergency): legacy flow still works

**Acceptance criteria:**
- No new legacy transfers created by default
- In-flight transfers can complete
- Emergency re-enable via env flag works

---

### PHASE 10: QA/Validation/Rollout

**Objective:** Full test coverage, browser QA, staged production deploy.

**Backend scope:**

| File | Task |
|------|------|
| `tests/flow/enterprise-happy-path.test.ts` | New test: create SR → start fulfillment → confirm plan → start picking → complete picking → create dispatch from pick → send dispatch → session receive (verify → submit → confirm) → verify SR RECEIVED_FULL, GRN exists, dispatch DELIVERED |
| `tests/flow/partial-dispatch.test.ts` | New test: confirm plan → create dispatch for half qty → send → receive → SR PARTIALLY_RECEIVED → create second dispatch → send → receive → SR RECEIVED_FULL |
| `tests/flow/shortage-backorder.test.ts` | New test: confirm plan with shortage → backorder created → resolve backorder → supplementary plan → full lifecycle → SR RECEIVED_FULL → close → SR CLOSED |
| `scripts/simulateStockFlow.ts` | Update: use `POST /fulfillment/stock-requests/:id/start` instead of legacy fulfill. Use session-based receive instead of `legacy_immediate`. |
| `scripts/auditStockFlow.ts` | Add checks: (a) every dispatch-DELIVERED has a GRN, (b) every CONFIRMED plan has PICKING/PICKED/DISPATCHED progression or is CANCELLED, (c) AllocationSourceSummary status aligns with dispatch status, (d) SR status aligns with `deriveRequestStatus` |

**Frontend scope:** None (QA is manual browser testing per matrix)

**Schema/migration scope:** None

**API scope:** None

**QA scenarios:** See Browser QA Matrix in Section 13 of MASTER_EXECUTION_PLAN.md (30 scenarios)

**Acceptance criteria:**
- All flow tests pass
- Browser QA matrix 100% passed
- Audit script reports zero warnings
- Go-live checklist completed

---

## 3. MODULE-LEVEL TASKS

### prisma / migrations

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| MIG-01 | No-op 3 forward-reference migrations | P1 | — |
| MIG-02 | Consolidate DDL into 20260429120000 with IF NOT EXISTS guards | P1 | MIG-01 |
| MIG-03 | Add idempotency guards to MemberRole ADD VALUE (20260408180000) | P1 | — |
| MIG-04 | Fix drift reconciliation baseline (20260501000000) | P1 | — |
| MIG-05 | Run integrity check + shadow DB test | P1 | MIG-01..04 |
| MIG-06 | Prepare migrate resolve runbook | P1 | MIG-05 |
| MIG-07 | New migration: remove PickList.allocationPlanId unique constraint | P6 | MIG-05 |

### stock_requests

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| SR-01 | Add `closeRequest` function | P8 | — |
| SR-02 | Add `POST /:id/close` route | P8 | SR-01 |
| SR-03 | Gate `fulfill` handler (default disabled) | P9 | — |
| SR-04 | Gate `dispatch` handler (default disabled) | P9 | — |

### fulfillment

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| FUL-01 | Verify `startStockRequestFulfillment` works end-to-end | P2 | MIG-05 |

### allocation_plans

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| AP-01 | Add `startPicking(planId)` → plan PICKING | P5 | MIG-05 |
| AP-02 | Add `completePicking(planId)` → plan PICKED | P5 | AP-01 |
| AP-03 | Add `POST /:id/start-picking` route | P5 | AP-01 |
| AP-04 | Add `POST /:id/complete-picking` route | P5 | AP-02 |
| AP-05 | Update source summary status on pick transitions | P5 | AP-01, AP-02 |
| AP-06 | Add `createPickListFromPlan` | P6 | AP-01 |
| AP-07 | Add `updatePickListLine` | P6 | AP-06 |
| AP-08 | Add `POST /:id/pick-list` route | P6 | AP-06 |
| AP-09 | Add `PATCH /pick-list-lines/:lineId` route | P6 | AP-07 |
| AP-10 | Add `POST /pick-lists/:id/complete` route | P6 | AP-02, AP-06 |
| AP-11 | Add `createSupplementaryPlan` | P8 | AP-01 |
| AP-12 | Add pick list print endpoint | P6 | AP-06 |

### warehouse queue

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| WQ-01 | Add pagination to `listWarehouseFulfillmentQueue` | P6 | — |
| WQ-02 | Frontend: pagination controls on queue page | P6 | WQ-01 |

### pick lists

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| PK-01 | Pick list creation service | P6 | MIG-07 |
| PK-02 | Pick line update service | P6 | PK-01 |
| PK-03 | Pick list completion service | P6 | PK-02 |
| PK-04 | Pick list print HTML service | P6 | PK-01 |

### dispatches

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| DS-01 | Add `createDispatchFromPickList` | P6 | PK-03 |
| DS-02 | Add `POST /from-pick-list/:pickListId` route | P6 | DS-01 |
| DS-03 | Update `sendDispatch` to set source summary DISPATCHED | P5 | AP-05 |
| DS-04 | Add `SELECT FOR UPDATE` on dispatch in receive | P7 | — |

### receive session

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| RS-01 | Add concurrent receive guard (row lock) | P7 | — |
| RS-02 | Verify partial receive + re-verify works | P7 | RS-01 |
| RS-03 | Add `sessionStatus` to inbound queue response | P7 | — |

### GRN / discrepancy

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| GRN-01 | Verify discrepancy resolution adjusts balances | P7 | — |
| GRN-02 | If not: add ledger ADJUSTMENT entry on resolve | P7 | GRN-01 |

### backorders

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| BO-01 | Add `resolveBackorder` service function | P8 | AP-11 |
| BO-02 | Add `POST /:id/resolve` route | P8 | BO-01 |
| BO-03 | Wire controller handler | P8 | BO-02 |

### owner UI

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| OUI-01 | Redesign SR detail page (enterprise primary CTA) | P4 | — |
| OUI-02 | Add derived status column to SR list | P4 | — |
| OUI-03 | Improve warehouse queue page (badges, text) | P4 | — |
| OUI-04 | Add lifecycle timeline to allocation detail | P4 | — |
| OUI-05 | Add pick list UI to allocation detail | P6 | AP-08, AP-09 |
| OUI-06 | Add "Create Dispatch" from pick list | P6 | DS-02 |
| OUI-07 | Add backorder section to SR detail | P8 | BO-02 |
| OUI-08 | Add backorder list page | P8 | BO-02 |
| OUI-09 | Add "Close Request" button | P8 | SR-02 |
| OUI-10 | Remove legacy buttons | P9 | SR-03 |

### branch UI

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| BUI-01 | Add session status badges to incoming list | P7 | RS-03 |
| BUI-02 | Add step indicator to receive page | P7 | — |
| BUI-03 | Add partial receive messaging | P7 | RS-02 |
| BUI-04 | Add "(Legacy)" badge to transfer items | P9 | — |

### warehouse UI

No separate warehouse UI tasks beyond owner UI tasks (warehouse queue is under owner pages).

### print/docs

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| PRT-01 | Pick list print endpoint | P6 | AP-06 |

### tests

| Task ID | Description | Phase | Depends On |
|---------|-------------|-------|-----------|
| TST-01 | Enterprise happy path E2E test | P10 | All P1-P9 |
| TST-02 | Partial dispatch E2E test | P10 | TST-01 |
| TST-03 | Shortage/backorder E2E test | P10 | TST-01 |
| TST-04 | Update simulation script | P10 | TST-01 |
| TST-05 | Update audit script | P10 | TST-01 |

---

## 4. EDGE CASE MATRIX

### Final Expected Behavior for Each Scenario

| # | Scenario | What happens | Final SR status |
|---|----------|-------------|-----------------|
| E1 | **Stock enough** — request 60, warehouse has 100 | AllocationPlan lines total `quantityAllocated: 60`, `quantityShort: 0`. Plan ALLOCATED. Confirm → reserve 60. Pick 60 → dispatch 60 → receive 60. | RECEIVED_FULL → CLOSED |
| E2 | **Stock partial** — request 60, warehouse has 40 | Plan lines: `quantityAllocated: 40`, `quantityShort: 20`. Plan PARTIALLY_ALLOCATED. Confirm → reserve 40, create `ProcurementDemandLine` (qty 20), create `Backorder` (shortageQty 20). Pick 40 → dispatch 40 → receive 40 → SR PARTIALLY_RECEIVED. When backorder resolved via supplementary plan → second dispatch 20 → receive → RECEIVED_FULL. | RECEIVED_FULL → CLOSED |
| E3 | **Selected warehouse has 0** | Plan FAILED (zero allocation). Owner can: (a) reallocate with different `fromLocationId`, (b) add manual lines, (c) confirm with full shortage → backorder for everything. | Depends on owner action |
| E4 | **Another warehouse has stock** (multi-source off) | Same as E3. Owner must change `fromLocationId` manually and re-run FEFO. Multi-source is behind flag. | Depends on owner action |
| E5 | **Another warehouse has stock** (multi-source on) | `multiSourceAllocator` allocates across warehouses. `AllocationSourceSummary` created per source. Each source gets its own pick list and dispatch. All dispatches received → RECEIVED_FULL. | RECEIVED_FULL → CLOSED |
| E6 | **No warehouse has stock** | Plan FAILED. Confirm → full shortage → `ProcurementDemandLine` for all items, `Backorder` for all. Owner creates PO → vendor delivers → GRN → backorder resolved → supplementary plan. | Eventually RECEIVED_FULL |
| E7 | **Request 60, stock 40** | Same as E2. First wave: 40 dispatched. `fulfilledQty` on REQUESTED lines incremented. SR PARTIALLY_DISPATCHED → PARTIALLY_RECEIVED after first receive. Second wave via supplementary plan covers remaining 20. | RECEIVED_FULL → CLOSED |
| E8 | **Owner sends extra qty** | In enterprise flow: dispatch items are created from pick list lines which come from allocation lines. Allocation lines are bounded by `quantityAllocated`. To send extra, owner must add manual allocation line (`POST /allocation-plans/:id/lines/manual`) before confirming. The dispatch `quantityDispatched` will match the pick `quantityPicked`. SR status check compares `sum(quantityDispatched)` across all dispatches vs `sum(requestedQty)` on REQUESTED lines — over-fulfillment sets status `DISPATCHED` (not `PARTIALLY_DISPATCHED`). |  DISPATCHED → RECEIVED_FULL |
| E9 | **Owner adds extra item** | Owner adds manual allocation line for a variant not in the SR. This creates an `AllocationPlanLine` without a matching `StockRequestItem`. On dispatch, a `StockDispatchItem` is created for the extra variant. On receive, GRN line records it. The SR's `requestedQty` total doesn't include extra items, so `sum(dispatched) >= sum(requested)` → SR `DISPATCHED`. Extra items appear in GRN and receive records but don't affect SR line-level tracking. | DISPATCHED → RECEIVED_FULL |
| E10 | **Partial dispatch then supplementary dispatch** | First dispatch covers some items. `sendDispatch` → SR `PARTIALLY_DISPATCHED`. Second dispatch (from same plan or supplementary plan) covers rest. `sendDispatch` recalculates: `sum(quantityDispatched)` across all dispatches for this SR vs `sum(requestedQty)` → if `sum >= total`, SR `DISPATCHED`. | DISPATCHED → RECEIVED_FULL |
| E11 | **Branch receives short/damaged qty** | `receiveDispatchLedgerInTx`: `quantityReceived`, `quantityDamaged`, `quantityShort` recorded per line. `TRANSFER_IN` ledger for received qty. `DAMAGE` ledger for damaged. `StockDispatchDiscrepancy` created for damaged/short. If `received + damaged + short >= dispatched` for all lines → dispatch `DELIVERED`. SR → `RECEIVED_FULL` (all lines accounted for) or `PARTIALLY_RECEIVED`. | RECEIVED_FULL (accounted) or PARTIALLY_RECEIVED |
| E12 | **Multiple dispatches for one request** | Each dispatch is independent. `sendDispatch` aggregates ALL dispatch items for the SR to determine DISPATCHED vs PARTIALLY_DISPATCHED. `markStockRequestStatusFromDispatchReceive` checks ALL dispatches: if all DELIVERED and all lines accounted → RECEIVED_FULL, else PARTIALLY_RECEIVED. | RECEIVED_FULL when all delivered |

---

## 5. STATE MACHINE

### StockRequest Status Transitions (Canonical Target)

```
DRAFT ──────────────────────→ SUBMITTED
  │                              │
  └→ CANCELLED                   ├→ OWNER_REVIEW ──→ APPROVED ──→ DISPATCHED ──→ RECEIVED_FULL ──→ CLOSED
                                 │                      │              │                │
                                 ├→ DECLINED            │              │                └→ CANCELLED
                                 │                      │              │
                                 ├→ CANCELLED           │              └→ PARTIALLY_RECEIVED ──→ RECEIVED_FULL
                                 │                      │
                                 └→ APPROVED ───────────┘
                                    (via confirmPlan)    ├→ PARTIALLY_DISPATCHED ──→ DISPATCHED
                                                         │
                                                         └→ CANCELLED
```

**Transition triggers:**

| From | To | Trigger |
|------|----|---------|
| DRAFT | SUBMITTED | `submitRequest` |
| DRAFT | CANCELLED | `cancelRequest` |
| SUBMITTED | OWNER_REVIEW | `approveRequest` (manual) |
| SUBMITTED | APPROVED | `confirmPlan` (plan confirmed, `canTransitionTo` allows) |
| SUBMITTED | DECLINED | `declineRequest` |
| SUBMITTED | CANCELLED | `cancelRequest` |
| OWNER_REVIEW | APPROVED | `confirmPlan` |
| OWNER_REVIEW | CANCELLED | `cancelRequest` |
| APPROVED | DISPATCHED | `sendDispatch` (sum dispatched >= sum requested) |
| APPROVED | PARTIALLY_DISPATCHED | `sendDispatch` (sum dispatched < sum requested) |
| APPROVED | CANCELLED | `cancelRequest` |
| PARTIALLY_DISPATCHED | DISPATCHED | `sendDispatch` (subsequent dispatch, sum now >= total) |
| PARTIALLY_DISPATCHED | CANCELLED | `cancelRequest` |
| DISPATCHED | PARTIALLY_RECEIVED | `markStockRequestStatusFromDispatchReceive` (not all dispatches DELIVERED) |
| DISPATCHED | RECEIVED_FULL | `markStockRequestStatusFromDispatchReceive` (all DELIVERED, all lines accounted) |
| PARTIALLY_RECEIVED | RECEIVED_FULL | `markStockRequestStatusFromDispatchReceive` (remaining dispatches DELIVERED) |
| RECEIVED_FULL | CLOSED | `closeRequest` (Phase 8) |
| CANCELLED | CLOSED | `closeRequest` (Phase 8) |

### AllocationPlan Status Transitions (Target after Phase 5)

```
DRAFT ──→ ALLOCATED ──────────→ CONFIRMED ──→ PICKING ──→ PICKED ──→ (dispatch lifecycle)
  │         │                      │
  │         └→ PARTIALLY_ALLOCATED │
  │         │         │            │
  │         └→ FAILED─┘            └→ CANCELLED
  │                                     │
  └→ CANCELLED ─────────────────────────┘
```

| From | To | Trigger |
|------|----|---------|
| DRAFT | ALLOCATED | `runFefoForPlan` (full allocation) |
| DRAFT | PARTIALLY_ALLOCATED | `runFefoForPlan` (partial allocation) |
| DRAFT | FAILED | `runFefoForPlan` (zero allocation) |
| DRAFT | CONFIRMED | `confirmPlan` (manual lines added, skip FEFO) |
| ALLOCATED | CONFIRMED | `confirmPlan` |
| PARTIALLY_ALLOCATED | CONFIRMED | `confirmPlan` |
| FAILED | CONFIRMED | `confirmPlan` (manual lines added) |
| CONFIRMED | PICKING | `startPicking` (Phase 5) |
| PICKING | PICKED | `completePicking` (Phase 5) |
| Any non-terminal | CANCELLED | `cancelPlan` |

### StockDispatch Status Transitions

```
CREATED ──→ PACKED ──→ IN_TRANSIT ──→ DELIVERED
  │           │           │
  └→ CANCELLED └→ CANCELLED └→ FAILED
```

| From | To | Trigger |
|------|----|---------|
| CREATED | PACKED | `updateDispatchStatus` |
| CREATED | IN_TRANSIT | `sendDispatch` |
| PACKED | IN_TRANSIT | `sendDispatch` |
| IN_TRANSIT | DELIVERED | `receiveDispatchLedgerInTx` (all lines accounted) |
| Any | CANCELLED | `updateDispatchStatus` |
| IN_TRANSIT | FAILED | `updateDispatchStatus` |

### DispatchReceiveSession Status Transitions

```
(created) ──→ DRAFT ──→ AWAITING_CONFIRMATION ──→ POSTED
                │              │                     │
                │              └→ CANCELLED          │
                │                                    │
                └→ DRAFT (after partial confirm,     │
                   lines deleted, re-verify)         │
                                                     └→ (terminal)
```

| From | To | Trigger |
|------|----|---------|
| (new) | DRAFT | `saveDispatchReceiveVerification` |
| DRAFT | AWAITING_CONFIRMATION | `submitDispatchReceiveSessionForConfirmation` |
| AWAITING_CONFIRMATION | POSTED | `confirmDispatchReceiveFromSession` (all received) |
| AWAITING_CONFIRMATION | DRAFT | `confirmDispatchReceiveFromSession` (partial — lines deleted, re-verify) |
| DRAFT/AWAITING | CANCELLED | `cancelDispatchReceiveSession` |

### Backorder Status Transitions (Target after Phase 8)

```
OPEN ──→ PARTIALLY_FULFILLED ──→ FULFILLED
  │           │
  └→ CANCELLED └→ CANCELLED
```

| From | To | Trigger |
|------|----|---------|
| OPEN | PARTIALLY_FULFILLED | `resolveBackorder` (partial allocation in supplementary plan) |
| OPEN | FULFILLED | `resolveBackorder` (full allocation in supplementary plan) |
| PARTIALLY_FULFILLED | FULFILLED | subsequent `resolveBackorder` |
| Any | CANCELLED | `cancelPlan` cascades |

---

## 6. IMPLEMENTATION DEPENDENCIES

### Strict Ordering (must happen before)

```
MIG-01 ──→ MIG-02 ──→ MIG-05 ──→ MIG-06
MIG-03 ──→ MIG-05
MIG-04 ──→ MIG-05

MIG-05 ──→ FUL-01 (Phase 2 verification)
MIG-05 ──→ AP-01 (Phase 5 start)
MIG-05 ──→ MIG-07 (Phase 6 new migration)

AP-01 ──→ AP-02 ──→ AP-04
AP-01 ──→ AP-03
AP-01 ──→ AP-05

MIG-07 ──→ AP-06 ──→ AP-07 ──→ AP-08, AP-09
AP-06 ──→ AP-10
AP-06 ──→ DS-01 ──→ DS-02

AP-01 ──→ AP-11 ──→ BO-01 ──→ BO-02 ──→ BO-03

SR-01 ──→ SR-02

DS-01 ──→ DS-02

RS-01 ──→ RS-02

All P1-P8 tasks ──→ SR-03, SR-04 (Phase 9)
All P1-P9 tasks ──→ TST-01..TST-05 (Phase 10)
```

### Parallelizable

These task groups can run in parallel:
- **P1 migration tasks** (MIG-01..04) can all start simultaneously
- **P4 frontend tasks** (OUI-01..04) can all start after Phase 3
- **P5 backend + P4 frontend** can run in parallel
- **P7 backend (RS-01, GRN-01) + P7 frontend (BUI-01..03)** can run in parallel after dependencies met
- **P8 backorder tasks + P7 receive tasks** cannot overlap (P8 depends on P7)

---

## 7. CUTOVER STRATEGY

### Phase 1: Safe Foundation (No User Impact)

1. Deploy migration chain repairs
2. On every existing database, run:
   ```bash
   npx prisma migrate resolve --applied "20260404200000_enterprise_allocation_picking_enhancement"
   npx prisma migrate resolve --applied "20260408140000_procurement_demand_lines_central_fulfillment"
   npx prisma migrate resolve --applied "20260409180000_stock_transfer_enterprise_superseded_allocation_trigger"
   npx prisma migrate deploy
   ```
3. Verify `check-migration-integrity.js` passes on every environment

### Phase 2-3: Invisible (No User Impact)

- Schema/code sync is compile-time only
- Decision document is internal

### Phase 4: Gradual UI Shift

1. Deploy owner UI changes with `OWNER_PANEL_V2=true` env flag (optional)
2. Legacy "Fulfill & Dispatch" still works but is visually subordinate
3. No workflow broken — both paths still functional
4. Monitor: track which path owners choose (log in `warehouseAudit`)

### Phase 5-6: Additive Backend

1. New endpoints added (start-picking, complete-picking, pick-list, etc.)
2. Existing endpoints unchanged
3. No breaking changes
4. Monitor: verify new plan status transitions are occurring

### Phase 7: Hardened Receive

1. Row lock added to receive — transparent to users
2. Session status badges added — informational only
3. No workflow changes

### Phase 8: New Capabilities

1. Backorder resolve is a NEW feature — no existing behavior changes
2. SR close is a NEW feature — no existing behavior changes
3. Supplementary plans are NEW — no existing behavior changes

### Phase 9: Controlled Legacy Disable

**Pre-cutover checklist:**
1. Count in-flight legacy transfers: `SELECT COUNT(*) FROM stock_transfers WHERE status IN ('DRAFT', 'SENT', 'IN_TRANSIT')`
2. If count > 0: wait for completion or manually resolve
3. Communicate to all owners: "Legacy dispatch no longer available starting [date]"

**Cutover steps:**
1. Set `DISABLE_LEGACY_STOCK_REQUEST_FULFILL=true` in staging
2. Set `LEGACY_TRANSFERS_ENABLED=false` in staging
3. Run full QA on staging for 1 week
4. Deploy to production with same flags
5. Monitor error rates for 48 hours

**Emergency rollback:**
1. Set `DISABLE_LEGACY_STOCK_REQUEST_FULFILL=false`
2. Set `LEGACY_TRANSFERS_ENABLED=true`
3. Deploy — legacy immediately re-enabled, no data migration needed

### Phase 10: Production Validation

1. Run audit script against production data
2. Execute browser QA matrix
3. Sign off on go-live checklist
4. Remove emergency rollback flags from documentation after 30 days of clean operation

---

**Document created:** `docs/DELIVERY_SYSTEM_BUILD_BLUEPRINT.md`
**Source documents:** `DELIVERY_SYSTEM_CODE_TRUTH_AUDIT.md`, `DELIVERY_SYSTEM_GAP_ANALYSIS.md`, `DELIVERY_SYSTEM_MASTER_EXECUTION_PLAN.md`
