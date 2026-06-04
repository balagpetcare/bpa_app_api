# Complete Stock Request Flow - Implementation Summary

**Status:** Backend + bpa_web hardening complete (legacy vs enterprise guards, canonical status/quantity on key UIs, receive notification links, docs QA URLs)
**Date:** 2026-04-09
**Branch:** `release/V-A1.0.7` (backend) / `release/V-A1.0.8` (bpa_web)

---

## Phase 1 backend completion (authoritative)

### Backend files changed

- `src/api/v1/modules/stock_requests/stock_requests.service.ts` — `getRequestById` / `listRequests` use canonical quantity + status + branch category; `assertLegacyOwnerFulfillmentAllowed` blocks legacy fulfill / preview / `fulfillAndDispatch` when an allocation plan exists (see `shouldBlockLegacyOwnerFulfillment`); improved “no dispatch” messaging; `fulfillAndDispatch` apportions before creating transfer (no orphan transfer on fully closed lines)
- `src/api/v1/modules/stock_requests/stock_requests.controller.ts` — maps `ALLOCATION_PLAN_BLOCKS_LEGACY` / legacy `ENTERPRISE_ALLOCATION_ACTIVE` → **409**, `NO_DISPATCHABLE_QUANTITY` → **422**
- `src/api/v1/services/stockRequestStatus.service.ts` — `shouldBlockLegacyOwnerFulfillment` (+ env `ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT` escape hatch); `isBranchInboundActionable` allows `APPROVED` when inbound exists
- `src/api/v1/services/warehouseOpsNotifications.service.ts` — dispatch receive “awaiting confirmation” `actionUrl` + `meta.stockRequestId` when resolvable
- `src/api/v1/modules/dispatches/dispatches.notifications.ts` — staff `actionUrl` for created/received → inbound queue path
- `src/api/v1/modules/allocation_plans/allocationPlan.service.ts` — `confirmPlan` transitions linked `StockRequest` to `APPROVED` when allowed; allocation plan audit event
- `src/api/v1/services/warehouseFulfillmentQueue.service.ts` — **new** owner-facing internal-transfer fulfillment queue
- `src/api/v1/services/branchInboundQueue.service.ts` — **new** staff-facing actionable inbound queue
- `src/api/v1/modules/owner/owner.controller.ts`, `owner.routes.ts` — `GET /owner/warehouse/fulfillment-queue`
- `src/api/v1/modules/staff_branch/staffBranchQueues.controller.ts`, `staffBranchQueues.routes.ts` — **new** `GET /staff/branch/:branchId/inbound-queue`
- `src/api/v1/routes.ts` — mount `/staff` queue router
- `docs/COMPLETE_STOCK_REQUEST_DELIVERY_FLOW_IMPLEMENTATION_SUMMARY.md` — this update

(Foundational services from earlier work: `stockRequestQuantity.service.ts`, `stockRequestStatus.service.ts`, `branchTypeResolver.service.ts`.)

### Root cause fixed

- **Allocation confirm → warehouse visibility:** confirming an allocation plan did not move the linked stock request into a warehouse-actionable DB status; `confirmPlan` now promotes `StockRequest` to `APPROVED` when `canTransitionTo` allows it (enterprise-safe, same transaction as confirm + procurement shortage lines).
- **Scattered summaries:** `getRequestById` / `listRequests` now attach the same canonical summaries and derived status fields used by queues.

### Queue visibility logic

- **Warehouse fulfillment (`listWarehouseFulfillmentQueue`):** `AllocationPlan.status ∈ { CONFIRMED, PICKING, PICKED }`, linked `StockRequest.requestIntent === INTERNAL_TRANSFER`, non-terminal request statuses. Rows included only if canonical **pending work** remains: `totalRemainingQty > 0`, or pick in progress, or PICKED with dispatch still `CREATED`/`PACKED`. **Procurement-intent** requests are excluded so they do not appear in this transfer fulfillment queue.
- **Branch inbound (`listBranchInboundQueue`):** builds on `getIncomingInboundUnifiedForBranch` (PACKED/IN_TRANSIT dispatches + SENT/IN_TRANSIT transfers), keeps only **receivable** rows, then requires `isBranchInboundActionable` for linked stock requests (or allows legacy rows without a request).

### Status derivation logic

- **API payloads:** `derivedStatus` / `derivedStatusDisplay` from `deriveRequestStatus(request, allocationPlan, dispatches)` on detail and list.
- **Queues:** warehouse rows expose the same derived effective status plus `nextAction` driven by plan status, pick list, and `hasPendingDispatch` from `computeRequestSummary` after `computeFullRequestSummary`.

### Branch-type handling

- **Requester category:** `requesterBranchCategory` via `getBranchCategory` (detail) or `getBranchCategoryFromCodes` (list, no extra queries).
- **Intent:** `resolvedRequestIntent` on detail (`getRequestIntent`); list uses stored intent or category default (warehouse → PROCUREMENT).
- **Queues:** warehouse fulfillment queue is **internal transfer only**; procurement/backorder continues via procurement demand / PO / GRN paths, not mixed into this queue.

### Known remaining work (non-blocking)

- Optional: warehouse-scoped queue filters (single DC location), pagination, and performance batching for `computeFullRequestSummary` inside queue loops.
- Legacy **StockTransfer** path (non-dispatch) inbound may still surface in older transfers UI alongside unified inbound; enterprise path uses `DispatchReceiveSession` + dispatch receive.

### Frontend (bpa_web) — Phase UI

**Files changed**

- `app/owner/(larkon)/inventory/warehouse-fulfillment/page.tsx` — owner queue UI (`GET /owner/warehouse/fulfillment-queue?segment=…`).
- `app/staff/(larkon)/branch/[branchId]/warehouse/inbound-transfers/page.tsx` — staff inbound list (`GET /staff/branch/:branchId/inbound-queue`).
- `app/staff/(larkon)/branch/[branchId]/inventory/incoming/[dispatchId]/page.jsx` — controlled receive (draft / submit / manager confirm) + PACKED/IN_TRANSIT.
- `lib/api.ts` — `staffInboundQueue`, `staffGet/Put/Submit/Confirm/CancelDispatchReceiveSession`.
- `src/lib/permissionMenu.ts` — owner nav: Warehouse fulfillment queue.
- `src/lib/branchSidebarConfig.ts` — staff nav: Inbound transfers (warehouse hub + normal branch).

**Routes/pages**

- `/owner/inventory/warehouse-fulfillment`
- `/staff/branch/:branchId/warehouse/inbound-transfers`

### Branch receive session flow (backend)

- **Model:** `DispatchReceiveSession` (existing) — not a new Prisma table.
- **Facade:** `src/api/v1/services/branchReceiveSession.service.ts` re-exports dispatches service functions.
- **REST (non-duplicative):**
  - `GET /api/v1/inventory/dispatches/:id/receive-session`
  - `PUT /api/v1/inventory/dispatches/:id/receive-session` (save draft = verify)
  - `POST .../receive-session/submit`
  - `POST .../receive-session/confirm` (manager permission)
  - `POST .../receive-session/cancel` (DRAFT → CANCELLED)
- **Inbound queue API** enriches each DISPATCH row with `dispatchReceiveSession` + `nextReceiveAction` (canonical hints).

### Frontend (bpa_web) — hardening

- `app/owner/(larkon)/inventory/stock-requests/page.tsx` — list shows `derivedStatusDisplay.label` (canonical) with tooltip for raw DB status when it differs
- `app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` — header badge uses derived status; legacy “Fulfill & Dispatch” hidden when `allocationPlanBlocksLegacyFulfill`; info alert documents enterprise vs legacy
- `app/staff/(larkon)/branch/[branchId]/inventory/stock-requests/page.jsx` — same derived status pattern on list
- `app/staff/(larkon)/branch/[branchId]/inventory/_components/StaffStockRequestDetailClient.jsx` — derived status badge + `canonicalRequestSummary` strip when API includes it
- `app/owner/(larkon)/notifications/page.jsx` — `DISPATCH_RECEIVE_AWAITING_CONFIRMATION` deep-links to stock request detail when `meta.stockRequestId` is present

---

## Final browser QA — exact URLs (Next.js fixed ports: use **3100–3105**, e.g. **3104**)

Replace `{branchId}`, `{id}`, `{planId}`, `{dispatchId}` with real IDs from your environment.

| Area | URL |
|------|-----|
| Owner stock requests list | `http://localhost:3104/owner/inventory/stock-requests` |
| Owner stock request detail | `http://localhost:3104/owner/inventory/stock-requests/{id}` |
| Owner allocation plans list | `http://localhost:3104/owner/inventory/allocation` |
| Owner allocation plan (pick / dispatch hub) | `http://localhost:3104/owner/inventory/allocation/{planId}` |
| Owner warehouse fulfillment queue | `http://localhost:3104/owner/inventory/warehouse-fulfillment` |
| Owner dispatch / challan (per SR) | `http://localhost:3104/owner/inventory/stock-requests/{id}/challan/{dispatchId}` |
| Staff branch stock requests list | `http://localhost:3104/staff/branch/{branchId}/inventory/stock-requests` |
| Staff branch stock request detail (canonical route) | `http://localhost:3104/staff/branch/{branchId}/inventory/stock-request-detail/{id}` |
| Staff inbound transfers queue | `http://localhost:3104/staff/branch/{branchId}/warehouse/inbound-transfers` |
| Staff receive session (dispatch) | `http://localhost:3104/staff/branch/{branchId}/inventory/incoming/{dispatchId}` |
| Procurement demand (if used) | `http://localhost:3104/owner/inventory/procurement-demand` |

**API:** `http://localhost:3000` (unchanged).

---

## Final branch-type matrix (behavior)

| Role | Branch type | Intent | Fulfillment path | Queues / notes |
|------|-------------|--------|------------------|----------------|
| Requester | Normal (clinic/shop) | `INTERNAL_TRANSFER` (default) | Enterprise: allocation → pick → dispatch; legacy fulfill only if **no** non-cancelled allocation plan | Owner: warehouse fulfillment queue (internal transfer segment). Receiver: inbound queue + receive session. |
| Requester | Warehouse (DC / central) | `PROCUREMENT` (default) | PO / procurement demand / GRN; **not** the internal-transfer fulfillment queue | Owner: procurement demand + PO/GRN flows; stock request list intent tab “Procurement”. |
| Source | Warehouse | n/a | Picks/dispatches from DC location | Warehouse fulfillment queue rows; allocation plan detail for pick/dispatch. |
| Receiver | Normal | n/a | Receives `PACKED` / `IN_TRANSIT` dispatch | Inbound transfers + `incoming/{dispatchId}`; `DispatchReceiveSession` for controlled receive. |

---

## Legacy vs enterprise (contradictions removed)

- **Single guard:** `shouldBlockLegacyOwnerFulfillment` — default blocks `fulfillStockRequestFlexible`, `fulfillAndDispatch`, and `allocationPreview` whenever an `AllocationPlan` row exists and `status !== CANCELLED`. This prevents double mutation of `fulfilledQty` vs enterprise pick/dispatch.
- **Escape hatch:** `ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT=true` restores the narrower block (only when plan status is CONFIRMED / PICKING / PICKED / DISPATCHED).
- **API flag:** `allocationPlanBlocksLegacyFulfill` on list/detail so the owner UI hides legacy fulfill consistently.
- **False “no dispatch”:** flexible fulfill now sets `message` from canonical `computeRequestSummary` (distinguishes “nothing remaining” vs “source cannot cover remaining need”).
- **Closed lines:** `fulfillAndDispatch` computes apportionment **before** `dispatchRequest`; throws `NO_DISPATCHABLE_QUANTITY` if no line would receive quantity (no orphan transfer).

---

## 1. Implementation Objective

Fix the end-to-end stock request → allocation → dispatch → transfer → receive flow by creating centralized services, unifying quantity/status logic, and bridging critical handoff gaps between warehouse fulfillment and branch receiving.

---

## 2. Root Causes Identified

1. **Handoff Gap:** AllocationPlan confirmation does not transition StockRequest to warehouse-visible state
2. **Branch Type Ignorance:** Warehouse vs normal branches not consistently distinguished in queue logic
3. **Quantity Formula Scatter:** Each module computes quantities independently → inconsistent results
4. **Legacy/Enterprise Conflict:** Two fulfill paths (`fulfillAndDispatch` vs `fulfillStockRequestFlexible`) mutate same data
5. **No Branch Receive Control:** No controlled receive session for inter-branch transfers (only for vendor GRNs)

---

## 3. Files Changed (Phase 1)

### 3.1 Created Services (New Files)

| File | Purpose | Status |
|------|---------|--------|
| `src/api/v1/services/stockRequestQuantity.service.ts` | Canonical quantity derivation (requested, fulfilled, cancelled, remaining, dispatchable) | ✅ Complete |
| `src/api/v1/services/stockRequestStatus.service.ts` | State machine logic, status transitions, queue actionability | ✅ Complete |
| `src/api/v1/services/branchTypeResolver.service.ts` | Warehouse vs normal branch detection, requestIntent resolution | ✅ Complete |

### 3.2 Modified Services (Partial Integration)

| File | Changes | Status |
|------|---------|--------|
| `src/api/v1/modules/stock_requests/stock_requests.service.ts` | Canonical summaries in `getRequestById` / `listRequests`; enterprise guard on legacy fulfill | ✅ Complete (Phase 1 scope) |

---

## 4. What Was Implemented (Phase 1 - Complete)

### 4.1 Centralized Quantity Service (`stockRequestQuantity.service.ts`)

**Functions:**
- `computeLineSummary(line, maxDispatchable?)` → Returns line-level quantities, lineStatus, canDispatchNow
- `computeRequestSummary(lineSummaries)` → Returns request-level totals, hasPendingDispatch, linesByStatus
- `computeMaxDispatchableByItemId(orgId, fromLocationId, lines)` → Shared pool logic across duplicate variants
- `computeFullRequestSummary(orgId, fromLocationId, lines)` → Full summary with FEFO-aware dispatchable quantities
- `validateFulfillmentSource(requestOrgId, fromLocationId)` → Org mismatch validation

**Impact:**
- Single source of truth for ALL quantity calculations
- Owner fulfill UI, warehouse queue, branch detail pages will now use consistent formulas
- Eliminates "No quantity could be dispatched" false errors caused by formula drift

### 4.2 Centralized Status Service (`stockRequestStatus.service.ts`)

**Functions:**
- `deriveRequestStatus(request, allocationPlan?, dispatches?)` → Compute effective status from context
- `canTransitionTo(from, to, context)` → Validate state transitions
- `isWarehouseActionable(request, allocationPlan)` → Should appear in warehouse queue?
- `isBranchInboundActionable(request, hasInboundDispatches)` → Should appear in branch inbound queue?
- `getStatusDisplay(status)` → UI label + badge color

**Impact:**
- Encapsulates state machine rules in one place
- Queue filters can now call `isWarehouseActionable` instead of ad hoc status checks
- Prevents invalid state transitions at service layer

### 4.3 Branch Type Resolver (`branchTypeResolver.service.ts`)

**Functions:**
- `isWarehouseBranch(branchId)` → true if WAREHOUSE_DC/WAREHOUSE/CENTRAL_WAREHOUSE
- `isDeliveryHubBranch(branchId)` → true if DELIVERY_HUB/DELIVERY/HUB
- `getBranchCategory(branchId)` → Returns 'WAREHOUSE' | 'DELIVERY_HUB' | 'NORMAL'
- `getRequestIntent(branchId, explicitIntent?)` → Returns 'PROCUREMENT' for warehouses, 'INTERNAL_TRANSFER' for normal
- `canAccessProcurementUI(branchId)` → UI feature gate
- `canAccessWarehouseFulfillmentUI(branchId)` → UI feature gate

**Impact:**
- Warehouse requests now consistently route to procurement queue
- Normal branch requests route to transfer fulfillment queue
- UI can show/hide features based on branch category

---

## 5. What Was Unified

### 5.1 Before (Scattered Logic)

- Quantity formulas computed inline in `getRequestById` (lines 779-820)
- Max dispatchable computed separately in owner UI vs warehouse UI
- Branch type detection duplicated in `resolveRequestIntent` and `branchRoleMatrix.ts`
- Status derivation ad hoc in each controller

### 5.2 After (Unified)

- **ONE** quantity service called by all modules
- **ONE** status service called by all modules
- **ONE** branch type resolver called by all modules
- Consistent results across owner/warehouse/branch contexts

---

## 6. How Queue Visibility Now Works (implemented)

### 6.1 Warehouse Fulfillment Queue

**API:** `GET /api/v1/owner/warehouse/fulfillment-queue`

**Implementation:** `warehouseFulfillmentQueue.service.ts` — see **Phase 1 backend completion** above (internal transfer only, canonical pending-work rules).

**UI Page:** `/owner/inventory/warehouse-fulfillment` (frontend still to wire to this API).

### 6.2 Branch Inbound Queue

**API:** `GET /api/v1/staff/branch/:branchId/inbound-queue`

**Implementation:** `branchInboundQueue.service.ts` — unified inbound, receivable-only, `isBranchInboundActionable` for linked requests.

**UI Page:** Staff incoming flows can consume this API alongside existing `/inventory/receipts/incoming-unified`.

---

## 7. How Statuses Now Derive

**Before:**
- Status set manually by controller methods
- No validation of allowed transitions
- Warehouse cannot tell if request is "ready to pick"

**After:**
- `deriveRequestStatus()` computes effective status from request + plan + dispatches
- AllocationPlan confirm will call `canTransitionTo()` before updating request status
- Queue filters call `isWarehouseActionable()` for consistent visibility

**Critical bridge (done):** On `CONFIRMED`, linked `StockRequest` is updated to `APPROVED` when `canTransitionTo` permits, with an `allocation_plan_events` row (`STOCK_REQUEST_APPROVED_ON_PLAN_CONFIRM`).

---

## 8. How Quantities Now Derive

**Formula (Canonical):**
```typescript
remainingQty = requestedQty - fulfilledQty - cancelledQty
maxDispatchable = FEFO effective available (onHandQty - reservedQty - qcHold - recall)
canDispatchNow = remainingQty > 0 && maxDispatchable > 0

// Request-level:
totalRequestedQty = sum of requestedQty (REQUESTED lines only)
totalFulfilledQty = sum of fulfilledQty (all lines)
totalRemainingQty = sum of remainingQty (REQUESTED lines only)
totalDispatchable = sum of min(maxDispatchable, remainingQty) per line
```

**Usage:**
- `getRequestById` calls `computeFullRequestSummary()` when `fromLocationId` provided
- Owner fulfill UI displays `maxDispatchableByItemId` and `totalDispatchable`
- Warehouse queue shows `hasPendingDispatch` badge

---

## 9. Notifications / inbound task links (implemented)

- **Dispatch created / in transit:** `notifyDispatchCreated` — staff `actionUrl` → `/staff/branch/{toBranchId}/warehouse/inbound-transfers` (queue-first).
- **Dispatch received:** `notifyDispatchReceived` — same inbound queue URL when `toBranchId` is known.
- **Branch receive submitted (manager confirm):** `notifyDispatchReceiveSubmittedForConfirmation` — owner `actionUrl` → `/owner/inventory/stock-requests/{stockRequestId}` when linked; `meta.stockRequestId` for notification deep-link.
- **Vendor GRN / procurement:** unchanged (`warehouseOpsNotifications` vendor paths); not mixed with branch transfer receive.

---

## 10. Remaining Work (Phase 1 Completion)

### 10.1 Integration Tasks (Critical)

1. ✅ ~~Create `stockRequestQuantity.service.ts`~~ **DONE**
2. ✅ ~~Create `stockRequestStatus.service.ts`~~ **DONE**
3. ✅ ~~Create `branchTypeResolver.service.ts`~~ **DONE**
4. ⚠️ **Update `stock_requests.service.ts` to use new services in `getRequestById`** (IN PROGRESS)
   - Replace lines 779-820 inline quantity logic with `computeFullRequestSummary()`
   - Replace lines 836-856 validation with `validateFulfillmentSource()`
   - Return `requestSummary`, `lineSummaries`, `maxDispatchableByItemId` in response
5. ⚠️ **Update `allocationPlan.service.ts` `confirmPlan` to transition StockRequest status** (NOT STARTED)
   - After plan confirm, call `canTransitionTo(currentStatus, 'APPROVED', context)`
   - If allowed, update StockRequest.status → 'APPROVED'
   - Emit audit event
6. ⚠️ **Create `warehouseFulfillmentQueue.service.ts`** (NOT STARTED)
   - `getWarehouseFulfillmentQueue(orgId, warehouseId?, branchId?)`
   - Filter using `isWarehouseActionable()` from status service
7. ⚠️ **Create `branchInboundQueue.service.ts`** (NOT STARTED)
   - `getBranchInboundQueue(orgId, branchId)`
   - Filter using `isBranchInboundActionable()` from status service

### 10.2 Backend API Routes (Critical)

8. ⚠️ **Add queue controller + routes** (NOT STARTED)
   - `GET /api/v1/owner/warehouse/fulfillment-queue`
   - `GET /api/v1/staff/branch/:branchId/inbound-queue`

### 10.3 Frontend Updates (High Priority)

9. ⚠️ **Create/Update warehouse fulfillment queue page** (NOT STARTED)
   - New page: `/owner/inventory/warehouse-fulfillment`
   - Table: Request ID, Branch, Intent, Status, Total Remaining, Total Dispatchable, Next Action button
   - Filters: requestIntent (All / Transfer / Procurement), branchCategory (All / Warehouse / Normal)
10. ⚠️ **Update branch inbound queue page** (NOT STARTED)
   - Update: `/staff/branch/[branchId]/warehouse/inbound-transfers`
   - Add controlled receive session UI (draft → submit → manager confirm)

---

## 11. Browser Verification Steps (After Full Implementation)

### 11.1 Normal Branch → Warehouse → Receive Flow

1. Branch creates request: `http://localhost:3104/staff/branch/1/inventory/stock-requests/new`
   - Expected: Status = SUBMITTED, requestIntent = INTERNAL_TRANSFER
2. Owner creates allocation plan: `http://localhost:3104/owner/inventory/allocation-plans/new`
   - Expected: Plan status = ALLOCATED
3. Owner confirms allocation plan: `http://localhost:3104/owner/inventory/allocation-plans/[id]`
   - Expected: Plan status = CONFIRMED, **Stock request status = APPROVED**
4. Warehouse sees request in queue: `http://localhost:3104/owner/inventory/warehouse-fulfillment` (new)
   - Expected: Request appears with "Ready to Fulfill" badge
5. Warehouse creates dispatch → sends: `http://localhost:3104/owner/inventory/dispatches/[id]`
   - Expected: Request status = DISPATCHED
6. Branch sees inbound transfer: `http://localhost:3104/staff/branch/1/warehouse/inbound-transfers`
   - Expected: Transfer appears with IN_TRANSIT status
7. Branch receives transfer: Same URL, click "Receive"
   - Expected: Request status = RECEIVED or PARTIALLY_RECEIVED

### 11.2 Warehouse Branch Procurement Flow

1. Warehouse branch creates request: `http://localhost:3104/staff/branch/2/inventory/stock-requests/new` (branch 2 = warehouse)
   - Expected: Status = SUBMITTED, **requestIntent = PROCUREMENT**
2. Owner sees procurement request: `http://localhost:3104/owner/inventory/stock-requests?intent=PROCUREMENT`
   - Expected: Request appears with "Procurement" badge
3. Owner creates allocation plan → partial allocation → confirm
   - Expected: ProcurementDemandLines created with status = PENDING
4. Owner creates PO → receives GRN
   - Expected: Demand lines status = READY_TO_FULFILL
5. Warehouse dispatches to requester
   - Expected: Request status = DISPATCHED → RECEIVED

---

## 12. Risks / Follow-up Items

### 12.1 Risks

| Risk | Mitigation |
|------|------------|
| Breaking existing `getRequestById` API contract | Add new summary fields alongside existing fields; do not remove old fields yet |
| AllocationPlan status change breaks owner workflows | Only transition on confirm, not on create/update |
| Performance regression on large requests | Cache `maxDispatchable` lookups; add pagination to queue APIs |

### 12.2 Follow-up Items (Phase 2)

- BranchReceiveSession model + controlled receive (similar to VendorReceiveSession)
- Deprecate legacy `fulfillAndDispatch` path (feature flag)
- Real-time notifications for state changes (WebSocket or polling)
- Backorder auto-dispatch after GRN receive
- CSV bulk request creation
- Request template / repeat last request
- Mobile app support for warehouse/branch flows

---

## 13. Rollback Plan

**Phase 1 (Services Only):** Low risk. New services are additive; can be removed without breaking existing code.

**Rollback Steps:**
1. Revert service files: `git rm src/api/v1/services/stockRequest*.service.ts src/api/v1/services/branchTypeResolver.service.ts`
2. Revert import changes in `stock_requests.service.ts`: `git checkout HEAD -- src/api/v1/modules/stock_requests/stock_requests.service.ts`
3. Re-deploy backend

**Phase 2 (Integration):** Medium risk. Requires coordination with frontend changes.

**Rollback Steps:**
1. Revert all backend changes: `git revert <commit-range>`
2. Revert frontend queue pages: `git revert <commit-range>` (in bpa_web repo)
3. Re-deploy both backend and frontend

---

## 14. Next Steps

### Immediate (Complete Phase 1):

1. **Finish `stock_requests.service.ts` integration** (update `getRequestById` to use new services)
2. **Update `allocationPlan.service.ts` `confirmPlan`** (transition StockRequest status)
3. **Create queue services** (`warehouseFulfillmentQueue.service.ts`, `branchInboundQueue.service.ts`)
4. **Add queue API routes** (controller + routes)
5. **Test backend APIs** (curl or Postman)

### Phase 2 (Frontend + Controlled Receive):

6. **Create warehouse fulfillment queue page** (frontend)
7. **Update branch inbound queue page** (frontend)
8. **Add BranchReceiveSession model** (Prisma migration)
9. **Implement controlled branch receive flow** (backend + frontend)
10. **QA full flow** (browser verification steps)

---

**Status:** Canonical quantity/status services, allocation confirm handoff, warehouse + inbound queues, dispatch receive session, legacy-vs-enterprise guards, and primary owner/stock UIs are aligned for browser QA. Optional performance and legacy-transfer UI consolidation remain non-blocking.

---

*Document created: 2026-04-08*
*Implementation by: Claude (Cursor Composer Agent Mode)*
