# Master flow audit and execution plan

**Path:** `docs/MASTER_FLOW_AUDIT_AND_EXECUTION_PLAN.md`
**Created / updated:** 2026-04-09
**Status:** Single source for architecture audit, gaps, and ordered implementation + verification
**Backend:** `D:\BPA_Data\backend-api`
**Frontend:** Active app in this monorepo is **`bpa_web`** (`D:\BPA_Data\bpa_web`). If a separate `web_app` tree exists elsewhere, treat it as an alias for the same product surface unless explicitly forked.

**Related reads:**
- `docs/COMPLETE_STOCK_REQUEST_DELIVERY_FLOW_ANALYSIS_AND_FIX_PLAN.md` — original gap analysis (partially superseded by implemented work; see §3).
- `docs/CENTRAL_WAREHOUSE_BRANCH_FULFILLMENT_ENTERPRISE_PLAN.md` — index to supply-chain QA, RBAC, state machine, tests.
- `docs/COMPLETE_STOCK_REQUEST_DELIVERY_FLOW_IMPLEMENTATION_SUMMARY.md` — what was shipped for queue + canonical status/quantity + legacy guards.

---

## 1. Executive summary

The BPA/WPA supply-chain stack implements **multiple fulfillment families** that must coexist without double-mutating `StockRequestItem.fulfilledQty`: **enterprise allocation → pick → `StockDispatch`**, **flexible owner fulfill (`StockTransfer`)**, **legacy `fulfillAndDispatch`**, **procurement demand → PO → GRN → optional auto-dispatch**, and **unified branch inbound** (dispatch + legacy transfer).

An end-to-end audit shows **substantial consolidation is already in place**: centralized quantity and status derivation (`stockRequestQuantity.service.ts`, `stockRequestStatus.service.ts`), branch classification (`branchTypeResolver.service.ts`), **allocation confirm → `StockRequest` → `APPROVED`** (semantic “ready to fulfill”) in `allocationPlan.service.ts`, **owner warehouse fulfillment queue** and **staff inbound queue** APIs, **controlled receive** via existing `DispatchReceiveSession`, and **legacy-vs-enterprise guards** (`shouldBlockLegacyOwnerFulfillment`).

Remaining work is **not** a greenfield rewrite; it is **closing semantic gaps**, **performance hardening**, **test and doc parity**, and **explicit PROCUREMENT vs INTERNAL_TRANSFER behavior** where the code still encodes assumptions (notably **procurement demand creation on shortage is INTERNAL_TRANSFER-only**).

Success means: every flow family has a **named owner module**, **branch-type rules are explicit**, **one canonical status/quantity story** surfaces in API + `bpa_web`, and **automated + manual verification** match `docs/SUPPLY_CHAIN_*` and browser QA lists.

---

## 2. Current flow inventory (as implemented)

### 2.1 Normal branch → warehouse fulfillment → dispatch → branch receive (enterprise)

| Step | Mechanism | Key code |
|------|-----------|----------|
| Draft / submit | `stock_requests` | `stock_requests.service.ts` — `resolveRequestIntent` via `getRequestIntent` (normal → `INTERNAL_TRANSFER`) |
| Owner allocation | `allocation_plans` | Create plan, FEFO / manual lines, **confirm** reserves + `CONFIRMED` |
| Confirm → request | Same transaction | `confirmPlan` → `StockRequest.status` → **`APPROVED`** when `canTransitionTo` allows (`allocationPlan.service.ts`) |
| Shortage → demand | Procurement | `createProcurementDemandLinesFromShortage` — **only if** `stockRequest.requestIntent === "INTERNAL_TRANSFER"` (`procurementDemand.service.ts`) |
| Warehouse queue | Owner API | `GET /api/v1/owner/warehouse/fulfillment-queue` → `listWarehouseFulfillmentQueue` — plans `CONFIRMED\|PICKING\|PICKED`, **INTERNAL_TRANSFER segment** default (`warehouseFulfillmentQueue.service.ts`, `owner.routes.ts`) |
| Pick / dispatch | `pick_lists`, `dispatches` | Existing pick/dispatch services; send moves dispatch toward `IN_TRANSIT` / receive path |
| Branch inbound | Staff API | `GET /api/v1/staff/branch/:branchId/inbound-queue` → `listBranchInboundQueue` on top of `getIncomingInboundUnifiedForBranch` (`inboundReceipts.service.ts`) |
| Controlled receive | Dispatch session | `DispatchReceiveSession` + routes under `dispatches.routes.ts`; facade `branchReceiveSession.service.ts` |

### 2.2 Warehouse branch → procurement / shortage / PO / GRN / re-fulfillment

| Step | Mechanism | Key code |
|------|-----------|----------|
| Intent | Branch type | `getRequestIntent` — warehouse category → **`PROCUREMENT`** default |
| Allocation + confirm | Same as enterprise | Plan confirm still promotes SR to **`APPROVED`** |
| Shortage demand lines | **Conditional** | `createProcurementDemandLinesFromShortage` **returns early** for non–`INTERNAL_TRANSFER` requests → **no automatic demand rows from shortage for pure PROCUREMENT SRs** (see §6) |
| PO / GRN sync | GRN receive | `grn.service.ts` → `syncProcurementDemandsFromPurchaseOrderLines` after receive |
| Auto-dispatch hook | Post-GRN | `autoFulfillmentQueue.service.ts` → `tryAutoDispatchFulfilledDemandsForGrn` (feature-flagged) |
| Owner UI | `bpa_web` | `/owner/inventory/procurement-demand`, `ownerApi` procurement-demand endpoints |

### 2.3 Legacy direct fulfill / transfer path

| Step | Mechanism | Key code |
|------|-----------|----------|
| Flexible fulfill | Owner | `fulfillStockRequestFlexible` — creates **`StockTransfer`**, updates lines |
| Legacy dispatch | Owner | `fulfillAndDispatch` — apportions lines, creates transfer |
| Guard | Status service | `shouldBlockLegacyOwnerFulfillment` when any non-cancelled `AllocationPlan` exists; env `ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT` narrows block (`stockRequestStatus.service.ts`) |
| Inbound | Unified | Legacy transfers **`SENT` / `IN_TRANSIT`** appear in `getIncomingInboundUnifiedForBranch` |

### 2.4 Enterprise allocation → pick → dispatch path

Covered in §2.1. Queue row logic: `warehouseFulfillmentQueue.service.ts` filters by plan status, `requestIntent`, and **canonical remaining qty** via `computeFullRequestSummary`.

### 2.5 Flexible fulfill path

Owner-driven **bypass** of allocation/pick/dispatch for **transfer-based** fulfillment; must stay behind **enterprise allocation guard** when a plan exists.

### 2.6 Inbound transfer / receiving flow

- **Unified list:** `inboundReceipts.service.ts` — dispatches (`PACKED`,`IN_TRANSIT`) + transfers (`SENT`,`IN_TRANSIT`).
- **Actionable queue:** `branchInboundQueue.service.ts` — receivable rows + `isBranchInboundActionable` + `DispatchReceiveSession` hints + `nextReceiveAction`.
- **Operational visibility:** `operationsVisibility.service.ts` — pending dispatch receive sessions counts.

### 2.7 Procurement demand / PO / GRN sync flow

- **Models:** `ProcurementDemandLine`, statuses in Prisma; backorder on `StockRequestItem` (`SUPPLY_CHAIN_STATE_MACHINE.md`).
- **Sync:** `procurementDemand.service.ts` — `syncProcurementDemandsFromPurchaseOrderLines`; tests in `procurementDemand.sync.test.ts`.
- **GRN:** `receiveGrn` path invokes sync (`grn.service.ts`).

### 2.8 Queues, badges, notifications, status derivation

| Concern | Implementation |
|--------|----------------|
| Canonical qty | `stockRequestQuantity.service.ts` — `computeFullRequestSummary` for detail/list contexts |
| Derived status | `deriveRequestStatus`, `getStatusDisplay`, `isWarehouseActionable`, `isBranchInboundActionable` |
| Owner list/detail | `stock_requests.service.ts` attaches summaries + derived fields; UI uses badges (`bpa_web` stock request pages) |
| Warehouse ops notifications | `warehouseOpsNotifications.service.ts` — vendor GRN + dispatch receive confirmation; `dispatches.notifications.ts` — staff `actionUrl` to inbound |
| Badges / menu | `permissionMenu.ts`, `branchSidebarConfig.ts` — warehouse fulfillment + inbound + procurement demand |

---

## 3. Canonical target flow inventory (desired semantics)

1. **Normal branch internal transfer:** `INTERNAL_TRANSFER` → owner allocation → confirm → **`APPROVED`** (ready) → warehouse queue (internal segment) → pick/dispatch → inbound queue → `DispatchReceiveSession` → ledger → SR terminal progression.
2. **Shortage on internal transfer:** demand lines + backorder + PO + GRN + optional auto-dispatch — **already coded for INTERNAL_TRANSFER**.
3. **Warehouse procurement narrative:** owner treats **`PROCUREMENT`** SRs as procurement-centric UX; **either** document that shortage-demand is **only** for internal transfer **or** extend shortage logic to PROCUREMENT SRs if product requires it (§6).
4. **Single mutation authority:** once enterprise allocation owns lifecycle (`shouldBlockLegacyOwnerFulfillment`), owner must not use flexible/legacy fulfill without escape hatch.
5. **Inbound:** enterprise dispatches use **session-first** receive; legacy transfers use **legacy receive** (`OPEN_LEGACY_TRANSFER_RECEIVE` in `branchInboundQueue.service.ts`).
6. **Observability:** audit events on confirm (`logPlanEvent`, `logWarehouseAudit`); notifications for receive awaiting confirmation.

**Naming note:** Prisma does not define `READY_TO_FULFILL`; the **canonical bridge** is **`APPROVED`** with label “Ready to Fulfill” in `getStatusDisplay`.

---

## 4. Branch-type matrix

| Dimension | Warehouse / DC (`WAREHOUSE_*`, `DISTRIBUTION_CENTER`) | Delivery hub (`DELIVERY_HUB` / similar) | Normal (clinic, shop, …) |
|-----------|------------------------------------------------------|----------------------------------------|---------------------------|
| Default `requestIntent` | `PROCUREMENT` | `INTERNAL_TRANSFER` (category not `WAREHOUSE`) | `INTERNAL_TRANSFER` |
| Primary owner queues | Procurement demand + PO/GRN; **not** default internal-transfer fulfillment queue segment | Often logistics — `canAccessWarehouseFulfillmentUI` true | Stock requests; receive inbound |
| `listWarehouseFulfillmentQueue` | Rows filtered: internal segment excludes PROCUREMENT; “ALL” segment optional | Same queue machinery as warehouse-capable UIs | N/A (requester) |
| Shortage → `ProcurementDemandLine` at confirm | **Skipped** if SR is `PROCUREMENT` (intent check) | Same as normal if `INTERNAL_TRANSFER` | **Yes** when `INTERNAL_TRANSFER` |
| Receiver | May receive vendor GRN + inter-branch dispatches per location | Same | Inbound queue + receive session |

---

## 5. Existing modules and ownership map

| Concern | Primary module / service | Routes / entry |
|--------|---------------------------|----------------|
| Stock request CRUD / submit | `modules/stock_requests/` | `/api/v1/stock-requests` |
| Intent + category | `branchTypeResolver.service.ts` | Used inside stock_requests + queues |
| Quantity | `stockRequestQuantity.service.ts` | Imported by stock_requests, warehouse queue |
| Status / guards | `stockRequestStatus.service.ts` | Imported widely |
| Allocation + confirm | `modules/allocation_plans/allocationPlan.service.ts` | `/api/v1/allocation-plans` |
| Procurement demand | `modules/procurement_demand/` | `/api/v1/procurement-demand` |
| GRN + PO sync | `modules/grn/grn.service.ts` | GRN routes |
| Auto-dispatch | `modules/fulfillment/autoFulfillmentQueue.service.ts` | Hooked from GRN |
| Dispatches + receive session | `modules/dispatches/` | `/api/v1/inventory/dispatches` (proxied as configured) |
| Unified inbound list | `modules/inventory/inboundReceipts.service.ts` | Used by branch inbound queue |
| Warehouse fulfillment queue | `warehouseFulfillmentQueue.service.ts` | Owner controller |
| Branch inbound queue | `branchInboundQueue.service.ts` | `staff_branch` queues |
| Staff queue HTTP | `modules/staff_branch/staffBranchQueues.*` | `/api/v1/staff/branch/:id/inbound-queue` |
| Notifications | `warehouseOpsNotifications.service.ts`, `dispatches.notifications.ts` | N/A |
| **Frontend (bpa_web)** | Owner/staff pages under `app/owner`, `app/staff`; API `lib/api.ts`, `ownerApi.ts` | See implementation summary §URLs |

---

## 6. All discovered gaps

| ID | Gap | Severity | Notes |
|----|-----|----------|--------|
| G-PROC-INTENT | `createProcurementDemandLinesFromShortage` only runs for **`INTERNAL_TRANSFER`** | **High (product)** | Warehouse `PROCUREMENT` SRs with allocation shortage **do not** get demand lines from this hook; may be intentional (procurement via PO only) — **must be decided and documented or code extended** |
| G-PERF | `listWarehouseFulfillmentQueue` calls `computeFullRequestSummary` per plan row | Medium | Batch/cache FEFO lookups for large orgs |
| G-DERIVE | `deriveRequestStatus` maps confirmed plan + `SUBMITTED`/`OWNER_REVIEW` → **`APPROVED`** for display; DB updated on confirm separately | Low | Possible transient mismatch if UI reads before refresh — rare |
| G-LEGACY-UI | Legacy transfer inbound still surfaced; `nextReceiveAction` = `OPEN_LEGACY_TRANSFER_RECEIVE` | Low | Expect dual UI until legacy retired |
| G-ENUM | Multiple overlapping `StockRequestStatus` values remain in Prisma | Medium | Consolidation is a **migration** project; until then, **derived** status is authoritative for UX |
| G-FLAGS | Auto-dispatch and reservation flags scattered in env | Medium | Centralize env documentation in one table (`PROJECT_CONTEXT` / go-live checklist) |
| G-FRONT-PARITY | All list surfaces must show `derivedStatusDisplay` + raw status tooltip where needed | Low | Owner/staff lists partially done — audit remaining tables |
| G-TEST | No single integration test spanning confirm → queue → inbound | Medium | Add targeted API integration test or scripted QA (§9) |

---

## 7. Root causes (historical + current)

1. **Parallel fulfillment paths** (enterprise vs flexible vs legacy) sharing `StockRequestItem` quantities — **mitigated** by `shouldBlockLegacyOwnerFulfillment` + UI flags.
2. **Evolution of enums** (`APPROVED` vs narrative `READY_TO_FULFILL`) — **mitigated** by display map, not a second DB state.
3. **Procurement demand tied to internal-transfer shortage** — **business rule** today; conflicts with narrative that “warehouse always procurement” if shortage demand is expected for those SRs.
4. **Queue visibility** was filter-based; **now** centralized queue services exist — residual risk is **performance** and **segment filters** (G-PERF).

---

## 8. Required code changes by area

### 8.1 Backend

| Priority | Change |
|----------|--------|
| P0 | **Decide** PROCUREMENT + shortage behavior: extend `createProcurementDemandLinesFromShortage` **or** document that PROCUREMENT SRs use PO creation without shortage lines. |
| P1 | Optimize `listWarehouseFulfillmentQueue` batching/caching. |
| P1 | Add integration test: `confirmPlan` → SR `APPROVED` → fulfillment-queue row → inbound-queue row (test DB or heavy mocks). |
| P2 | Align `deriveRequestStatus` dispatch statuses strictly with `StockDispatchStatus` enum (already `DELIVERED`-centric). |
| P2 | Audit all `StockRequestStatus` transitions on dispatch send/receive for consistency with `canTransitionTo`. |

### 8.2 Frontend (`bpa_web`)

| Priority | Change |
|----------|--------|
| P1 | Ensure **warehouse fulfillment** and **procurement demand** nav entries match permissions (`permissionMenu.ts`, `branchSidebarConfig.ts`). |
| P1 | Owner stock request filters: `requestIntent` badge + filter (partially present — complete parity with API). |
| P2 | Staff inbound: surface `nextReceiveAction` + session status without re-deriving rules client-side. |
| P2 | Notifications: keep `actionUrl` + `meta.stockRequestId` contract stable (`notifications/page.jsx`). |

### 8.3 Tests

| Artifact | Purpose |
|----------|---------|
| Extend `procurementDemand` tests | Cover PROCUREMENT vs INTERNAL_TRANSFER if behavior changes |
| `branchRoleMatrix.test.ts` | Branch-type RBAC stays aligned when adding routes |
| `dispatches.confirmation.test.ts` | Receive session lifecycle |
| New: `warehouseFulfillmentQueue` unit test | Mock Prisma, assert filter + segment |

### 8.4 Docs

| Doc | Update |
|-----|--------|
| `COMPLETE_STOCK_REQUEST_DELIVERY_FLOW_ANALYSIS_AND_FIX_PLAN.md` | Banner: “Partially superseded; see MASTER_FLOW…” |
| `SUPPLY_CHAIN_GOLIVE_CHECKLIST.md` | Checkbox for PROCUREMENT shortage rule |
| `CENTRAL_WAREHOUSE_BRANCH_FULFILLMENT_ENTERPRISE_PLAN.md` | Link this master doc |

---

## 9. Required automated verification artifacts

1. **Unit:** `stockRequestStatus.service.ts` — `shouldBlockLegacyOwnerFulfillment`, `isBranchInboundActionable`, `isWarehouseActionable`.
2. **Unit:** `stockRequestQuantity.service.ts` — line/request summaries, edge cases (EXTRA lines, cancelled).
3. **Unit:** `procurementDemand.sync.test.ts` — FIFO sync idempotency.
4. **Service:** `dispatches.confirmation.test.ts` + `dispatches.service.test.ts` — receive and status transitions.
5. **Integration:** `tests/flow/stockRequest.normalBranch.e2e.test.ts` + `stockRequest.warehouseBranch.e2e.test.ts` with `FLOW_E2E_DB=1` (see `FLOW_AUTOMATION_AND_VERIFICATION_SUMMARY.md`).
6. **CI:** Run `node scripts/check-migration-integrity.js` before/after any Prisma change (per `.cursorrules`).

---

## 10. Exact implementation order

1. **Product decision:** PROCUREMENT SR + shortage → demand lines Y/N (drives code).
2. If yes: patch `createProcurementDemandLinesFromShortage` + backorder rules + tests.
3. **Performance:** batch FEFO / `computeFullRequestSummary` for warehouse queue.
4. **API contract test** or minimal integration test for confirm → queues.
5. **Frontend:** intent filters/badges parity owner + staff lists.
6. **Docs:** cross-links + go-live checklist update.
7. **Staging:** run `docs/SUPPLY_CHAIN_BROWSER_QA_STEPS.md` + `CENTRAL_WAREHOUSE_PROCUREMENT_DEMAND_QA.md`.

---

## 11. Exact test order (manual + automated)

1. **Automated (local):** `npx jest stockRequestStatus` (if suite exists) → `procurementDemand.sync.test.ts` → `dispatches.confirmation.test.ts` → `branchRoleMatrix.test.ts` (when touched).
2. **Manual — internal transfer:** Browser QA table in `COMPLETE_STOCK_REQUEST_DELIVERY_FLOW_IMPLEMENTATION_SUMMARY.md` (stock request → allocation → confirm → warehouse fulfillment page → dispatch → inbound → receive session).
3. **Manual — procurement:** `CENTRAL_WAREHOUSE_PROCUREMENT_DEMAND_QA.md` + owner procurement-demand pages.
4. **Manual — legacy:** Flexible fulfill **without** allocation plan; then confirm plan exists and verify **409** on legacy endpoints + UI hides actions.
5. **Regression:** RBAC matrix `SUPPLY_CHAIN_PERMISSION_MATRIX.md`.

---

## 12. Risk notes

| Risk | Mitigation |
|------|------------|
| Changing PROCUREMENT shortage behavior could create duplicate demand rows | Transaction idempotency + unique constraints + tests |
| Queue performance on large datasets | Pagination, limit 300 already — add cursor pagination if needed |
| Env flag misuse (`ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT`) | Document in `PROJECT_CONTEXT.md`; default safe |
| Receive session vs direct receive API | Single owner: `DispatchReceiveSession` for enterprise dispatches |

---

## 13. Rollback notes

| Change type | Rollback |
|-------------|----------|
| Application code only | Revert commits; feature flags restore legacy behavior |
| New migration (if any for PROCUREMENT rules) | Follow `PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`; never reset production DB |
| Queue API | New endpoints are additive — disable routes via feature flag or revert router mount |

---

## Document control

- **Authoritative enums:** `prisma/schema.prisma` + `docs/SUPPLY_CHAIN_STATE_MACHINE.md`.
- **Single execution checklist:** this file + go-live checklist + browser QA steps.

---

## 14. Automated verification (scripts + tests)

**Detail:** See `docs/FLOW_AUTOMATION_AND_VERIFICATION_SUMMARY.md`.

| Artifact | Role |
|----------|------|
| `npm run simulate:flow` | Live DB end-to-end walkthrough with PASS/FAIL steps |
| `npm run audit:flow` | Read-only anomaly scan (queues, inbound, shortage/demand, legacy vs enterprise) |
| `npm run test:flow` | Jest suite under `tests/flow` via `jest.flow.config.js` (single worker + higher heap) |
| `jest.flow.config.js` | Isolates flow tests from main `src/**/*.test.ts` to avoid OOM |
| `procurementDemand.service.ts` | Shortage demand lines for **INTERNAL_TRANSFER** and **PROCUREMENT** intents |

**Integration tests** (`stockRequest.normalBranch.e2e.test.ts`, `stockRequest.warehouseBranch.e2e.test.ts`) run only when `FLOW_E2E_DB=1` and `FLOW_ORG_ID` + DB discovery succeed.

---

**End of master plan**
