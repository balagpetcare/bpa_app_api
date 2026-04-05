# Enterprise Allocation & Picking Upgrade Plan

**Status:** Implemented (v1.3) — dispatch handoff atomicity (2026-04-04)
**Created:** 2026-04-04
**Location:** `/docs/ENTERPRISE_ALLOCATION_AND_PICKING_PLAN.md`

### Implementation status (living)

| Area | Status | Notes |
|------|--------|--------|
| Auto FEFO on plan create (hybrid `skipAutoAllocation`) | **Implemented** | `createFromStockRequest` / `createFromMedicineRequisition`; fulfillment start passes `skipAutoAllocation` |
| Partial allocation, shortage fields, plan/line metadata | **Implemented** | `totalDemandQty`, `totalAllocatedQty`, `shortageQty`, line `demandQty` / `quantityShort` / `lineStatus` |
| Extended `AllocationPlanStatus` + `AllocationPlanEvent` audit | **Implemented** | Enum values + `allocation_plan_events`; service logs key transitions |
| FEFO `allocateVariantFifoUpTo`, `runFefoForPlan` persistence | **Implemented** | Lines created in transaction; old lines deleted on re-run |
| Reservations on confirm; release on cancel/reallocate-from-confirmed | **Implemented** | `confirmPlan` + `reservation.service`; `reallocatePlan` releases when `CONFIRMED` |
| Manual allocation line + validation | **Implemented** | `POST .../lines/manual`; location must match `fromLocationId` |
| Reallocate | **Implemented** | `POST .../reallocate`; blocked if pick list exists |
| Pick list from plan (non-zero allocation lines) | **Implemented** | `pickList.service` filters zero-qty lines |
| Owner allocation board + detail UI | **Implemented** | List: filters, demand/shortage columns; detail: summary, actions, lines table, pick editor, events, cancel |
| Granular RBAC for allocation / pick / fulfillment-start | **Implemented** | `requirePermission` on routes: allocation read vs mutate; pick read vs mutate; fulfillment status + start (see §QA RBAC) |
| Wave batching / multi-warehouse lines | **Deferred** | Single `fromLocationId` remains the enterprise default for this phase |
| Dispatch handoff transactional (no orphan dispatch) | **Implemented (v1.3)** | `createDispatch(..., { tx })` + single `handoffToDispatch` transaction; idempotent if `stockDispatchId` set |
| Fulfillment start idempotent | **Implemented** | `POST .../fulfillment/stock-requests/:id/start` returns **200** + `meta.existingPlan` when a plan already exists (same org); no duplicate-plan error |
| Pick-handoff SR status allow-list | **Implemented** | `createDispatch` with `pickListId` allows receive-stage SR statuses (`RECEIVED_FULL`, `RECEIVED_PARTIAL`, etc.) so branch receiving does not block outbound challan after pick completion |

**Lifecycle (concise):** `StockRequest` → `AllocationPlan` (DRAFT…CONFIRMED) → `PickList` (DRAFT/IN_PROGRESS/COMPLETED) → `StockDispatch` via handoff; `startFromStockRequest` is get-or-create; `handoffToDispatch` returns existing pick list if already linked.

**Root cause addressed:** Plans showed **Lines = 0** because creation was header-only unless FEFO ran separately. **Fix:** default auto FEFO after create unless `skipAutoAllocation: true`.
**Related Docs:**
- [warehouse-phase2-fulfillment-engine-plan.md](./warehouse-phase2-fulfillment-engine-plan.md)
- [enterprise-stock-request-fulfillment-redesign-plan.md](./enterprise-stock-request-fulfillment-redesign-plan.md)

---

## 1. Executive Summary

The Allocation & Picking module is the warehouse execution layer between request approval and physical dispatch. Currently, the system has foundational infrastructure (AllocationPlan, AllocationPlanLine, PickList, PickListLine models and services) but exhibits a critical usability issue:

**Observed Problem:** The owner allocation board shows draft plans with **Lines = 0**.

**Root Cause Analysis:** The allocation plan is created in DRAFT status without running FEFO allocation. The "Run FEFO" action must be explicitly triggered to populate `AllocationPlanLine` records. The UI does create the plan header correctly, but users may not realize they need to manually trigger the FEFO allocation step.

**Solution Overview:** This plan proposes a phased enterprise upgrade that:
1. Fixes the immediate UX gap (auto-run FEFO on plan creation or provide clear guidance)
2. Adds missing enterprise features (shortage handling, partial allocation, reallocation)
3. Enhances the status lifecycle with explicit state transitions
4. Improves the frontend with an enterprise-grade allocation/picking experience
5. Adds proper RBAC permissions and comprehensive audit logging

---

## 2. Current-State Audit

### 2.1 Backend Components

#### 2.1.1 Existing Models (Prisma Schema)

| Model | Location | Purpose |
|-------|----------|---------|
| `AllocationPlan` | schema.prisma:13140 | Header linking request → FEFO allocation |
| `AllocationPlanLine` | schema.prisma:13168 | Lot-level allocation slices |
| `PickList` | schema.prisma:13190 | Header for picking task |
| `PickListLine` | schema.prisma:13215 | Line-level pick quantities |
| `StockDispatch` | schema.prisma:6916 | Dispatch/challan DO |
| `StockDispatchItem` | schema.prisma:6990 | Dispatch line items |

#### 2.1.2 Existing Status Enums

```prisma
enum AllocationPlanStatus {
  DRAFT
  CONFIRMED
  PICKING
  PICKED
  DISPATCHED
  CANCELLED
}

enum PickListStatus {
  DRAFT
  IN_PROGRESS
  COMPLETED
  CANCELLED
}
```

#### 2.1.3 Existing Services

| Service | File | Key Functions |
|---------|------|---------------|
| `allocationPlan.service.ts` | `src/api/v1/modules/allocation_plans/` | `createFromStockRequest`, `createFromMedicineRequisition`, `runFefoForPlan`, `confirmPlan`, `cancelPlan`, `getPlanById`, `listPlans` |
| `pickList.service.ts` | `src/api/v1/modules/pick_lists/` | `createPickListFromPlan`, `assignPicker`, `startPicking`, `updatePickLine`, `completePicking`, `handoffToDispatch` |
| `reservation.service.ts` | `src/api/v1/modules/fulfillment/` | `reserveAllocationPlanLinesInTx`, `releaseAllocationPlanLinesInTx`, `isFulfillmentReservationEnabled` |
| `fefoAllocation.service.ts` | `src/api/v1/modules/inventory/` | `allocateVariantFifo`, `getFefoEligibleLotTotal`, `getMaxDispatchableQtyAtLocation` |
| `fulfillment.service.ts` | `src/api/v1/modules/fulfillment/` | `startStockRequestFulfillment`, `getStockRequestFulfillmentStatus` |

#### 2.1.4 Existing Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/v1/allocation-plans/from-stock-request` | POST | Create plan from stock request |
| `/api/v1/allocation-plans/from-medicine-requisition` | POST | Create plan from medicine requisition |
| `/api/v1/allocation-plans/:id/run-fefo` | POST | Execute FEFO allocation |
| `/api/v1/allocation-plans/:id/confirm` | POST | Confirm plan (creates reservations) |
| `/api/v1/allocation-plans/:id/cancel` | POST | Cancel plan (releases reservations) |
| `/api/v1/allocation-plans/:id` | GET | Get plan details |
| `/api/v1/allocation-plans` | GET | List plans |
| `/api/v1/pick-lists/from-plan/:planId` | POST | Create pick list from confirmed plan |
| `/api/v1/pick-lists/:id/assign-picker` | POST | Assign picker user |
| `/api/v1/pick-lists/:id/start` | POST | Start picking |
| `/api/v1/pick-lists/:id/lines/:lineId` | PATCH | Update picked quantity |
| `/api/v1/pick-lists/:id/complete` | POST | Complete picking |
| `/api/v1/pick-lists/:id/handoff-dispatch` | POST | Create dispatch from pick list |
| `/api/v1/fulfillment/stock-requests/:id/start` | POST | Start fulfillment (creates draft plan) |
| `/api/v1/fulfillment/stock-requests/:id/status` | GET | Get fulfillment status |

### 2.2 Frontend Components

#### 2.2.1 Existing Pages

| Page | File | Purpose |
|------|------|---------|
| Allocation Board | `app/owner/(larkon)/inventory/allocation/page.tsx` | List allocation plans |
| Allocation Detail | `app/owner/(larkon)/inventory/allocation/[id]/page.tsx` | Plan detail + actions |
| Stock Request Detail | `app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` | Includes "Start allocation plan" button |

#### 2.2.2 API Functions (lib/api.ts)

- `allocationPlansList()`
- `allocationPlanGet(id)`
- `allocationPlanFromStockRequest(body)`
- `allocationPlanRunFefo(id)`
- `allocationPlanConfirm(id)`
- `pickListFromPlan(planId)`
- `pickListStart(id)`
- `pickListComplete(id)`
- `pickListHandoff(id, body)`

---

## 3. Root Cause Analysis: Zero-Line Draft Allocations

### 3.1 The Flow

1. User clicks "Start allocation plan (draft)" on stock request detail page
2. Frontend calls `POST /api/v1/fulfillment/stock-requests/:id/start` with `fromLocationId`
3. Backend creates `AllocationPlan` with status=DRAFT, no lines
4. User navigates to allocation board, sees plan with Lines=0
5. **Gap:** User must manually click "Run FEFO" on the plan detail page

### 3.2 Why Lines = 0

The `createFromStockRequest` service function only creates the plan header:

```typescript
return prisma.allocationPlan.create({
  data: {
    orgId: data.orgId,
    stockRequestId: data.stockRequestId,
    fromLocationId: data.fromLocationId,
    warehouseId: data.warehouseId ?? undefined,
    createdByUserId: data.createdByUserId ?? undefined,
    status: "DRAFT",  // <-- No lines created
  },
  // ...
});
```

The `runFefoForPlan` function must be called separately to populate `AllocationPlanLine` records.

### 3.3 Design Intent vs. User Expectation

**Design Intent:** Separate plan creation from FEFO execution allows:
- Manual override before auto-allocation
- Draft review/approval workflow
- Multi-step warehouse planning

**User Expectation:** When clicking "Start allocation plan", users expect to see allocated lines immediately.

### 3.4 Recommended Fix Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A. Auto-run FEFO | Run FEFO immediately after plan creation | Matches user expectation | Removes manual review step |
| B. UI Guidance | Show prominent "Run FEFO" CTA on draft plans with 0 lines | Preserves flexibility | Extra click |
| C. Hybrid | Auto-run by default, add "manual allocation" flag | Best of both | Slightly more complex |

**Recommendation:** Option C (Hybrid) - Auto-run FEFO on plan creation by default. Add optional `skipAutoAllocation: true` parameter for manual workflow.

---

## 4. Gap Analysis

### 4.1 Missing Enterprise Features

| Feature | Current State | Gap |
|---------|--------------|-----|
| Auto-allocation on create | ❌ Manual FEFO trigger | Add auto-FEFO option |
| Partial allocation | ❌ All-or-nothing FEFO | Add shortage tracking |
| Shortage handling | ❌ Throws error if insufficient | Graceful partial + shortage lines |
| Reallocation | ❌ Must cancel and recreate | Add reallocate action |
| Multi-source allocation | ❌ Single fromLocation | Support multi-warehouse |
| Manual lot selection | ❌ FEFO only | Allow manual override |
| Priority/wave batching | ❌ Individual plans | Add wave grouping |
| Backorder management | ❌ No backorder tracking | Add backorder lines |

### 4.2 Missing Status States

Current status lifecycle is minimal:
```
DRAFT → CONFIRMED → PICKING → PICKED → DISPATCHED
                                    ↘ CANCELLED
```

Missing enterprise states:
- `ALLOCATED` (FEFO completed, not yet confirmed/reserved)
- `PARTIALLY_ALLOCATED` (some lines short)
- `PENDING_REVIEW` (for manual approval flows)
- `FAILED` / `EXCEPTION` (for system errors)
- `ON_HOLD` (administrative pause)

### 4.3 Missing Frontend Features

| Feature | Status |
|---------|--------|
| Auto-allocate action with feedback | ❌ |
| Shortage banner with line breakdown | ❌ |
| Manual lot selection UI | ❌ |
| Reallocate/release individual lines | ❌ |
| Batch select + bulk actions | ❌ |
| Pick confirmation with barcode scan | ❌ |
| Mobile-friendly picking UI | ❌ |
| Real-time status updates | ❌ |
| Audit timeline on detail page | ❌ |

### 4.4 Missing RBAC Permissions

No specific allocation/picking permissions exist in `seedRolesPermissions.ts`:

```typescript
// Currently missing - need to add:
// ALLOCATION_PLAN_VIEW
// ALLOCATION_PLAN_CREATE
// ALLOCATION_PLAN_RUN_FEFO
// ALLOCATION_PLAN_CONFIRM
// ALLOCATION_PLAN_CANCEL
// ALLOCATION_PLAN_MANUAL_OVERRIDE
// PICK_LIST_VIEW
// PICK_LIST_CREATE
// PICK_LIST_ASSIGN
// PICK_LIST_START
// PICK_LIST_COMPLETE
// PICK_LIST_HANDOFF
```

---

## 5. Target Enterprise Architecture

### 5.1 Domain Model

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              REQUEST SOURCES                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│  StockRequest          MedicineRequisition         (Future: SalesOrder)        │
│  [INTERNAL_TRANSFER]   [CLINIC_REPLENISHMENT]                                   │
│  [PROCUREMENT]                                                                   │
└───────────────┬─────────────────────┬──────────────────────────────────────────┘
                │                     │
                ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ALLOCATION PLAN                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│  AllocationPlan {                                                                │
│    id, orgId, stockRequestId?, medicineRequisitionId?,                          │
│    fromLocationId, warehouseId?,                                                 │
│    status: DRAFT | ALLOCATED | PARTIALLY_ALLOCATED | CONFIRMED | PICKING |      │
│            PICKED | DISPATCHED | CANCELLED | FAILED | ON_HOLD,                   │
│    allocationMethod: AUTO_FEFO | MANUAL | HYBRID,                               │
│    totalDemandQty, allocatedQty, shortageQty,                                   │
│    confirmedAt?, cancelledAt?, cancelReason?,                                   │
│    createdByUserId, confirmedByUserId?,                                         │
│    createdAt, updatedAt                                                          │
│  }                                                                               │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         ALLOCATION PLAN LINE                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│  AllocationPlanLine {                                                            │
│    id, allocationPlanId, variantId, lotId, locationId,                          │
│    demandQty,           // Original quantity requested                           │
│    quantityAllocated,   // Successfully allocated                                │
│    quantityShort,       // Unable to allocate (shortage)                        │
│    lineStatus: PENDING | ALLOCATED | PARTIAL | SHORT | CANCELLED,               │
│    allocationMethod: FEFO | MANUAL | FIFO,                                      │
│    reservationId?,      // Link to FulfillmentReservation                        │
│    createdAt, updatedAt                                                          │
│  }                                                                               │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │ (on CONFIRM)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       FULFILLMENT RESERVATION                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│  FulfillmentReservation {                                                        │
│    id, orgId, allocationPlanLineId,                                              │
│    locationId, variantId, lotId,                                                 │
│    reservedQty, status: ACTIVE | RELEASED | CONSUMED,                            │
│    ledgerEntryId,  // Link to StockLedger RESERVE_FULFILLMENT                    │
│    expiresAt?,     // Optional reservation TTL                                   │
│    createdByUserId, createdAt, releasedAt?                                       │
│  }                                                                               │
│  (Current: implicit via ledger; consider explicit table for tracking)           │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │ (create pick list)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              PICK LIST                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│  PickList {                                                                      │
│    id, orgId, allocationPlanId, fromLocationId,                                 │
│    status: DRAFT | ASSIGNED | IN_PROGRESS | COMPLETED | CANCELLED,              │
│    assignedPickerUserId?, startedAt?, completedAt?,                             │
│    stockDispatchId?,                                                             │
│    waveId?,              // Future: batch picking waves                          │
│    priority: NORMAL | URGENT | CRITICAL,                                        │
│    pickingMethod: DISCRETE | BATCH | ZONE,                                      │
│    createdAt, updatedAt                                                          │
│  }                                                                               │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           PICK LIST LINE                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│  PickListLine {                                                                  │
│    id, pickListId, allocationPlanLineId?,                                       │
│    variantId, lotId, locationId,                                                 │
│    quantityToPick, quantityPicked,                                              │
│    pickSequence,        // Optimized pick order                                  │
│    pickedAt?, verifiedAt?, scannedBarcode?,                                     │
│    shortageReason?,     // If picked < toPick                                    │
│    createdAt, updatedAt                                                          │
│  }                                                                               │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │ (handoff)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           STOCK DISPATCH                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│  StockDispatch { existing model - dispatch/challan }                             │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Enhanced Status Lifecycle

```
                                    ┌──────────────────┐
                                    │      DRAFT       │  Plan created, no allocation run
                                    └────────┬─────────┘
                                             │ run FEFO / manual allocate
                                             ▼
                    ┌────────────────────────┴────────────────────────┐
                    │                                                  │
                    ▼                                                  ▼
           ┌───────────────┐                               ┌───────────────────────┐
           │   ALLOCATED   │   All demand fulfilled        │ PARTIALLY_ALLOCATED   │  Shortage
           └───────┬───────┘                               └───────────┬───────────┘
                   │                                                   │
                   │ confirm                                           │ confirm (allow partial)
                   ▼                                                   ▼
           ┌───────────────┐                               ┌───────────────────────┐
           │   CONFIRMED   │   Reservations created        │      CONFIRMED        │  + shortage backlog
           └───────┬───────┘                               └───────────┬───────────┘
                   │                                                   │
                   │ create pick list                                  │
                   ▼                                                   ▼
           ┌───────────────┐
           │    PICKING    │   Pick list active
           └───────┬───────┘
                   │ complete pick
                   ▼
           ┌───────────────┐
           │    PICKED     │   Ready for dispatch
           └───────┬───────┘
                   │ handoff to dispatch
                   ▼
           ┌───────────────┐
           │  DISPATCHED   │   Dispatch created, plan complete
           └───────────────┘

           Side transitions:
           ┌───────────────┐
           │   CANCELLED   │   From any non-terminal state
           └───────────────┘
           ┌───────────────┐
           │    ON_HOLD    │   Administrative pause
           └───────────────┘
           ┌───────────────┐
           │    FAILED     │   System error / exception
           └───────────────┘
```

---

## 6. Inventory Math Specification

### 6.1 Core Quantity Types

| Quantity | Definition | Source |
|----------|------------|--------|
| **On Hand** | Physical inventory at location | `StockBalance.onHandQty`, `StockLotBalance.onHandQty` |
| **Reserved** | Committed but not yet consumed | `StockBalance.reservedQty`, `StockLotBalance.reservedQty` |
| **QC Hold** | Pending quality inspection | `QcInspection.expectedQty WHERE status=PENDING` |
| **Recall Frozen** | Active recall, not released | `BatchRecall WHERE status=ACTIVE AND allocationReleasedAt IS NULL` |
| **Available** | Can be allocated | `OnHand - Reserved - QC_Hold - Recall_Frozen` |
| **Allocated (Plan)** | In allocation plan (DRAFT) | `AllocationPlanLine.quantityAllocated` |
| **Reserved (Fulfillment)** | In confirmed plan | `StockLedger.RESERVE_FULFILLMENT` entries |
| **Picked Not Dispatched** | Completed pick, awaiting send | `PickListLine.quantityPicked WHERE pickList.status=COMPLETED AND dispatch.status=CREATED` |
| **In Transit** | Sent, not yet received | `StockDispatchItem WHERE dispatch.status=IN_TRANSIT` |

### 6.2 Calculation Formulas

```typescript
// At location + variant level (lot-less aggregate)
function getAvailableQty(locationId, variantId) {
  const balance = StockBalance.findUnique({ locationId, variantId });
  return Math.max(0, balance.onHandQty - balance.reservedQty);
}

// At location + lot level (FEFO)
function getAvailableLotQty(locationId, lotId, orgId) {
  const balance = StockLotBalance.findUnique({ locationId, lotId });
  const qcHold = getPendingQcHoldByLot(orgId, locationId).get(lotId) ?? 0;
  const recallFrozen = getFrozenRecallLotIds(orgId, [lotId]).has(lotId);
  if (recallFrozen) return 0;
  return Math.max(0, balance.onHandQty - balance.reservedQty - qcHold);
}

// Max dispatchable (enterprise)
function getMaxDispatchableQty(orgId, locationId, variantId) {
  const aggregate = getAvailableQty(locationId, variantId);
  const lotTotal = getFefoEligibleLotTotal(orgId, locationId, variantId);
  return Math.max(aggregate, lotTotal);
}
```

### 6.3 Reservation Impact on Balances

| Ledger Type | onHandQty Impact | reservedQty Impact |
|-------------|------------------|-------------------|
| `RESERVE_FULFILLMENT` | -quantityDelta | +quantityDelta |
| `RELEASE_FULFILLMENT_RESERVE` | -quantityDelta (negative) | +quantityDelta (negative) |
| `TRANSFER_OUT` | -quantityDelta | 0 |

**Current Implementation:** The `ledger.service.ts` correctly applies these semantics in `applyBalanceDelta()`.

---

## 7. RBAC and Permissions Plan

### 7.1 New Permission Keys

```typescript
// Allocation Plan Permissions
'ALLOCATION_PLAN_VIEW',           // View allocation plans and details
'ALLOCATION_PLAN_CREATE',         // Create new allocation plans
'ALLOCATION_PLAN_RUN_ALLOCATION', // Execute FEFO/manual allocation
'ALLOCATION_PLAN_CONFIRM',        // Confirm plan (create reservations)
'ALLOCATION_PLAN_CANCEL',         // Cancel allocation plan
'ALLOCATION_PLAN_MANUAL_OVERRIDE', // Manual lot selection, override FEFO
'ALLOCATION_PLAN_REALLOCATE',     // Reallocate lines (advanced)
'ALLOCATION_PLAN_RELEASE',        // Release reservations without cancel

// Pick List Permissions
'PICK_LIST_VIEW',                 // View pick lists
'PICK_LIST_CREATE',               // Create pick list from confirmed plan
'PICK_LIST_ASSIGN',               // Assign picker to pick list
'PICK_LIST_START',                // Start picking (claim pick list)
'PICK_LIST_UPDATE_LINE',          // Update picked quantities
'PICK_LIST_COMPLETE',             // Mark picking complete
'PICK_LIST_HANDOFF',              // Handoff to dispatch
'PICK_LIST_CANCEL',               // Cancel pick list

// Warehouse Operations (staff role)
'WAREHOUSE_PICK',                 // Mobile picking operations
'WAREHOUSE_PACK',                 // Packing operations
'WAREHOUSE_DISPATCH',             // Dispatch send operations
```

### 7.2 Role Mapping

| Role | Permissions |
|------|-------------|
| OWNER | All allocation + pick list permissions |
| BRANCH_MANAGER (Warehouse) | All allocation + pick list permissions |
| WAREHOUSE_STAFF | ALLOCATION_PLAN_VIEW, PICK_LIST_VIEW, PICK_LIST_START, PICK_LIST_UPDATE_LINE, PICK_LIST_COMPLETE, WAREHOUSE_PICK |
| PICKER | PICK_LIST_VIEW, PICK_LIST_START, PICK_LIST_UPDATE_LINE, WAREHOUSE_PICK |
| DISPATCHER | PICK_LIST_VIEW, PICK_LIST_HANDOFF, WAREHOUSE_DISPATCH |

### 7.3 Implementation Notes

- Use existing `branchRoles.ts` patterns
- Add to `seedRolesPermissions.ts` with migration
- Frontend: gate action buttons based on `user.permissions`
- Backend: add permission checks to controller methods

---

## 8. Backend Implementation Phases

### Phase 1: Fix Zero-Line Issue + Auto-Allocation (Priority: CRITICAL)

**Goal:** Plans show allocated lines immediately after creation.

#### 8.1.1 Changes to `allocationPlan.service.ts`

```typescript
// Modify createFromStockRequest to optionally auto-allocate
export async function createFromStockRequest(data: {
  orgId: number;
  stockRequestId: number;
  fromLocationId: number;
  warehouseId?: number | null;
  createdByUserId?: number | null;
  autoAllocate?: boolean;  // New: default true
}): Promise<AllocationPlan> {
  // ... existing validation ...

  const plan = await prisma.allocationPlan.create({...});

  // Auto-run FEFO if not explicitly disabled
  if (data.autoAllocate !== false) {
    try {
      return await runFefoForPlan(plan.id, data.orgId);
    } catch (e) {
      // Mark plan with allocation failure but don't throw
      await prisma.allocationPlan.update({
        where: { id: plan.id },
        data: {
          status: "PARTIALLY_ALLOCATED",
          // Store error in metadata or new field
        }
      });
      return getPlanById(plan.id, data.orgId);
    }
  }

  return plan;
}
```

#### 8.1.2 Changes to `runFefoForPlan`

```typescript
// Modify to handle partial allocation (shortage) gracefully
export async function runFefoForPlan(planId: number, orgId: number): Promise<AllocationPlan> {
  // ... existing plan fetch ...

  const lineCreates: AllocationPlanLineCreate[] = [];
  const shortages: ShortageInfo[] = [];

  for (const [variantId, qty] of demand.entries()) {
    try {
      const slices = await allocateVariantFifo(orgId, fromLocationId, variantId, qty);
      for (const s of slices) {
        lineCreates.push({...});
      }
    } catch (e: any) {
      // Record shortage instead of throwing
      const available = await getMaxDispatchableQtyAtLocation(orgId, fromLocationId, variantId);
      shortages.push({
        variantId,
        demandQty: qty,
        availableQty: available,
        shortageQty: qty - available,
      });

      // Allocate what's available (partial)
      if (available > 0) {
        const slices = await allocateVariantFifo(orgId, fromLocationId, variantId, available);
        for (const s of slices) {
          lineCreates.push({
            ...s,
            demandQty: qty,
            quantityShort: qty - s.quantity,
          });
        }
      }
    }
  }

  // ... transaction to save lines ...

  const newStatus = shortages.length > 0 ? "PARTIALLY_ALLOCATED" : "ALLOCATED";
  // Note: Need to add ALLOCATED and PARTIALLY_ALLOCATED to enum

  return prisma.$transaction(...);
}
```

#### 8.1.3 Schema Changes

```prisma
enum AllocationPlanStatus {
  DRAFT
  ALLOCATED             // NEW: Full allocation complete
  PARTIALLY_ALLOCATED   // NEW: Partial allocation with shortages
  CONFIRMED
  PICKING
  PICKED
  DISPATCHED
  CANCELLED
  ON_HOLD               // NEW: Administrative hold
  FAILED                // NEW: System error
}

model AllocationPlanLine {
  // ... existing fields ...
  demandQty         Int?            // NEW: Original requested quantity
  quantityShort     Int @default(0) // NEW: Shortage quantity
  lineStatus        String?         // NEW: ALLOCATED | PARTIAL | SHORT
  allocationMethod  String?         // NEW: FEFO | MANUAL | FIFO
}

model AllocationPlan {
  // ... existing fields ...
  allocationMethod  String?         // NEW: AUTO_FEFO | MANUAL | HYBRID
  totalDemandQty    Int?            // NEW: Sum of demand
  allocatedQty      Int?            // NEW: Sum of allocated
  shortageQty       Int?            // NEW: Sum of shortage
}
```

**Files to modify:**
- `prisma/schema.prisma` - Add new enum values and fields
- `src/api/v1/modules/allocation_plans/allocationPlan.service.ts` - Auto-allocate + partial handling
- `src/api/v1/modules/fulfillment/fulfillment.service.ts` - Update startStockRequestFulfillment
- `src/api/v1/modules/allocation_plans/allocationPlan.controller.ts` - Add new params

**Migration:** Non-destructive (add columns, add enum values)

---

### Phase 2: Enhanced Status Transitions + Audit (Priority: HIGH)

#### 8.2.1 Status Transition Service

```typescript
// New: src/api/v1/modules/allocation_plans/allocationPlanStatus.service.ts

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['ALLOCATED', 'PARTIALLY_ALLOCATED', 'CANCELLED'],
  ALLOCATED: ['CONFIRMED', 'DRAFT', 'CANCELLED'],
  PARTIALLY_ALLOCATED: ['CONFIRMED', 'DRAFT', 'CANCELLED'],
  CONFIRMED: ['PICKING', 'CANCELLED', 'ON_HOLD'],
  ON_HOLD: ['CONFIRMED', 'CANCELLED'],
  PICKING: ['PICKED', 'CANCELLED', 'ON_HOLD'],
  PICKED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: [], // Terminal
  CANCELLED: [], // Terminal
  FAILED: ['DRAFT'], // Allow retry
};

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function transitionStatus(
  planId: number,
  orgId: number,
  toStatus: string,
  actorUserId: number,
  reason?: string
): Promise<AllocationPlan> {
  const plan = await prisma.allocationPlan.findFirst({...});
  if (!canTransition(plan.status, toStatus)) {
    throw new Error(`Invalid transition: ${plan.status} → ${toStatus}`);
  }

  // Log audit event
  await logWarehouseAudit({
    orgId,
    warehouseId: plan.warehouseId,
    category: "OPERATIONS",
    action: `ALLOC_PLAN_STATUS_${toStatus}`,
    entityType: "AllocationPlan",
    entityId: String(planId),
    metadata: { fromStatus: plan.status, toStatus, reason },
    actorUserId,
  });

  return prisma.allocationPlan.update({...});
}
```

#### 8.2.2 Enhanced Audit Trail

Add timeline tracking for all plan state changes:

```prisma
model AllocationPlanEvent {
  id               Int      @id @default(autoincrement())
  allocationPlanId Int
  action           String   @db.VarChar(50)
  fromStatus       String?  @db.VarChar(30)
  toStatus         String?  @db.VarChar(30)
  performedByUserId Int?
  metadata         Json?
  createdAt        DateTime @default(now())

  allocationPlan AllocationPlan @relation(fields: [allocationPlanId], references: [id], onDelete: Cascade)
  performedBy    User?          @relation(fields: [performedByUserId], references: [id], onDelete: SetNull)

  @@index([allocationPlanId, createdAt])
  @@map("allocation_plan_events")
}
```

**Files to create/modify:**
- `src/api/v1/modules/allocation_plans/allocationPlanStatus.service.ts` (new)
- `prisma/schema.prisma` - Add `AllocationPlanEvent`
- `src/api/v1/modules/allocation_plans/allocationPlan.service.ts` - Use status service

---

### Phase 3: Manual Allocation + Reallocation (Priority: MEDIUM)

#### 8.3.1 Manual Line Allocation

```typescript
// New endpoint: POST /api/v1/allocation-plans/:id/lines/manual
export async function addManualAllocationLine(
  planId: number,
  orgId: number,
  data: {
    variantId: number;
    lotId: number;
    locationId: number;
    quantity: number;
  },
  actorUserId: number
): Promise<AllocationPlanLine> {
  const plan = await prisma.allocationPlan.findFirst({
    where: { id: planId, orgId, status: { in: ['DRAFT', 'ALLOCATED', 'PARTIALLY_ALLOCATED'] } }
  });
  if (!plan) throw new Error("Plan not found or not editable");

  // Validate lot availability
  const available = await getAvailableLotQty(data.locationId, data.lotId, orgId);
  if (data.quantity > available) {
    throw new Error(`Requested ${data.quantity}, only ${available} available`);
  }

  // Check for duplicate lot line
  const existing = await prisma.allocationPlanLine.findFirst({
    where: { allocationPlanId: planId, lotId: data.lotId }
  });
  if (existing) {
    // Update existing line
    return prisma.allocationPlanLine.update({
      where: { id: existing.id },
      data: { quantityAllocated: { increment: data.quantity } }
    });
  }

  return prisma.allocationPlanLine.create({
    data: {
      allocationPlanId: planId,
      variantId: data.variantId,
      lotId: data.lotId,
      locationId: data.locationId,
      quantityAllocated: data.quantity,
      allocationMethod: 'MANUAL',
    }
  });
}
```

#### 8.3.2 Reallocation (Release + Reallocate)

```typescript
// New endpoint: POST /api/v1/allocation-plans/:id/reallocate
export async function reallocatePlan(
  planId: number,
  orgId: number,
  actorUserId: number
): Promise<AllocationPlan> {
  const plan = await prisma.allocationPlan.findFirst({...});

  // Only allow reallocation from certain states
  if (!['ALLOCATED', 'PARTIALLY_ALLOCATED', 'CONFIRMED'].includes(plan.status)) {
    throw new Error(`Cannot reallocate in status ${plan.status}`);
  }

  // If confirmed, release reservations first
  if (plan.status === 'CONFIRMED') {
    await releaseAllocationPlanLinesInTx(tx, {...});
  }

  // Clear existing lines
  await prisma.allocationPlanLine.deleteMany({ where: { allocationPlanId: planId } });

  // Re-run FEFO
  return runFefoForPlan(planId, orgId);
}
```

**Files to create/modify:**
- `src/api/v1/modules/allocation_plans/allocationPlanManual.service.ts` (new)
- `src/api/v1/modules/allocation_plans/allocationPlan.routes.ts` - Add routes
- `src/api/v1/modules/allocation_plans/allocationPlan.controller.ts` - Add handlers

---

### Phase 4: Permissions + Security Hardening (Priority: MEDIUM)

#### 8.4.1 Permission Seeder Update

```typescript
// prisma/seeders/seedRolesPermissions.ts

const ALLOCATION_PERMISSIONS = [
  { code: 'ALLOCATION_PLAN_VIEW', name: 'View allocation plans', module: 'allocation' },
  { code: 'ALLOCATION_PLAN_CREATE', name: 'Create allocation plans', module: 'allocation' },
  { code: 'ALLOCATION_PLAN_RUN_ALLOCATION', name: 'Run FEFO allocation', module: 'allocation' },
  { code: 'ALLOCATION_PLAN_CONFIRM', name: 'Confirm allocation plans', module: 'allocation' },
  { code: 'ALLOCATION_PLAN_CANCEL', name: 'Cancel allocation plans', module: 'allocation' },
  { code: 'ALLOCATION_PLAN_MANUAL_OVERRIDE', name: 'Manual lot override', module: 'allocation' },
  { code: 'PICK_LIST_VIEW', name: 'View pick lists', module: 'picking' },
  { code: 'PICK_LIST_CREATE', name: 'Create pick lists', module: 'picking' },
  { code: 'PICK_LIST_ASSIGN', name: 'Assign pickers', module: 'picking' },
  { code: 'PICK_LIST_START', name: 'Start picking', module: 'picking' },
  { code: 'PICK_LIST_UPDATE_LINE', name: 'Update pick quantities', module: 'picking' },
  { code: 'PICK_LIST_COMPLETE', name: 'Complete picking', module: 'picking' },
  { code: 'PICK_LIST_HANDOFF', name: 'Handoff to dispatch', module: 'picking' },
];
```

#### 8.4.2 Permission Middleware

```typescript
// src/middleware/allocationPermissions.middleware.ts

export function requireAllocationPermission(permission: string) {
  return async (req: any, res: any, next: any) => {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const hasPermission = await checkUserPermission(user.id, permission);
    if (!hasPermission) {
      return res.status(403).json({ success: false, message: 'Permission denied' });
    }
    next();
  };
}
```

**Files to modify:**
- `prisma/seeders/seedRolesPermissions.ts` - Add permissions
- `src/middleware/allocationPermissions.middleware.ts` (new)
- `src/api/v1/modules/allocation_plans/allocationPlan.routes.ts` - Add middleware

---

### Phase 5: Concurrency + Transaction Safety (Priority: HIGH)

#### 8.5.1 Optimistic Locking

Add version field for optimistic concurrency:

```prisma
model AllocationPlan {
  // ... existing fields ...
  version Int @default(0)  // Increment on each update
}
```

```typescript
export async function confirmPlanWithLock(
  planId: number,
  orgId: number,
  expectedVersion: number,
  actorUserId: number
): Promise<AllocationPlan> {
  const plan = await prisma.allocationPlan.findFirst({
    where: { id: planId, orgId, version: expectedVersion }
  });
  if (!plan) throw new Error("Plan modified by another user. Please refresh.");

  return prisma.$transaction(async (tx) => {
    // ... reservation logic ...

    return tx.allocationPlan.update({
      where: { id: planId },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        version: { increment: 1 }
      }
    });
  });
}
```

#### 8.5.2 Idempotency Keys

```typescript
export async function confirmPlanIdempotent(
  planId: number,
  orgId: number,
  idempotencyKey: string,
  actorUserId: number
): Promise<AllocationPlan> {
  // Check for existing operation with same key
  const existing = await prisma.allocationPlanEvent.findFirst({
    where: {
      allocationPlanId: planId,
      action: 'CONFIRM',
      metadata: { path: ['idempotencyKey'], equals: idempotencyKey }
    }
  });
  if (existing) {
    // Return existing result
    return getPlanById(planId, orgId);
  }

  // ... perform confirmation ...
}
```

**Files to modify:**
- `prisma/schema.prisma` - Add version field
- `src/api/v1/modules/allocation_plans/allocationPlan.service.ts` - Add locking
- Controllers - Accept version/idempotencyKey params

---

## 9. Frontend Implementation Phases

### Phase 1: Fix Immediate UX Issues (Priority: CRITICAL)

#### 9.1.1 Allocation Board Enhancements

**File:** `app/owner/(larkon)/inventory/allocation/page.tsx`

Changes:
- Add status filter tabs (DRAFT, ALLOCATED, CONFIRMED, PICKING, etc.)
- Show shortage badge when lines have shortages
- Add "Run FEFO" bulk action for DRAFT plans
- Show warning icon for 0-line plans
- Add auto-refresh on page visibility

```tsx
// Enhanced table row
<tr key={p.id}>
  <td>{p.id}</td>
  <td>
    <StatusBadge status={p.status} />
    {p.shortageQty > 0 && (
      <span className="badge bg-warning ms-1">Shortage</span>
    )}
  </td>
  <td>{p.stockRequestId || "—"}</td>
  <td>
    {p._count?.lines ?? 0}
    {p._count?.lines === 0 && p.status === 'DRAFT' && (
      <Icon name="warning" className="text-warning ms-1" title="No allocation lines" />
    )}
  </td>
  <td>
    {/* Quick actions */}
    {p.status === 'DRAFT' && p._count?.lines === 0 && (
      <button onClick={() => runFefo(p.id)} className="btn btn-xs btn-primary">
        Run FEFO
      </button>
    )}
  </td>
</tr>
```

#### 9.1.2 Allocation Detail Page Enhancements

**File:** `app/owner/(larkon)/inventory/allocation/[id]/page.tsx`

Changes:
- Show shortage summary banner
- Add allocation statistics card
- Improve action button visibility and flow
- Add audit timeline component
- Show lot details with expiry info

```tsx
// Shortage banner
{plan.status === 'PARTIALLY_ALLOCATED' && (
  <div className="alert alert-warning">
    <strong>Partial Allocation:</strong> {plan.shortageQty} units could not be allocated.
    <ul className="mb-0">
      {shortageLines.map(line => (
        <li key={line.id}>
          {line.variant?.sku}: {line.quantityShort} short
        </li>
      ))}
    </ul>
  </div>
)}

// Status flow indicator
<div className="allocation-flow mb-3">
  <Step status="DRAFT" active={status === 'DRAFT'} complete={['ALLOCATED', 'CONFIRMED', ...].includes(status)} />
  <Step status="ALLOCATED" active={['ALLOCATED', 'PARTIALLY_ALLOCATED'].includes(status)} ... />
  <Step status="CONFIRMED" ... />
  <Step status="PICKING" ... />
  <Step status="PICKED" ... />
  <Step status="DISPATCHED" ... />
</div>

// Allocation lines grid with enhanced info
<DataGrid
  columns={[
    { field: 'variant.sku', header: 'SKU' },
    { field: 'lot.lotCode', header: 'Lot' },
    { field: 'lot.expDate', header: 'Expires', format: formatDate },
    { field: 'quantityAllocated', header: 'Allocated' },
    { field: 'quantityShort', header: 'Short', showIf: v => v > 0 },
    { field: 'location.name', header: 'Location' },
  ]}
  data={plan.lines}
/>

// Audit timeline
<AuditTimeline events={plan.events} />
```

---

### Phase 2: Pick List UI (Priority: HIGH)

#### 9.2.1 New Pick List Board Page

**File:** `app/owner/(larkon)/inventory/picking/page.tsx` (new)

Features:
- List all pick lists with status filters
- Show assigned picker info
- Quick assign/reassign picker
- Progress indicator (picked/total)

#### 9.2.2 Pick List Detail Page

**File:** `app/owner/(larkon)/inventory/picking/[id]/page.tsx` (new)

Features:
- Pick lines grid with zones/locations
- Quantity picker per line
- Barcode scan support (future)
- Complete picking action
- Shortage reporting

---

### Phase 3: Staff Warehouse Operations (Priority: MEDIUM)

#### 9.3.1 Staff Picking Page

**File:** `app/staff/(larkon)/branch/[branchId]/warehouse/picking/page.tsx`

Features:
- Mobile-optimized picking interface
- Location-sequenced pick list
- Quantity confirmation
- Shortage reason capture
- Barcode/QR scanning (future)

#### 9.3.2 Staff Allocation View

**File:** `app/staff/(larkon)/branch/[branchId]/warehouse/allocations/page.tsx`

Features:
- View allocated plans pending pick
- Quick start picking
- Shortage notifications

---

### Phase 4: Advanced Features (Priority: LOW)

#### 9.4.1 Manual Allocation UI

- Lot picker with availability display
- Add/remove allocation lines
- Override FEFO with audit trail

#### 9.4.2 Wave/Batch Picking UI

- Group pick lists into waves
- Zone-based pick routing
- Bulk completion

---

## 10. Integration Points

### 10.1 Stock Requests Integration

**Current:** Stock request detail has "Start allocation plan" button that calls `/fulfillment/stock-requests/:id/start`.

**Changes:**
- Auto-show allocation status after starting
- Link to allocation detail page
- Show shortage info inline
- Add "Reallocate" action when partial

### 10.2 Warehouse Transfers Integration

**Current:** Dispatch creates from pick list handoff.

**Changes:**
- Validate dispatch items match pick lines
- Track dispatch back to allocation
- Release reservations on dispatch send (already implemented)

### 10.3 Receipts/GRN Integration

**Current:** Dispatch receive creates GRN.

**Changes:**
- No changes needed - existing flow works

### 10.4 Inventory Locations Integration

**Current:** Allocation uses single `fromLocationId`.

**Future Consideration:**
- Multi-location allocation for large warehouses
- Zone-aware picking optimization

### 10.5 Batches/Lots Integration

**Current:** FEFO allocation properly selects lots by expiry.

**Changes:**
- Expose lot selection in manual allocation UI
- Show lot status (QC hold, recall) in allocation lines

---

## 11. Migration Strategy

### 11.1 Database Migrations

All migrations are **non-destructive** (add columns/tables only):

```
Migration 1: allocation_plan_enhanced_status
  - Add enum values: ALLOCATED, PARTIALLY_ALLOCATED, ON_HOLD, FAILED
  - Add AllocationPlan fields: allocationMethod, totalDemandQty, allocatedQty, shortageQty, version
  - Add AllocationPlanLine fields: demandQty, quantityShort, lineStatus, allocationMethod

Migration 2: allocation_plan_events
  - Add AllocationPlanEvent table

Migration 3: allocation_permissions
  - Add permission records via seeder
```

### 11.2 Backward Compatibility

- Existing DRAFT plans continue to work (Lines=0 until FEFO run)
- New auto-allocate behavior is additive
- Frontend gracefully handles plans without new fields

### 11.3 Rollback Plan

If issues arise:
1. Set `FULFILLMENT_RESERVATION_ENABLED=false` to disable reservations
2. Revert frontend to previous version
3. Leave schema changes in place (they're additive)
4. Existing data remains valid

---

## 12. QA / Test Matrix

### 12.1 Unit Tests

| Test Case | Service | Status |
|-----------|---------|--------|
| Create plan auto-allocates by default | allocationPlan.service | TODO |
| Create plan with skipAutoAllocation skips FEFO | allocationPlan.service | TODO |
| Partial allocation creates shortage lines | allocationPlan.service | TODO |
| Status transitions validate correctly | allocationPlanStatus.service | TODO |
| Manual allocation validates lot availability | allocationPlanManual.service | TODO |
| Reallocate releases and re-runs FEFO | allocationPlan.service | TODO |
| Reservation math is correct | reservation.service | EXISTS |
| FEFO respects expiry/recall/QC | fefoAllocation.service | EXISTS |

### 12.2 Integration Tests

| Scenario | Components | Status |
|----------|------------|--------|
| Full flow: SR → Alloc → Pick → Dispatch | All | TODO |
| Partial allocation with shortage | allocationPlan, stock_requests | TODO |
| Concurrent allocation attempts | allocationPlan with locking | TODO |
| Permission denial for unauthorized user | middleware | TODO |

### 12.3 E2E Tests

| Scenario | User Flow | Status |
|----------|-----------|--------|
| Owner starts allocation from stock request | SR detail → Allocation | TODO |
| Owner runs FEFO on draft plan | Allocation detail | TODO |
| Staff picks and completes pick list | Picking page | TODO |
| Staff handoffs to dispatch | Picking → Dispatch | TODO |

### 12.4 Performance Tests

| Scenario | Metric | Target |
|----------|--------|--------|
| FEFO allocation 100 variants | Response time | < 2s |
| List 500 allocation plans | Response time | < 1s |
| Concurrent confirmations | Throughput | 50 req/s |

---

## 13. File-by-File Implementation Map

### Backend Files

| File | Action | Phase |
|------|--------|-------|
| `prisma/schema.prisma` | MODIFY - Add enum values, fields | 1 |
| `prisma/seeders/seedRolesPermissions.ts` | MODIFY - Add permissions | 4 |
| `src/api/v1/modules/allocation_plans/allocationPlan.service.ts` | MODIFY - Auto-allocate, partial handling | 1 |
| `src/api/v1/modules/allocation_plans/allocationPlan.controller.ts` | MODIFY - Add new endpoints | 1-3 |
| `src/api/v1/modules/allocation_plans/allocationPlan.routes.ts` | MODIFY - Add routes | 1-3 |
| `src/api/v1/modules/allocation_plans/allocationPlanStatus.service.ts` | CREATE - Status transitions | 2 |
| `src/api/v1/modules/allocation_plans/allocationPlanManual.service.ts` | CREATE - Manual allocation | 3 |
| `src/api/v1/modules/fulfillment/fulfillment.service.ts` | MODIFY - Update start flow | 1 |
| `src/api/v1/modules/pick_lists/pickList.service.ts` | MODIFY - Add shortage tracking | 2 |
| `src/middleware/allocationPermissions.middleware.ts` | CREATE - Permission checks | 4 |

### Frontend Files

| File | Action | Phase |
|------|--------|-------|
| `app/owner/(larkon)/inventory/allocation/page.tsx` | MODIFY - Enhanced board | 1 |
| `app/owner/(larkon)/inventory/allocation/[id]/page.tsx` | MODIFY - Enhanced detail | 1 |
| `app/owner/(larkon)/inventory/picking/page.tsx` | CREATE - Pick list board | 2 |
| `app/owner/(larkon)/inventory/picking/[id]/page.tsx` | CREATE - Pick list detail | 2 |
| `app/staff/(larkon)/branch/[branchId]/warehouse/picking/page.tsx` | CREATE - Staff picking | 3 |
| `app/staff/(larkon)/branch/[branchId]/warehouse/allocations/page.tsx` | CREATE - Staff allocation view | 3 |
| `lib/api.ts` | MODIFY - Add new API functions | 1-3 |
| `components/allocation/StatusBadge.tsx` | CREATE - Reusable component | 1 |
| `components/allocation/AllocationFlow.tsx` | CREATE - Status flow indicator | 1 |
| `components/allocation/AuditTimeline.tsx` | CREATE - Event timeline | 2 |

---

## 14. Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Breaking existing allocation flow | HIGH | LOW | Auto-allocate is additive; existing plans work |
| Reservation math errors | HIGH | LOW | Existing ledger service is battle-tested |
| Performance degradation with many lots | MEDIUM | MEDIUM | Index optimization, limit FEFO results |
| Concurrent allocation conflicts | MEDIUM | MEDIUM | Optimistic locking prevents double-allocation |
| UI confusion with new statuses | LOW | MEDIUM | Clear status badges, help text |
| Staff adoption resistance | LOW | LOW | Mobile-optimized picking UX |

---

## 15. Open Questions (Resolved from Codebase)

| Question | Resolution |
|----------|------------|
| Why do draft plans have 0 lines? | FEFO is not auto-run; must be triggered explicitly |
| Does reservation already exist? | Yes, via RESERVE_FULFILLMENT ledger type (controlled by env var) |
| Is multi-lot allocation supported? | Yes, allocateVariantFifo returns multiple slices |
| How are shortages handled? | Currently throws error; needs graceful partial allocation |
| What triggers pick list creation? | Explicit "Generate pick list" action on confirmed plan |
| How does handoff work? | Creates StockDispatch with items from picked lines |

---

## 16. Implementation Checklist

### Phase 1: Critical Fixes (Estimated: 2-3 days)
- [ ] Add ALLOCATED, PARTIALLY_ALLOCATED enum values
- [ ] Add shortage fields to AllocationPlanLine
- [ ] Modify createFromStockRequest for auto-allocate
- [ ] Modify runFefoForPlan for partial allocation
- [ ] Update frontend allocation board with status filters
- [ ] Update frontend allocation detail with shortage banner
- [ ] Test: Verify new plans show lines immediately
- [ ] Test: Verify partial allocation works correctly

### Phase 2: Enhanced Status + Audit (Estimated: 2-3 days)
- [ ] Create allocationPlanStatus.service.ts
- [ ] Add AllocationPlanEvent model
- [ ] Implement status transition validation
- [ ] Add audit logging for all state changes
- [ ] Create pick list board page
- [ ] Create pick list detail page
- [ ] Test: Status transitions work correctly
- [ ] Test: Audit events are logged

### Phase 3: Manual Allocation + Reallocation (Estimated: 2-3 days)
- [ ] Create allocationPlanManual.service.ts
- [ ] Add manual allocation endpoint
- [ ] Add reallocation endpoint
- [ ] Create staff picking UI
- [ ] Create staff allocation view
- [ ] Test: Manual lot selection works
- [ ] Test: Reallocation releases and re-runs

### Phase 4: Permissions + Security (Estimated: 1-2 days)
- [ ] Add permission records to seeder
- [ ] Create permission middleware
- [ ] Apply middleware to routes
- [ ] Gate frontend actions based on permissions
- [ ] Test: Unauthorized users are blocked

### Phase 5: Concurrency + Testing (Estimated: 1-2 days)
- [ ] Add version field for optimistic locking
- [ ] Implement idempotency key handling
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Performance testing
- [ ] Final QA pass

---

## 17. Appendix: API Contract Examples

### Create Plan (with auto-allocation)

**Request:**
```http
POST /api/v1/allocation-plans/from-stock-request
Content-Type: application/json

{
  "stockRequestId": 123,
  "fromLocationId": 456,
  "warehouseId": 789,
  "autoAllocate": true  // default
}
```

**Response (success):**
```json
{
  "success": true,
  "data": {
    "id": 10,
    "status": "ALLOCATED",
    "totalDemandQty": 100,
    "allocatedQty": 100,
    "shortageQty": 0,
    "lines": [
      {
        "id": 101,
        "variantId": 1001,
        "lotId": 2001,
        "quantityAllocated": 50,
        "quantityShort": 0,
        "lot": { "lotCode": "LOT-A", "expDate": "2026-06-01" }
      },
      {
        "id": 102,
        "variantId": 1001,
        "lotId": 2002,
        "quantityAllocated": 50,
        "quantityShort": 0,
        "lot": { "lotCode": "LOT-B", "expDate": "2026-07-01" }
      }
    ]
  }
}
```

**Response (partial):**
```json
{
  "success": true,
  "data": {
    "id": 11,
    "status": "PARTIALLY_ALLOCATED",
    "totalDemandQty": 100,
    "allocatedQty": 70,
    "shortageQty": 30,
    "lines": [
      {
        "id": 111,
        "variantId": 1001,
        "lotId": 2001,
        "quantityAllocated": 70,
        "demandQty": 100,
        "quantityShort": 30,
        "lineStatus": "PARTIAL"
      }
    ]
  }
}
```

### Manual Allocation

**Request:**
```http
POST /api/v1/allocation-plans/10/lines/manual
Content-Type: application/json

{
  "variantId": 1001,
  "lotId": 2003,
  "locationId": 456,
  "quantity": 30
}
```

### Reallocate

**Request:**
```http
POST /api/v1/allocation-plans/10/reallocate
Content-Type: application/json

{}
```

---

## Final QA & hardening (v1.2)

### Backend hardening applied

| Area | Change |
|------|--------|
| **Concurrency** | `confirmPlan` and `cancelPlan` use `SELECT … FOR UPDATE` on `allocation_plans` inside the transaction before reserve/release to reduce double-confirm / double-cancel races. |
| **Reservation release** | `releaseAllocationPlanLinesInTx` now **throws** on line `locationId` ≠ plan `fromLocationId` (was silent `continue`, risk of stale reserves). |
| **Pick list creation** | `createPickListFromPlan` locks the plan row before checking `pickList` / inserting lines (prevents duplicate pick lists under concurrency). |
| **Complete picking** | `completePicking` is **idempotent** if status is already `COMPLETED` (returns current pick list; avoids duplicate audit noise). |
| **Dispatch handoff** | **Superseded by v1.3** — see §Dispatch atomicity hardening below. |
| **Pick list list API** | `GET /pick-lists` returns **403** when org cannot be resolved (was empty 200). |
| **RBAC** | Route guards use `middlewares/requirePermission` (any-of). Removed localhost debug `fetch` from permission denial path. |

### RBAC matrix (API)

| Route group | Read (GET) | Mutate (POST/PATCH) |
|-------------|------------|---------------------|
| `/api/v1/allocation-plans` | `warehouse.view` **or** `warehouse.allocation.manage` **or** `warehouse.manage` | `warehouse.allocation.manage` **or** `warehouse.manage` |
| `/api/v1/pick-lists` | `warehouse.view` **or** `warehouse.pick.execute` **or** `warehouse.manage` | `warehouse.pick.execute` **or** `warehouse.manage` |
| `/api/v1/fulfillment/stock-requests/:id/status` | Same as allocation read | — |
| `/api/v1/fulfillment/stock-requests/:id/start` | — | Same as allocation mutate |

**Note:** `ORG_ADMIN` / warehouse DC roles in `seedRolesPermissions` include these keys. Users without them receive **403** with `code: MISSING_PERMISSION` and `requiredPermissions`.

### Dispatch atomicity hardening (v1.3)

**Root cause addressed:** Previously, `createDispatch` committed independently, then `pickList` / `allocationPlan` updates ran in a second transaction; a failure after dispatch insert could leave an orphan `stock_dispatches` row.

**Atomicity boundary:** `handoffToDispatch` (`pickList.service.ts`) now runs **one** interactive `prisma.$transaction` that:

1. Locks `pick_lists` (`FOR UPDATE`) then `allocation_plans` (`FOR UPDATE`) for the org.
2. **Idempotency:** if `pickList.stockDispatchId` is already set, returns the current pick list + dispatch (no duplicate dispatch).
3. Validates `pickList.status === COMPLETED` and `allocationPlan.status === PICKED` before creating dispatch.
4. Calls `createDispatch(..., { tx })` so `stock_dispatch` + `stock_dispatch_items` + (MR path) `medicine_requisitions.stockDispatchId` are written in the **same** transaction.
5. Updates `pick_lists.stockDispatchId` and `allocation_plans.status = DISPATCHED` in the same transaction.
6. Writes `PICK_HANDOFF_DISPATCH` via `logWarehouseAuditInTx(tx, …)` so audit rolls back with failures.

**`createDispatch` refactor:** `dispatches.service.ts` accepts optional `{ tx?: Prisma.TransactionClient }`; all reads/writes use `tx ?? prisma`. Callers outside handoff (direct dispatch API, etc.) omit `tx` unchanged.

**Residual risk after this pass:**

- **Ledger / send path:** `sendDispatch` remains a separate transaction (TRANSFER_OUT). Not part of handoff create.
- **Ledger idempotency (allocation confirm):** Repeated confirm after status flip still blocked by status guard; reservation ref `ALLOCATION_PLAN` + plan id.

**Files changed (v1.3):** `src/api/v1/modules/dispatches/dispatches.service.ts`, `src/api/v1/modules/pick_lists/pickList.service.ts`

**Manual QA — handoff atomicity**

1. **Normal success:** Complete pick → handoff → single dispatch row, pick linked, plan `DISPATCHED`, audit row present.
2. **Repeat handoff:** POST handoff again with same pick list → **200**, same dispatch id, no second `stock_dispatches` row.
3. **Invalid status:** Handoff with pick list `IN_PROGRESS` or plan not `PICKED` → **400** with clear message; no new dispatch.
4. **Already dispatched:** Plan `DISPATCHED` and pick already linked → repeat returns idempotent payload (or 400 if pick list not completed — see code paths).
5. **Permission:** 403 before any DB write (route guard).

### Residual / known risks (non-atomic)

- **Ledger idempotency:** Repeated **successful** confirm after status flip is blocked by status guard; reservation uses ref `ALLOCATION_PLAN` + plan id.

### Manual testing checklist

Use a non-production org with real lot balances at a warehouse DC location.

1. **Full stock, single batch:** Approve SR → start fulfillment (auto FEFO) → board shows lines &gt; 0, demand = allocated, shortage = 0 → Confirm → reservation ledger reflects reserved qty → Generate pick list → Start → set picked = to-pick → Complete → Handoff with valid branch `toLocationId` → plan `DISPATCHED`, dispatch linked.
2. **Multi-batch FEFO:** Same with multiple lots for one variant; verify multiple allocation lines and pick lines; picked qty ≤ to-pick each line.
3. **Shortage:** Insufficient stock → `PARTIALLY_ALLOCATED` or `FAILED`, `shortageQty` &gt; 0; add **manual** line at source location or accept partial confirm if lines exist.
4. **Manual override:** `POST …/lines/manual` with valid variant/lot at `fromLocationId`; totals and status update.
5. **Reallocate:** After confirm without pick, or from pre-pick state per rules → reservations released (if enabled), lines cleared, FEFO re-run.
6. **Cancel:** Cancel before dispatch → reservations released for `CONFIRMED`/`PICKING`/`PICKED`; pick list removed if present; plan `CANCELLED`.
7. **403 UX:** User with role **without** `warehouse.allocation.manage` / `warehouse.view` / `warehouse.manage` (as applicable) → API 403; owner UI shows permission message (`lib/api.ts` surfaces `requiredPermissions`).
8. **Idempotent complete:** Call complete picking twice; second should return completed pick without error.
9. **Handoff atomicity:** Repeat handoff (idempotent); verify DB has exactly one dispatch for that pick list; no orphan `stock_dispatches` without `pick_lists.stock_dispatch_id` when handoff fails mid-flight (simulate via invalid `toLocationId` after pick validation — entire transaction should roll back).

---

**Document Version:** 1.3
**Last Updated:** 2026-04-04
**Author:** Enterprise Planning System
**Review Status:** Dispatch handoff fully transactional (v1.3); send-dispatch ledger path remains separate transaction by design
