# Complete Stock Request / Delivery / Transfer / Receiving Flow Analysis and Fix Plan

**Document Path:** `docs/COMPLETE_STOCK_REQUEST_DELIVERY_FLOW_ANALYSIS_AND_FIX_PLAN.md`
**Created:** 2026-04-08
**Status:** ANALYSIS + IMPLEMENTATION PLAN
**Branch:** `release/V-A1.0.7` (backend) / `release/V-A1.0.8` (frontend)

---

## 1. Executive Summary

The BPA/WPA stock request → allocation → dispatch → transfer → receive flow is **architecturally sound but incomplete and inconsistent in critical handoffs**. The system has THREE overlapping fulfillment paths:

1. **Legacy Direct Transfer** (`StockTransfer` module - marked deprecated)
2. **Enterprise Allocation Flow** (StockRequest → AllocationPlan → PickList → StockDispatch)
3. **Flexible Fulfill** (StockRequest → direct fulfillStockRequestFlexible → StockTransfer)

The core architectural issue is that **warehouse-type branches and normal branches are not consistently distinguished** throughout the flow, leading to:

- Requests that should appear in warehouse fulfillment queues are hidden by incorrect status/branch-type derivation
- Transfer records exist but no actionable task appears in warehouse UI
- Quantity formulas (remainingQty, dispatchableQty) are computed differently across modules
- Status progression from enterprise allocation (CONFIRMED plan) does not reliably create visible dispatch tasks
- Normal branches cannot reliably see inbound transfers and receive them with controlled sessions

**Critical Findings:**

1. **Branch Type Awareness Gap:** `resolveRequestIntent()` correctly detects warehouse branches but downstream queue/UI logic does not consistently use this signal.

2. **Handoff Gap:** AllocationPlan status `CONFIRMED` does not automatically transition StockRequest to a state that makes it visible in warehouse delivery/dispatch queues.

3. **Status Ambiguity:** StockRequest has 15+ states (`DRAFT`, `SUBMITTED`, `OWNER_REVIEW`, `APPROVED`, `FULFILLED_PARTIAL`, `FULFILLED_FULL`, `PARTIALLY_DISPATCHED`, `DISPATCHED`, `RECEIVED_PARTIAL`, `RECEIVED_FULL`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CLOSED`, `CANCELLED`). Multiple states map to the same semantic phase, creating confusion.

4. **Quantity Formula Inconsistency:**
   - Stock request service computes `remainingQty = requestedQty - fulfilledQty - cancelledQty`
   - Owner UI computes `maxDispatchableByItemId` per line with shared pool logic
   - Transfer receive computes `receivedQty`, `damagedQty`, `expiredQty` independently
   - No single canonical source for "what quantity can be dispatched now"

5. **Missing Queue Visibility:** Warehouse fulfillment queue, delivery hub actionable queue, and receiving branch inbound queue do not have unified derivation logic. Ad hoc filters on pages can hide valid pending work.

6. **Legacy/Enterprise Conflict:** `fulfillAndDispatch` (legacy) and `fulfillStockRequestFlexible` (enterprise) both mutate `StockRequestItem.fulfilledQty` but use different allocation strategies.

**Impact:**

- **CRITICAL:** Stock requests submitted by warehouse branches for procurement may not trigger correct procurement demand flow
- **HIGH:** Transfers created but not visible in warehouse delivery hub queues
- **HIGH:** Normal branches cannot reliably see and receive inbound transfers
- **MEDIUM:** Owner sees "No quantity could be dispatched" despite valid pending lines

**Solution Approach:**

1. Create **centralized request/line summary derivation module** that computes canonical state, quantities, and actionability for all contexts
2. Distinguish **warehouse branch vs normal branch** behavior explicitly at request creation, queue filtering, and UI rendering
3. Unify **quantity formulas** into reusable functions used by owner/warehouse/branch modules
4. Ensure **AllocationPlan confirmation** triggers stock request status transition to queue-visible state
5. Create **unified queue visibility service** that returns actionable work items for owner/warehouse/branch roles
6. Ensure **receiving flow** for normal branches clearly shows inbound transfer and controlled receive action
7. Add **missing notification/task hooks** for request lifecycle events
8. **Deprecate or gate legacy paths** to prevent dual-path mutation conflicts

---

## 2. Current Actual Flow Map

### 2.1 Normal Branch Request Flow (Observed)

```
Normal Branch Staff:
1. Create draft request (DRAFT)
   → POST /api/v1/stock-requests (requestIntent: INTERNAL_TRANSFER auto-detected)
2. Submit request (DRAFT → SUBMITTED)
   → POST /api/v1/stock-requests/:id/submit
3. [NO VISIBILITY IN WAREHOUSE QUEUE YET IF STATUS NOT ACTIONABLE]

Owner / Warehouse Review:
4. Owner sees request (SUBMITTED)
   → GET /api/v1/owner/stock-requests
5. Owner approves (optional) → OWNER_REVIEW
   → POST /api/v1/owner/stock-requests/:id/approve
6. Owner creates allocation plan
   → POST /api/v1/allocation-plans (links stockRequestId)
   → Auto-FEFO or manual lines
7. Owner confirms allocation plan (DRAFT/ALLOCATED → CONFIRMED)
   → POST /api/v1/allocation-plans/:id/confirm
   [⚠ HANDOFF GAP: StockRequest status does NOT auto-transition to warehouse-visible state]

Warehouse Fulfillment:
8. [MISSING: Warehouse staff cannot see confirmed plans in fulfillment queue if StockRequest status not explicitly set]
9. Pick list creation (manual or from plan)
   → POST /api/v1/pick-lists (from allocationPlanId)
10. Dispatch creation from pick list
    → POST /api/v1/stock-dispatches
11. Send dispatch (DRAFT → IN_TRANSIT, creates TRANSFER_OUT ledger)
    → POST /api/v1/stock-dispatches/:id/send

Branch Receive:
12. [MISSING: Normal branch does not reliably see inbound dispatch/transfer in UI]
13. Receive transfer
    → POST /api/v1/transfers/:id/receive (legacy)
    OR POST /api/v1/stock-dispatches/:id/receive (enterprise)
14. StockRequest status updated (DISPATCHED → RECEIVED_PARTIAL/RECEIVED_FULL)
    → via markRequestReceivedIfLinked or markStockRequestStatusFromDispatchReceive

Gaps:
- Step 7→8: No automatic visibility trigger after allocation confirm
- Step 12: Normal branch inbound queue not reliably populated
- Step 13: Controlled receive session (VendorReceiveSession) only for vendor GRNs, not branch-to-branch transfers
```

### 2.2 Warehouse Branch Request Flow (Observed)

```
Warehouse Branch (Procurement Intent):
1. Create draft request (DRAFT)
   → requestIntent resolved to PROCUREMENT if branch type is WAREHOUSE_DC/WAREHOUSE/CENTRAL_WAREHOUSE
2. Submit request (DRAFT → SUBMITTED)
   → POST /api/v1/stock-requests/:id/submit
3. [BEHAVIOR UNCLEAR: Should this trigger procurement demand immediately or wait for owner review?]

Current Gaps:
- Warehouse requests may appear in same queue as normal branch requests
- No distinct UI filter or visual indicator for procurement vs transfer intent
- Procurement demand line creation only happens on AllocationPlan confirm (after shortage detected)
- No direct "create PO from warehouse request" workflow visible
```

### 2.3 Owner Flexible Fulfill Flow (Observed)

```
Owner Direct Dispatch (bypassing allocation plan):
1. Owner views request detail with fulfillment UI
   → GET /api/v1/stock-requests/:id?fromLocationId=X
   → Returns maxDispatchableByVariant, availableLotsByVariant, lineWarnings
2. Owner submits fulfill payload
   → POST /api/v1/owner/stock-requests/:id/fulfill-flexible
   → Validates per-line qty against available, clamps, creates EXTRA lines
3. Creates StockTransfer (DRAFT), sends it (IN_TRANSIT), updates fulfilledQty
4. StockRequest status → FULFILLED_PARTIAL or DISPATCHED

Gaps:
- This path does NOT create AllocationPlan/PickList/StockDispatch
- Mixing this path with enterprise allocation path can cause quantity accounting issues
- No unified "next action" derivation across both paths
```

---

## 3. Expected Canonical Flow Map

### 3.1 Unified Request Lifecycle (Target)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: REQUEST CREATION & SUBMISSION                                       │
└─────────────────────────────────────────────────────────────────────────────┘
Normal Branch:
  DRAFT → (add items) → SUBMITTED
  Intent: INTERNAL_TRANSFER
  Destination: Warehouse/Hub fulfillment queue

Warehouse Branch:
  DRAFT → (add items) → SUBMITTED
  Intent: PROCUREMENT
  Destination: Procurement review queue (owner)

┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: OWNER REVIEW & APPROVAL                                             │
└─────────────────────────────────────────────────────────────────────────────┘
Owner:
  SUBMITTED → OWNER_REVIEW (optional approval step)
  → Approve with partial/extra items (optional)
  → Decline → CANCELLED

┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: ALLOCATION (ENTERPRISE PATH)                                        │
└─────────────────────────────────────────────────────────────────────────────┘
Owner/Warehouse Manager:
  Create AllocationPlan (status: DRAFT)
  → Run FEFO or add manual lines (ALLOCATED/PARTIALLY_ALLOCATED/FAILED)
  → Confirm plan (CONFIRMED)
  → [TRIGGER: StockRequest → APPROVED or READY_FOR_FULFILLMENT]
  → [TRIGGER: Request appears in warehouse fulfillment queue]

Shortage Handling:
  If PARTIALLY_ALLOCATED or FAILED:
    → Create ProcurementDemandLine records (status: PENDING)
    → StockRequestItem.backorderStatus → PENDING_PROCUREMENT
    → Owner creates PO from demand lines
    → PO receive → sync demand lines → READY_TO_FULFILL
    → Re-dispatch from warehouse after receive

┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: PICK & DISPATCH (WAREHOUSE)                                         │
└─────────────────────────────────────────────────────────────────────────────┘
Warehouse Staff:
  See request in fulfillment queue (filter: CONFIRMED plans or READY_FOR_FULFILLMENT)
  → Create PickList from AllocationPlan
  → Complete pick (mark picked)
  → Create StockDispatch from PickList
  → Send dispatch (DRAFT → IN_TRANSIT)
    → Creates TRANSFER_OUT ledger entries
    → StockRequest → DISPATCHED
    → AllocationPlan → DISPATCHED

┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 5: IN TRANSIT & RECEIVE (BRANCH)                                       │
└─────────────────────────────────────────────────────────────────────────────┘
Normal Branch Staff:
  See inbound transfer in receiving queue
  → Filter: transfers where toLocation belongs to branch, status IN_TRANSIT
  → Create receive session (similar to VendorReceiveSession for control)
  → Record received/damaged/short quantities
  → Submit for branch manager confirmation (controlled receive)
  → Manager confirms → TRANSFER_IN ledger entries posted
  → StockRequest → RECEIVED_PARTIAL or RECEIVED_FULL
  → If RECEIVED_FULL → auto-close to CLOSED

┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 6: CLOSURE                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
Auto or Manual:
  RECEIVED_FULL → CLOSED (if all lines accounted)
  RECEIVED_PARTIAL → remains open for follow-up waves or backorder
```

### 3.2 Warehouse Request Special Handling

For warehouse branches:
- `requestIntent` defaults to `PROCUREMENT`
- Owner review may immediately create ProcurementDemandLines if items not in stock
- No transfer/dispatch to self; instead PO workflow
- After GRN receive, demand lines marked READY_TO_FULFILL
- If demand lines have `fulfillmentDispatchId`, they can dispatch to requester branch

---

## 4. Branch-Type Behavior Matrix

| Context | Warehouse Branch as Requester | Warehouse Branch as Source | Normal Branch as Requester | Normal Branch as Receiver |
|---------|------------------------------|----------------------------|---------------------------|---------------------------|
| **Request Intent** | `PROCUREMENT` (auto-detected) | N/A (source, not requester) | `INTERNAL_TRANSFER` | N/A |
| **Queue Visibility** | Procurement review queue (owner) | Fulfillment queue (warehouse staff) | Fulfillment queue (warehouse staff) | Inbound receiving queue (branch staff) |
| **Allocation Plan** | Created if mixed intent; else direct PO | Created for branch demand | Created for branch demand | N/A (receive side) |
| **Dispatch Target** | Internal replenishment or N/A | Normal branches via transfers | Warehouse hub location | Own branch location |
| **Receive Flow** | GRN receive (vendor) or transfer receive (inter-warehouse) | N/A (sender) | N/A (requester waits) | Controlled branch receive session |
| **Status Progression** | SUBMITTED → OWNER_REVIEW → PO_CREATED → RECEIVED → CLOSED | N/A | SUBMITTED → APPROVED → DISPATCHED → RECEIVED → CLOSED | N/A |
| **Backorder Handling** | ProcurementDemandLine → PO → GRN → fulfill | N/A | ProcurementDemandLine → PO → GRN → dispatch | N/A |

**Key Distinction:**
- **Warehouse branches**: Primarily interact with procurement (PO/GRN) and outbound fulfillment
- **Normal branches**: Request stock from warehouse; receive inbound transfers

---

## 5. Entity Map

### 5.1 Core Entities

| Entity | Purpose | Key Fields | Computed/Derived State |
|--------|---------|------------|------------------------|
| `StockRequest` | Request header | orgId, branchId, requesterUserId, status, requestIntent, linkedPurchaseOrderId | totalRequestedQty, totalFulfilledQty, totalCancelledQty, totalRemainingQty, requestorBranchType, canDispatchNow |
| `StockRequestItem` | Request line | stockRequestId, variantId, requestedQty, fulfilledQty, cancelledQty, lineKind, backorderStatus | remainingQty, lineStatus (PENDING/PARTIAL/FULFILLED/CANCELLED/EXTRA) |
| `AllocationPlan` | FEFO allocation | stockRequestId, fromLocationId, status, totalDemandQty, totalAllocatedQty, shortageQty | hasShortage, isPicking, isDispatched |
| `AllocationPlanLine` | Lot allocation | allocationPlanId, variantId, lotId, quantityAllocated, demandQty, quantityShort | N/A |
| `PickList` | Warehouse pick | allocationPlanId, stockDispatchId, status | isPicked, isDispatched |
| `StockDispatch` | Enterprise dispatch | stockRequestId, allocationPlanId, pickListId, status | isInTransit, isReceived |
| `StockTransfer` | Legacy transfer | stockRequestId, fromLocationId, toLocationId, status | (deprecated for new flows) |
| `ProcurementDemandLine` | Backorder/shortage | stockRequestId, stockRequestItemId, variantId, demandQty, fulfilledQty, purchaseOrderId, status | isBackordered, isReadyToFulfill |

### 5.2 Warehouse/Branch Context

| Entity | Purpose | Key Fields |
|--------|---------|------------|
| `Branch` | Branch header | id, orgId, name, typeLinks → branchType.code |
| `BranchType` | Branch category | code (WAREHOUSE_DC, CLINIC, PET_SHOP, DELIVERY_HUB, etc.) |
| `InventoryLocation` | Physical location | id, branchId, warehouseId, type (WAREHOUSE_MAIN, BRANCH_MAIN, etc.) |
| `Warehouse` | Warehouse header | id, orgId, branchId |

### 5.3 Receive Flow

| Entity | Purpose | Key Fields |
|--------|---------|------------|
| `Grn` | Goods received note (vendor) | vendorId, purchaseOrderId, locationId, status |
| `VendorReceiveSession` | Controlled receive (vendor) | grnId, status (DRAFT/AWAITING_CONFIRMATION/POSTED) |
| `StockDiscrepancy` | Transfer receive discrepancy | transferId, variantId, lotId, expectedQty, receivedQty, missingQty |

**Missing:** Branch-to-branch transfer controlled receive session (similar to VendorReceiveSession but for inter-branch transfers).

---

## 6. Route + Page + API Ownership Map

### 6.1 Backend API Routes

| Route | Module | Purpose | Current Status |
|-------|--------|---------|----------------|
| `POST /api/v1/stock-requests` | stock_requests | Create draft | ✅ Working |
| `POST /api/v1/stock-requests/:id/submit` | stock_requests | Submit (DRAFT → SUBMITTED) | ✅ Working |
| `GET /api/v1/stock-requests/:id` | stock_requests | Get detail with fulfillment metadata | ✅ Working (owner context) |
| `GET /api/v1/stock-requests` | stock_requests | List with filters | ✅ Working but no queue derivation |
| `POST /api/v1/owner/stock-requests/:id/fulfill-flexible` | stock_requests | Owner flexible fulfill | ✅ Working (creates StockTransfer) |
| `POST /api/v1/allocation-plans` | allocation_plans | Create from request | ✅ Working |
| `POST /api/v1/allocation-plans/:id/confirm` | allocation_plans | Confirm (reserves stock) | ✅ Working but no request status sync |
| `POST /api/v1/pick-lists` | pick_lists | Create from plan | ✅ Working |
| `POST /api/v1/stock-dispatches` | dispatches | Create dispatch | ✅ Working |
| `POST /api/v1/stock-dispatches/:id/send` | dispatches | Send (TRANSFER_OUT) | ✅ Working |
| `POST /api/v1/stock-dispatches/:id/receive` | dispatches | Branch receive | ✅ Working but no controlled session |
| `POST /api/v1/transfers/:id/receive` | transfers (deprecated) | Legacy receive | ⚠️ Deprecated |
| `GET /api/v1/owner/warehouse/fulfillment-queue` | (missing) | Warehouse actionable queue | ❌ Missing |
| `GET /api/v1/staff/branch/:id/inbound-queue` | (missing) | Branch inbound transfers | ❌ Missing |

### 6.2 Frontend Pages

| Page | Path | Purpose | Current Status |
|------|------|---------|----------------|
| Owner Stock Requests List | `/owner/inventory/stock-requests` | List all org requests | ✅ Exists (needs queue filter) |
| Owner Stock Request Detail | `/owner/inventory/stock-requests/[id]` | Fulfill UI | ✅ Exists |
| Staff Branch Stock Requests | `/staff/branch/[branchId]/inventory/stock-requests` | Branch view own requests | ✅ Exists |
| Staff Branch Stock Request Detail | `/staff/branch/[branchId]/inventory/stock-requests/[id]` | Branch view detail | ✅ Exists |
| Owner Allocation Plans | `/owner/inventory/allocation-plans` | List plans | ✅ Exists |
| Owner Allocation Plan Detail | `/owner/inventory/allocation-plans/[id]` | Plan detail | ✅ Exists |
| Warehouse Fulfillment Queue | (missing) | Warehouse pick/dispatch queue | ❌ Missing dedicated page |
| Staff Branch Inbound Transfers | `/staff/branch/[branchId]/warehouse/inbound-transfers` | Receive queue | ⚠️ Partial (no controlled session) |
| Staff Transfer Receive | `/staff/branch/[branchId]/warehouse/vendor-receipts/[grnId]` | GRN receive UI | ✅ Exists (vendor only) |

### 6.3 Ownership Summary

| Component | Owner | Warehouse Staff | Branch Staff | Notes |
|-----------|-------|-----------------|--------------|-------|
| Create request | ❌ | ❌ | ✅ | Branch manager/staff |
| Review/approve | ✅ | ❌ | ❌ | Owner only |
| Allocation plan | ✅ | ✅ (if delegated) | ❌ | Owner or warehouse manager |
| Pick list | ❌ | ✅ | ❌ | Warehouse staff |
| Dispatch send | ❌ | ✅ | ❌ | Warehouse staff |
| Receive transfer | ❌ | ❌ | ✅ | Branch staff (destination) |
| Resolve discrepancy | ✅ | ✅ (if delegated) | ❌ | Owner or warehouse manager |

---

## 7. Quantity Model Map

### 7.1 Current Quantity Fields (Observed)

| Field | Entity | Meaning | Formula (Current) |
|-------|--------|---------|-------------------|
| `requestedQty` | StockRequestItem | Branch requested | Input |
| `fulfilledQty` | StockRequestItem | Qty dispatched so far | Incremented by fulfill/dispatch |
| `cancelledQty` | StockRequestItem | Qty cancelled | Input (via cancelLine API) |
| `remainingQty` | (computed) | Not yet fulfilled | `requestedQty - fulfilledQty - cancelledQty` |
| `quantityAllocated` | AllocationPlanLine | FEFO allocated | FEFO sum per variant |
| `totalAllocatedQty` | AllocationPlan | Plan total allocated | Sum of all lines |
| `shortageQty` | AllocationPlan | Not allocated | `totalDemandQty - totalAllocatedQty` |
| `demandQty` | ProcurementDemandLine | Backorder demand | Shortage converted to procurement |
| `maxDispatchableByVariant` | (computed) | Available at location | `getMaxDispatchableQtyAtLocation()` (FEFO effective) |
| `maxDispatchableByItemId` | (computed) | Per-line cap | Shared pool logic across duplicate variants |
| `quantitySent` | StockTransferItem | Sent in transfer | Input (legacy) |
| `quantityReceived` | StockTransferItem | Received good | Input (legacy receive) |
| `quantityDamaged` | StockTransferItem | Damaged on receive | Input (legacy receive) |
| `quantityExpired` | StockTransferItem | Expired on receive | Input (legacy receive) |
| `quantityDispatched` | StockDispatchItem | Dispatched (enterprise) | Input |
| `quantityReceived` | StockDispatchItem | Received (enterprise) | Input (controlled receive) |

### 7.2 Canonical Quantity Derivation (Target)

**Create unified service:** `stockRequestQuantity.service.ts`

```typescript
// Request-level summary
interface RequestQuantitySummary {
  totalRequestedQty: number; // sum of REQUESTED lines
  totalFulfilledQty: number; // sum of fulfilledQty on REQUESTED lines
  totalCancelledQty: number; // sum of cancelledQty on REQUESTED lines
  totalRemainingQty: number; // sum of remainingQty on REQUESTED lines
  totalExtraQty: number; // sum of fulfilledQty on EXTRA lines
  totalDispatchable: number; // sum of min(maxDispatchableByItemId, remainingQty)
  hasBackorder: boolean; // any line with backorderStatus != NONE
  hasPendingDispatch: boolean; // totalRemainingQty > 0 && totalDispatchable > 0
}

// Line-level summary
interface LineQuantitySummary {
  requestedQty: number;
  fulfilledQty: number;
  cancelledQty: number;
  remainingQty: number; // requestedQty - fulfilledQty - cancelledQty
  maxDispatchable: number; // from shared pool at fromLocationId
  canDispatchNow: boolean; // remainingQty > 0 && maxDispatchable > 0
  lineStatus: 'PENDING' | 'PARTIAL' | 'FULFILLED' | 'OVER_FULFILLED' | 'CANCELLED' | 'PARTIAL_CANCELLED' | 'EXTRA';
  backorderStatus: StockRequestItemBackorderStatus;
}
```

**Usage:** All owner/warehouse/branch detail/list APIs call this service to get consistent summaries.

---

## 8. Status/State Machine Map

### 8.1 Current StockRequest Status Enum (Prisma)

```prisma
enum StockRequestStatus {
  DRAFT
  SUBMITTED
  OWNER_REVIEW
  APPROVED
  REJECTED
  FULFILLED_PARTIAL
  FULFILLED_FULL
  PARTIALLY_DISPATCHED
  DISPATCHED
  RECEIVED_PARTIAL
  RECEIVED_FULL
  PARTIALLY_RECEIVED
  RECEIVED
  CLOSED
  CANCELLED
}
```

**Problem:** Too many overlapping states; `FULFILLED_PARTIAL` vs `PARTIALLY_DISPATCHED`, `RECEIVED_PARTIAL` vs `PARTIALLY_RECEIVED` vs `RECEIVED_FULL`.

### 8.2 Proposed Unified State Machine (Target)

```
┌─────────┐
│  DRAFT  │ (branch editing)
└────┬────┘
     │ submit
     ▼
┌───────────┐
│ SUBMITTED │ (awaiting owner review)
└─────┬─────┘
      │ owner approve (optional) or create allocation plan
      ▼
┌──────────────┐
│ OWNER_REVIEW │ (owner reviewing, may approve with adjustments)
└──────┬───────┘
       │ allocation plan created + confirmed
       ▼
┌─────────────────┐
│ READY_TO_FULFILL│ (allocation confirmed, visible in warehouse queue) ← NEW STATE
└────────┬────────┘
         │ dispatch send
         ▼
┌───────────┐
│DISPATCHED │ (in transit)
└─────┬─────┘
      │ branch receive
      ▼
┌─────────────────┐
│PARTIALLY_RECEIVED│ (some lines received, others pending/backorder)
└────────┬────────┘
         │ all lines received or cancelled
         ▼
┌──────────┐
│ RECEIVED │ (all lines accounted)
└─────┬────┘
      │ auto or manual close
      ▼
┌────────┐
│ CLOSED │ (terminal, success)
└────────┘

Any state → CANCELLED (branch before submit, owner anytime with reason)
```

**Key Changes:**
1. Add `READY_TO_FULFILL` state to bridge allocation confirm → warehouse actionability
2. Collapse `FULFILLED_PARTIAL`/`FULFILLED_FULL` into dispatch-time logic (not separate states)
3. Collapse `RECEIVED_PARTIAL`/`RECEIVED_FULL`/`PARTIALLY_RECEIVED` into `PARTIALLY_RECEIVED` and `RECEIVED`
4. Remove `APPROVED` and `REJECTED` (use OWNER_REVIEW with approval metadata or CANCELLED with reason)

### 8.3 AllocationPlan Status (No Change Needed)

```
DRAFT → ALLOCATED / PARTIALLY_ALLOCATED / FAILED → CONFIRMED → PICKING → PICKED → DISPATCHED → CANCELLED
```

### 8.4 StockDispatch Status (No Change Needed)

```
DRAFT → IN_TRANSIT → DELIVERED / PARTIALLY_DELIVERED → CANCELLED
```

### 8.5 State Transition Rules

| From | To | Trigger | Condition |
|------|-----|---------|-----------|
| DRAFT | SUBMITTED | Branch submit | Has items |
| SUBMITTED | OWNER_REVIEW | Owner views or approves | Owner action |
| OWNER_REVIEW | READY_TO_FULFILL | AllocationPlan confirmed | Plan.status = CONFIRMED |
| READY_TO_FULFILL | DISPATCHED | StockDispatch sent | Dispatch.status = IN_TRANSIT |
| DISPATCHED | PARTIALLY_RECEIVED | Partial receive | Some lines received < total |
| DISPATCHED | RECEIVED | Full receive | All lines received or accounted |
| PARTIALLY_RECEIVED | RECEIVED | Follow-up receive | All remaining received |
| RECEIVED | CLOSED | Auto or manual | All lines final |
| Any (non-terminal) | CANCELLED | Decline or cancel | Owner or branch action |

---

## 9. Gap Analysis

### 9.1 Critical Gaps (Must Fix)

| Gap # | Description | Impact | Location |
|-------|-------------|--------|----------|
| **GAP-1** | AllocationPlan confirm does not transition StockRequest to queue-visible state | HIGH | `allocationPlan.service.ts:confirmPlan` |
| **GAP-2** | No unified warehouse fulfillment queue API/UI | HIGH | Missing API + frontend |
| **GAP-3** | Normal branch inbound transfer queue unreliable | HIGH | Missing consistent API filter |
| **GAP-4** | No controlled receive session for branch-to-branch transfers | MEDIUM | Missing BranchReceiveSession model |
| **GAP-5** | Warehouse branch requests not visually distinct from normal branch | MEDIUM | UI filter/badge missing |
| **GAP-6** | Quantity formulas inconsistent across modules | HIGH | No centralized derivation |
| **GAP-7** | Legacy fulfillAndDispatch vs enterprise fulfillFlexible conflict | HIGH | Dual mutation paths |

### 9.2 Non-Critical Gaps (Defer or Low Priority)

| Gap # | Description | Priority |
|-------|-------------|----------|
| **GAP-8** | StockTransfer deprecated but still used by fulfillStockRequestFlexible | LOW | Document migration path |
| **GAP-9** | Backorder status sync after GRN receive may be delayed | LOW | Already has queue service |
| **GAP-10** | No real-time notification for request state changes | LOW | Use polling or webhook later |

---

## 10. Root Causes

### 10.1 Primary Root Causes

**RC-1: No Request → Warehouse Queue Bridge**
**Why:** `AllocationPlan.status = CONFIRMED` is a warehouse-internal state. The linked `StockRequest.status` does not automatically transition to a value that warehouse queue filters recognize. The frontend warehouse queue (if it exists) filters on explicit status values, and `OWNER_REVIEW` or `SUBMITTED` do not semantically mean "ready to pick/dispatch".

**RC-2: Branch Type Not Used in Queue Derivation**
**Why:** `resolveRequestIntent()` correctly detects warehouse branch type and sets `requestIntent = PROCUREMENT`, but downstream UI and API filters do not consistently use `requestIntent` or branch type to route requests to correct queues. Normal branch requests and warehouse branch requests appear in the same list with no visual distinction.

**RC-3: Quantity Logic Scattered Across Modules**
**Why:** Each module (stock_requests, allocation_plans, dispatches, grn) computes quantities independently using local logic. No shared service enforces canonical formulas. This leads to "No quantity could be dispatched" errors when different modules disagree on available/dispatchable qty.

**RC-4: Legacy and Enterprise Paths Coexist Without Conflict Prevention**
**Why:** `fulfillAndDispatch` (legacy, creates StockTransfer) and `fulfillStockRequestFlexible` (enterprise, also creates StockTransfer but with different logic) both increment `StockRequestItem.fulfilledQty`. If both are used on the same request, qty accounting can double-count or lose audit trail.

**RC-5: No Branch Receive Session Control**
**Why:** Vendor GRN has `VendorReceiveSession` for draft→submit→confirm flow. Branch-to-branch transfers have no equivalent. Branch staff call `/transfers/:id/receive` directly, posting ledger immediately with no manager review. This is inconsistent with controlled receiving policy.

---

## 11. Fix Strategy

### 11.1 Phase 1: Foundational Services (Week 1)

**Deliverable:** Centralized request/line quantity and status derivation.

1. **Create `stockRequestQuantity.service.ts`**
   - `computeRequestSummary(request, fromLocationId?): RequestQuantitySummary`
   - `computeLineSummary(line, maxDispatchable?): LineQuantitySummary`
   - Used by all detail/list APIs to return consistent summaries

2. **Create `stockRequestStatus.service.ts`**
   - `deriveRequestStatus(request, allocationPlan?, dispatches?): ResolvedStatus`
   - `canTransitionTo(currentStatus, targetStatus, context): boolean`
   - Encapsulates state machine rules

3. **Create `branchTypeResolver.service.ts`**
   - `isWarehouseBranch(branchId): boolean`
   - `getRequestIntent(branchId, explicit?): StockRequestIntent`
   - `getBranchCategory(branchId): 'WAREHOUSE' | 'NORMAL'`

4. **Update `stock_requests.service.ts`**
   - `getRequestById` calls `computeRequestSummary` and `deriveRequestStatus`
   - `listRequests` filters use branch category and intent

5. **Update `allocationPlan.service.ts`**
   - `confirmPlan` transitions StockRequest → `READY_TO_FULFILL` if full allocation or `PARTIALLY_ALLOCATED` with procurement path
   - Emit audit event

### 11.2 Phase 2: Queue Visibility (Week 1-2)

**Deliverable:** Unified queue APIs for owner/warehouse/branch.

1. **Create `warehouseFulfillmentQueue.service.ts`**
   - `getWarehouseFulfillmentQueue(orgId, warehouseId?, branchId?): QueueItem[]`
   - Returns requests in READY_TO_FULFILL or with CONFIRMED plans
   - Includes requestIntent, branchCategory, summary, nextAction

2. **Create `branchInboundQueue.service.ts`**
   - `getBranchInboundQueue(orgId, branchId): InboundItem[]`
   - Returns dispatches/transfers where toLocationId belongs to branch, status IN_TRANSIT
   - Includes sender info, expected quantities, receive session status

3. **Add API Routes**
   - `GET /api/v1/owner/warehouse/fulfillment-queue`
   - `GET /api/v1/staff/branch/:branchId/inbound-queue`

4. **Frontend Queue Pages**
   - `/owner/inventory/warehouse-fulfillment` (new)
   - Update `/staff/branch/[branchId]/warehouse/inbound-transfers` to use new API

### 11.3 Phase 3: Controlled Receive for Branches (Week 2)

**Deliverable:** BranchReceiveSession model and UI flow.

1. **Add Prisma Model**
   ```prisma
   model BranchReceiveSession {
     id                Int      @id @default(autoincrement())
     orgId             Int
     stockDispatchId   Int?     @unique
     stockTransferId   Int?     @unique
     branchId          Int
     status            BranchReceiveSessionStatus @default(DRAFT)
     createdByUserId   Int?
     submittedAt       DateTime?
     submittedByUserId Int?
     confirmedAt       DateTime?
     confirmedByUserId Int?
     createdAt         DateTime @default(now())
     updatedAt         DateTime @updatedAt
     // relations
     org               Organization @relation(...)
     branch            Branch       @relation(...)
     stockDispatch     StockDispatch? @relation(...)
     stockTransfer     StockTransfer? @relation(...)
     createdBy         User?        @relation(...)
     submittedBy       User?        @relation(...)
     confirmedBy       User?        @relation(...)
   }
   enum BranchReceiveSessionStatus {
     DRAFT
     AWAITING_CONFIRMATION
     POSTED
     CANCELLED
   }
   ```

2. **Create `branchReceiveSession.service.ts`**
   - `createSessionForDispatch(dispatchId, branchId, userId): BranchReceiveSession`
   - `submitForConfirmation(sessionId, userId): void`
   - `confirmAndPost(sessionId, userId): void` (posts ledger)

3. **Update `/staff/branch/:id/warehouse/inbound-transfers` UI**
   - Show session status (DRAFT / AWAITING_CONFIRMATION)
   - Staff records quantities in draft
   - Submit button → AWAITING_CONFIRMATION
   - Branch manager confirms → posts ledger

### 11.4 Phase 4: Deprecate Legacy Paths (Week 3)

**Deliverable:** Gate or remove conflicting fulfill paths.

1. **Add Feature Flag**
   ```typescript
   const ENABLE_LEGACY_FULFILL = process.env.ENABLE_LEGACY_FULFILL === 'true';
   ```

2. **Update `stock_requests.controller.ts`**
   - `fulfillAndDispatch` endpoint checks flag, throws deprecation warning
   - Prefer `fulfillStockRequestFlexible` for all new flows

3. **Update Frontend**
   - Owner fulfill UI uses `/fulfill-flexible` endpoint only
   - Remove legacy fulfill form if present

### 11.5 Phase 5: Warehouse Request UX (Week 3)

**Deliverable:** Distinct UI for warehouse procurement requests.

1. **Frontend Filters**
   - Stock request list: add `requestIntent` badge (Procurement vs Transfer)
   - Add filter toggle: "Show Procurement Requests Only"

2. **Procurement Demand UI**
   - `/owner/inventory/procurement-demand` page (may already exist)
   - Shows ProcurementDemandLines with status
   - "Create PO from Demand" action

3. **Backend Hooks**
   - Ensure `confirmPlan` creates ProcurementDemandLines for shortages
   - Ensure GRN receive updates demand line fulfilled qty and backorder status

---

## 12. Regression Checklist

### 12.1 Existing Functionality to Preserve

- [ ] Normal branch can create/submit stock request (requestIntent auto = INTERNAL_TRANSFER)
- [ ] Owner can view all org requests
- [ ] Owner flexible fulfill (existing) still works (until deprecated)
- [ ] AllocationPlan FEFO allocation logic unchanged
- [ ] PickList creation from plan unchanged
- [ ] StockDispatch send creates TRANSFER_OUT ledger
- [ ] Vendor GRN receive creates GRN_IN ledger
- [ ] Transfer receive (legacy) creates TRANSFER_IN ledger (until deprecated)
- [ ] Quantity clamping and warnings in fulfill UI
- [ ] Line cancellation and restoration
- [ ] ProcurementDemandLine creation on shortage
- [ ] PO receive syncs demand lines

### 12.2 New Functionality to Test

- [ ] AllocationPlan confirm transitions StockRequest → READY_TO_FULFILL
- [ ] Warehouse fulfillment queue API returns requests with READY_TO_FULFILL status
- [ ] Branch inbound queue API returns dispatches IN_TRANSIT to branch locations
- [ ] BranchReceiveSession creation for branch transfers
- [ ] Branch receive session draft → submit → confirm flow
- [ ] Branch manager confirmation posts ledger and updates request status
- [ ] Warehouse request with requestIntent = PROCUREMENT appears in procurement queue
- [ ] Procurement demand lines linked to PO after confirm
- [ ] Request summary API returns canonical quantities
- [ ] Line summary includes maxDispatchable and canDispatchNow
- [ ] Branch type resolver correctly identifies warehouse vs normal branches

---

## 13. Rollback Notes

### 13.1 Rollback Strategy

**Phase 1 (Centralized Services):** Low risk. New services only; existing APIs still work.
**Rollback:** Remove new service files, revert controller calls to old inline logic.

**Phase 2 (Queue APIs):** Medium risk. New endpoints only; existing pages unaffected.
**Rollback:** Remove new routes, revert frontend to old list filters.

**Phase 3 (Branch Receive Session):** High risk. New model + migration.
**Rollback:** If migration applied, do NOT rollback migration (enum add-only safe). Revert controller/service to direct ledger post. Mark BranchReceiveSession rows as CANCELLED.

**Phase 4 (Deprecate Legacy):** Medium risk. Feature flag allows toggle.
**Rollback:** Set `ENABLE_LEGACY_FULFILL=true` to re-enable old path.

**Phase 5 (Warehouse UX):** Low risk. UI only.
**Rollback:** Revert frontend components to old filters.

### 13.2 Rollback Commands

```bash
# Revert backend code changes (after commit)
git revert <commit-sha>

# Re-enable legacy fulfill
export ENABLE_LEGACY_FULFILL=true

# Revert frontend changes
cd /d/BPA_Data/bpa_web
git revert <commit-sha>
```

---

## 14. Implementation Order

### 14.1 Task Breakdown (Ordered)

1. **Create centralized quantity service** (`stockRequestQuantity.service.ts`)
2. **Create centralized status service** (`stockRequestStatus.service.ts`)
3. **Create branch type resolver** (`branchTypeResolver.service.ts`)
4. **Update `stock_requests.service.ts` to use new services**
5. **Update `allocationPlan.service.ts:confirmPlan` to transition request status**
6. **Add queue services** (`warehouseFulfillmentQueue.service.ts`, `branchInboundQueue.service.ts`)
7. **Add queue API routes** (controller + routes)
8. **Frontend: Create warehouse fulfillment queue page**
9. **Frontend: Update branch inbound queue page**
10. **Add BranchReceiveSession model** (Prisma migration)
11. **Create `branchReceiveSession.service.ts`**
12. **Update branch receive UI** (controlled session flow)
13. **Add feature flag for legacy fulfill**
14. **Update owner fulfill UI** (prefer flex path, gate legacy)
15. **Add procurement request filters** (frontend)
16. **Add procurement demand UI** (if missing)
17. **QA full flow** (normal branch → warehouse → receive)
18. **QA warehouse procurement flow**
19. **Update documentation**
20. **Deploy to staging → prod**

---

## 15. Browser Verification Steps (Post-Implementation)

### 15.1 Normal Branch → Warehouse → Receive Flow

1. **Branch creates request**
   - URL: `http://localhost:3104/staff/branch/1/inventory/stock-requests/new`
   - Create draft with 2-3 items, submit
   - Expected: Status = SUBMITTED

2. **Owner reviews request**
   - URL: `http://localhost:3104/owner/inventory/stock-requests/[id]`
   - Expected: Shows fulfillment UI with max dispatchable quantities

3. **Owner creates allocation plan**
   - URL: `http://localhost:3104/owner/inventory/allocation-plans/new`
   - Link to stock request, run FEFO
   - Expected: Status = ALLOCATED or PARTIALLY_ALLOCATED

4. **Owner confirms allocation plan**
   - URL: `http://localhost:3104/owner/inventory/allocation-plans/[id]`
   - Click "Confirm Plan"
   - Expected: Plan status = CONFIRMED, Stock request status = READY_TO_FULFILL

5. **Warehouse sees request in queue**
   - URL: `http://localhost:3104/owner/inventory/warehouse-fulfillment` (new)
   - Expected: Request appears with "Ready to Fulfill" badge

6. **Warehouse creates pick list**
   - URL: `http://localhost:3104/owner/inventory/pick-lists/new`
   - Select allocation plan, create pick list
   - Expected: Pick list created

7. **Warehouse creates dispatch**
   - URL: `http://localhost:3104/owner/inventory/dispatches/new`
   - Select pick list, create dispatch
   - Expected: Dispatch created in DRAFT

8. **Warehouse sends dispatch**
   - URL: `http://localhost:3104/owner/inventory/dispatches/[id]`
   - Click "Send Dispatch"
   - Expected: Dispatch status = IN_TRANSIT, Stock request status = DISPATCHED

9. **Branch sees inbound transfer**
   - URL: `http://localhost:3104/staff/branch/1/warehouse/inbound-transfers`
   - Expected: Transfer appears with IN_TRANSIT status

10. **Branch receives transfer**
    - URL: `http://localhost:3104/staff/branch/1/warehouse/inbound-transfers/[id]/receive`
    - Record received quantities, submit for confirmation
    - Expected: Session status = AWAITING_CONFIRMATION

11. **Branch manager confirms**
    - URL: Same as above
    - Click "Confirm Receive"
    - Expected: Session status = POSTED, Stock request status = RECEIVED or PARTIALLY_RECEIVED

### 15.2 Warehouse Procurement Request Flow

1. **Warehouse branch creates request**
   - URL: `http://localhost:3104/staff/branch/2/inventory/stock-requests/new` (branch 2 = warehouse)
   - Create draft, submit
   - Expected: Status = SUBMITTED, requestIntent = PROCUREMENT

2. **Owner sees procurement request**
   - URL: `http://localhost:3104/owner/inventory/stock-requests?intent=PROCUREMENT`
   - Expected: Request appears with "Procurement" badge

3. **Owner creates allocation plan (partial allocation expected)**
   - URL: `http://localhost:3104/owner/inventory/allocation-plans/new`
   - Run FEFO, expect shortage
   - Expected: Status = PARTIALLY_ALLOCATED, shortageQty > 0

4. **Owner confirms plan (creates procurement demand lines)**
   - URL: `http://localhost:3104/owner/inventory/allocation-plans/[id]`
   - Confirm plan
   - Expected: ProcurementDemandLines created with status = PENDING

5. **Owner creates PO from demand**
   - URL: `http://localhost:3104/owner/inventory/procurement-demand` (or PO page)
   - Link demand lines to PO
   - Expected: Demand lines status = PO_LINKED

6. **Owner receives GRN for PO**
   - URL: `http://localhost:3104/owner/inventory/grn/[id]/receive`
   - Receive GRN
   - Expected: Demand lines fulfilledQty updated, status = READY_TO_FULFILL

7. **Warehouse dispatches to requester branch**
   - URL: `http://localhost:3104/owner/inventory/warehouse-fulfillment`
   - Create dispatch from demand line
   - Expected: Dispatch created, demand line status = DISPATCHED

8. **Requester branch receives**
   - Same as normal branch receive flow above

---

## 16. Risks / Follow-up Items

### 16.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| BranchReceiveSession migration breaks existing receive flow | LOW | HIGH | Test receive on staging before deploy; feature flag to bypass session |
| AllocationPlan status change breaks existing owner workflows | MEDIUM | MEDIUM | Ensure transition only happens on confirm, not on create |
| Quantity service performance regression on large requests | LOW | MEDIUM | Add caching for maxDispatchable lookups |
| Legacy fulfill path still used by old clients | MEDIUM | LOW | Add deprecation warning + log tracking |

### 16.2 Follow-up Items (Phase 2)

- [ ] Real-time notifications for request state changes (WebSocket or polling)
- [ ] Backorder auto-dispatch after GRN receive (may already exist in autoFulfillmentQueue.service.ts)
- [ ] CSV bulk request creation for branch staff
- [ ] Request template / repeat last request feature
- [ ] Dispatch evidence upload (photo, signature)
- [ ] Warehouse location bin/shelf tracking for pick lists
- [ ] Mobile app support for warehouse pick/receive flows
- [ ] Analytics dashboard for request cycle time

---

## 17. Final Summary

### 17.1 What Was Missing Before

1. **No automatic state transition** from AllocationPlan confirm to StockRequest READY_TO_FULFILL
2. **No unified warehouse fulfillment queue** API or UI
3. **No consistent branch inbound queue** with controlled receive
4. **No branch-type-aware routing** for procurement vs transfer requests
5. **No centralized quantity/status derivation** → inconsistent formulas across modules
6. **No controlled receive session** for branch-to-branch transfers
7. **Legacy and enterprise fulfill paths coexist** without conflict prevention

### 17.2 What Was Unified

1. **Quantity formulas** → single `stockRequestQuantity.service.ts`
2. **Status derivation** → single `stockRequestStatus.service.ts`
3. **Branch type resolution** → single `branchTypeResolver.service.ts`
4. **Queue visibility** → dedicated services for warehouse and branch queues

### 17.3 How Queue Visibility Now Works

- **Warehouse Fulfillment Queue:** Filters requests with status `READY_TO_FULFILL` or with `AllocationPlan.status = CONFIRMED`
- **Branch Inbound Queue:** Filters dispatches/transfers where `toLocationId` belongs to branch and status `IN_TRANSIT`
- **Procurement Queue:** Filters requests with `requestIntent = PROCUREMENT`

### 17.4 How Statuses Now Derive

- `deriveRequestStatus()` service computes effective status from request + plan + dispatches
- State machine enforces valid transitions
- AllocationPlan confirm triggers automatic status update

### 17.5 How Quantities Now Derive

- `computeRequestSummary()` returns canonical totals (requested, fulfilled, cancelled, remaining, dispatchable)
- `computeLineSummary()` returns per-line status and caps
- All detail/list APIs use these services

### 17.6 How Notifications/Tasks Now Trigger

- AllocationPlan confirm → audit event + request status change → queue entry
- Dispatch send → audit event + request status DISPATCHED → branch inbound queue entry
- Receive confirm → audit event + request status RECEIVED → remove from inbound queue
- Procurement demand creation → audit event → procurement queue entry

### 17.7 Canonical Flow Summary

```
Normal Branch: DRAFT → SUBMITTED → OWNER_REVIEW → (Allocation) → READY_TO_FULFILL
               → (Dispatch) → DISPATCHED → (Receive) → RECEIVED → CLOSED

Warehouse Branch: DRAFT → SUBMITTED → OWNER_REVIEW → (Allocation + Shortage)
                  → PROCUREMENT → (PO + GRN) → READY_TO_FULFILL → (Dispatch)
                  → DISPATCHED → RECEIVED → CLOSED
```

---

**End of Plan Document**

*Next Steps: Review this plan with stakeholders, prioritize phases, begin Phase 1 implementation.*
