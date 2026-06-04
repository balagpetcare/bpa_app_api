# Multi-Warehouse Fulfillment System — Master Plan

**Created:** 2026-04-11  
**Status:** PLAN (not yet implemented)  
**Location:** `/docs/MULTI_WAREHOUSE_FULFILLMENT_MASTER_PLAN.md`  
**Supersedes:** None (extends `ENTERPRISE_ALLOCATION_AND_PICKING_PLAN.md` §"Wave batching / multi-warehouse lines — Deferred")

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement & Current Limitations](#2-problem-statement--current-limitations)
3. [Architecture Overview](#3-architecture-overview)
4. [Allocation Engine Design](#4-allocation-engine-design)
5. [Database Schema (Prisma)](#5-database-schema-prisma)
6. [API Design](#6-api-design)
7. [State Machine & Guards](#7-state-machine--guards)
8. [Warehouse Flow (Pick → Pack → Dispatch)](#8-warehouse-flow-pick--pack--dispatch)
9. [Failure & Edge Cases](#9-failure--edge-cases)
10. [Migration Plan (Legacy → Multi-Source)](#10-migration-plan-legacy--multi-source)
11. [Security & RBAC](#11-security--rbac)
12. [Observability & Audit](#12-observability--audit)
13. [Implementation Phases](#13-implementation-phases)
14. [Appendix A — Glossary](#appendix-a--glossary)
15. [Appendix B — Decision Log](#appendix-b--decision-log)

---

## 1. Executive Summary

The current enterprise fulfillment path binds **one `AllocationPlan` to one `fromLocationId`**. When the preferred warehouse lacks sufficient stock, the system returns `PARTIALLY_ALLOCATED` or `FAILED` — and the only recourse is manual reallocation or procurement demand. This design does not exploit stock that may exist across other warehouses within the same organization.

This plan introduces a **Multi-Source Allocation Engine** that:

- Sources inventory from **multiple warehouses/locations** in a single allocation cycle.
- Generates **per-source pick lists and dispatches** that warehouse staff execute independently.
- Supports **partial fulfillment** with controlled backorder lifecycle.
- Maintains **backward compatibility** with the single-source flow and legacy `StockTransfer` paths.
- Integrates with the existing FEFO, reservation, pick list, and `StockDispatch` infrastructure.

### Key principles

| Principle | Rule |
|-----------|------|
| No breaking changes | All existing single-source flows remain valid; multi-source is additive. |
| Single mutation authority | Only the allocation engine writes quantities; legacy guard blocks parallel mutations. |
| Warehouse independence | Each source warehouse picks/packs/dispatches independently; no cross-warehouse coordination required. |
| Idempotent operations | Confirm, dispatch handoff, and receive are safe to retry. |
| Ledger truth | `StockLedger` + `StockLotBalance` remain the canonical stock truth; reservations and movements flow through the ledger. |

---

## 2. Problem Statement & Current Limitations

### 2.1 Current architecture (single-source)

```
StockRequest → AllocationPlan (one fromLocationId) → PickList → StockDispatch → Receive
```

- `AllocationPlan.fromLocationId` is **scalar** — one source location per plan.
- `runFefoForPlan` runs FEFO against a single location.
- If stock is insufficient at that location, lines get `lineStatus: "SHORT"` / `quantityShort > 0`.
- Plan status becomes `PARTIALLY_ALLOCATED` or `FAILED`.

### 2.2 Observed pain points

| # | Issue | Impact |
|---|-------|--------|
| 1 | **Insufficient stock at preferred warehouse** | Owner must manually create procurement demand or wait for vendor delivery, even when other warehouses have stock. |
| 2 | **No cross-warehouse visibility** | No API to query aggregate availability across all org locations before allocation. |
| 3 | **Single plan = single dispatch** | Cannot split fulfillment across warehouses; branch receives one shipment or nothing. |
| 4 | **Manual reallocation is error-prone** | Owner must cancel plan, pick a different warehouse, re-create — losing audit trail. |
| 5 | **`fulfilledQty` desync on enterprise path** | Enterprise dispatch updates header SR status but does not consistently increment `StockRequestItem.fulfilledQty` (documented code-level concern). |
| 6 | **Enum/type drift** | `stockRequestStatus.service.ts` local dispatch status union vs Prisma; `decline → CANCELLED` vs `REJECTED` — causes QA confusion. |

### 2.3 Design goals

1. **G1** — Fulfill a stock request from N ≥ 1 warehouse locations in a single allocation cycle.
2. **G2** — Generate per-source dispatches that each warehouse executes independently.
3. **G3** — Track partial fulfillment and create backorders for remaining shortage.
4. **G4** — Provide cross-warehouse availability API for informed allocation decisions.
5. **G5** — Support both automatic (FEFO priority) and manual multi-source allocation.
6. **G6** — Preserve backward compatibility: single-source plans remain valid and unchanged.

---

## 3. Architecture Overview

### 3.1 Conceptual model

```
                         ┌──────────────────────────┐
                         │      StockRequest         │
                         │  (branch demand, N items) │
                         └────────────┬─────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │   AllocationPlan (header) │
                         │   status, version, method │
                         │   allocationScope: MULTI  │
                         └────────────┬─────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
    ┌─────────▼──────────┐  ┌────────▼──────────┐  ┌────────▼──────────┐
    │ AllocationPlanLine  │  │ AllocationPlanLine │  │ AllocationPlanLine │
    │ locationId: WH-A    │  │ locationId: WH-A   │  │ locationId: WH-B   │
    │ variantId: 101      │  │ variantId: 102     │  │ variantId: 101     │
    │ lotId: L1           │  │ lotId: L5          │  │ lotId: L9          │
    │ qty: 50             │  │ qty: 30            │  │ qty: 20            │
    └─────────┬──────────┘  └────────┬──────────┘  └────────┬──────────┘
              │                       │                       │
              │  ┌────────────────────┘                       │
              │  │  (grouped by locationId)                   │
              ▼  ▼                                            ▼
    ┌──────────────────┐                            ┌──────────────────┐
    │  PickList (WH-A)  │                            │  PickList (WH-B)  │
    │  lines from WH-A  │                            │  lines from WH-B  │
    └────────┬─────────┘                            └────────┬─────────┘
             │                                               │
             ▼                                               ▼
    ┌──────────────────┐                            ┌──────────────────┐
    │ StockDispatch     │                            │ StockDispatch     │
    │ fromLoc: WH-A     │                            │ fromLoc: WH-B     │
    │ toLoc: branch      │                            │ toLoc: branch      │
    └──────────────────┘                            └──────────────────┘
```

### 3.2 Component responsibilities

| Component | Responsibility |
|-----------|---------------|
| **Allocation Engine** | Multi-source FEFO/priority allocation; shortage detection; backorder creation. |
| **AllocationPlan** (header) | Tracks overall plan status, version, scope (single vs multi), total demand/allocated/short. |
| **AllocationPlanLine** | Per-variant, per-lot, per-location allocation slice. Existing model, extended with `locationId` awareness. |
| **AllocationSourceSummary** | New: per-source-location aggregate within a plan (total allocated, pick status, dispatch status). |
| **PickList** | Unchanged model; one per source location. Created from plan lines filtered by `locationId`. |
| **StockDispatch** | Unchanged model; one per pick list / source location. Linked back to plan. |
| **Backorder** | New: persistent record of unmet demand lines with procurement linkage. |
| **Availability Service** | Cross-warehouse FEFO-aware stock lookup. |

### 3.3 Relationship to existing components

```
                    EXISTING (unchanged)              NEW / EXTENDED
                    ────────────────────              ──────────────
StockRequest        ✓ unchanged                       —
AllocationPlan      ✓ model extended                  + allocationScope, sourceCount
AllocationPlanLine  ✓ model extended                  + sourceLocationId (explicit)
AllocationPlanEvent ✓ unchanged                       —
PickList            ✓ unchanged                       — (1 per source location)
PickListLine        ✓ unchanged                       —
StockDispatch       ✓ unchanged                       — (1 per source location)
StockDispatchItem   ✓ unchanged                       —
Reservation service ✓ unchanged                       — (per-line reservations)
FEFO service        ✓ unchanged                       — (called per location)
                                                      + AllocationSourceSummary (new)
                                                      + Backorder (new)
                                                      + AvailabilityService (new)
                                                      + MultiSourceAllocator (new service)
```

---

## 4. Allocation Engine Design

### 4.1 Source location priority

The engine selects source locations in descending priority order. Each priority tier is exhausted before moving to the next.

```
Priority 1: PREFERRED     — The location explicitly chosen by the owner (if any).
Priority 2: SAME_HUB      — Other locations within the same warehouse/hub.
Priority 3: SAME_REGION    — Locations in warehouses tagged to the same region/zone.
Priority 4: ANY_ORG        — Any warehouse location in the organization.
```

#### 4.1.1 Priority resolution algorithm

```
function resolveSourcePriority(
  orgId: number,
  preferredLocationId?: number,
  requestingBranchId?: number
): SourcePriority[]

  1. Load all warehouse-type InventoryLocations in org where:
     - location.type IN ('WAREHOUSE_MAIN', 'WAREHOUSE_ZONE', 'WAREHOUSE_BIN')
     - branch.branchType IN ('CENTRAL_WAREHOUSE', 'REGIONAL_WAREHOUSE', 'DELIVERY_HUB')
     - location is active (not archived)

  2. If preferredLocationId is set:
     - Tag it as PRIORITY_1_PREFERRED
     - Other locations in the same warehouse → PRIORITY_2_SAME_HUB
     - Other locations in the same region → PRIORITY_3_SAME_REGION
     - Remaining → PRIORITY_4_ANY_ORG

  3. If no preferredLocationId:
     - Find the "default warehouse" for the requesting branch
       (branch.defaultWarehouseId or nearest hub by config)
     - Tag its locations as PRIORITY_1_PREFERRED
     - Continue as above for remaining tiers

  4. Return sorted list of { locationId, warehouseId, priority, branchId }
```

#### 4.1.2 FEFO allocation per source

For each variant in the demand:

```
function allocateVariantMultiSource(
  variantId: number,
  demandQty: number,
  sources: SourcePriority[],
  excludeLotIds: number[]      // recall/QC hold
): AllocationLineCandidate[]

  remaining = demandQty
  lines = []

  for each source in sources (ordered by priority):
    if remaining <= 0: break

    lots = getFefoEligibleLots(variantId, source.locationId, excludeLotIds)
    // lots sorted by expiryDate ASC (FEFO)

    for each lot in lots:
      available = lot.onHandQty - lot.reservedQty
      if available <= 0: continue

      allocQty = min(available, remaining)
      lines.push({
        variantId,
        lotId: lot.id,
        locationId: source.locationId,
        warehouseId: source.warehouseId,
        quantityAllocated: allocQty,
        priority: source.priority,
      })
      remaining -= allocQty

      if remaining <= 0: break

  if remaining > 0:
    lines.push({
      variantId,
      lotId: null,
      locationId: null,
      warehouseId: null,
      quantityAllocated: 0,
      quantityShort: remaining,
      lineStatus: 'SHORT',
    })

  return lines
```

### 4.2 Partial allocation rules

| Scenario | Behavior |
|----------|----------|
| Full stock at preferred | Single-source plan (backward compatible). |
| Partial stock at preferred, rest at other sources | Multi-source plan; lines span multiple locations. |
| No stock at preferred, full at other sources | Multi-source plan; preferred location has zero lines. |
| No stock anywhere | Plan status = `FAILED`; all lines are `SHORT`; backorder created if auto-backorder enabled. |
| Partial stock across all sources | Plan status = `PARTIALLY_ALLOCATED`; short lines recorded; optional backorder for shortage. |

#### 4.2.1 Allocation plan status derivation

```
if totalAllocatedQty == 0 && totalDemandQty > 0:
  status = FAILED
elif totalAllocatedQty < totalDemandQty:
  status = PARTIALLY_ALLOCATED
elif totalAllocatedQty >= totalDemandQty:
  status = ALLOCATED
```

This is unchanged from the current logic; the only difference is that allocated lines may span multiple `locationId` values.

### 4.3 Backorder handling

#### 4.3.1 Backorder creation

When an allocation plan is **confirmed** with `shortageQty > 0`:

```
for each variant with quantityShort > 0:
  create Backorder record:
    orgId
    stockRequestId
    stockRequestItemId (matched by variantId)
    allocationPlanId
    variantId
    shortageQty = quantityShort
    status = OPEN
    priority = stock request urgency
    createdAt = now()
```

#### 4.3.2 Backorder lifecycle

```
OPEN → PROCUREMENT_LINKED → PARTIALLY_FULFILLED → FULFILLED → CLOSED
  │                                                               ▲
  └──── CANCELLED ────────────────────────────────────────────────┘
```

| State | Meaning |
|-------|---------|
| `OPEN` | Shortage recorded; no procurement action yet. |
| `PROCUREMENT_LINKED` | Linked to ProcurementDemandLine / PO. |
| `PARTIALLY_FULFILLED` | Some quantity received via GRN but not fully covered. |
| `FULFILLED` | Full quantity available; ready for supplementary allocation. |
| `CLOSED` | Supplementary dispatch sent or manually closed. |
| `CANCELLED` | Stock request cancelled or owner decided not to fulfill. |

#### 4.3.3 Backorder → supplementary allocation

When a backorder reaches `FULFILLED`:

1. System (or owner action) triggers a **supplementary allocation plan** for the remaining quantity.
2. The supplementary plan links to the same `stockRequestId` via a new `parentAllocationPlanId`.
3. Supplementary plans follow the exact same multi-source allocation → pick → dispatch flow.
4. `StockRequest` status is managed by aggregating quantities across all linked dispatches.

#### 4.3.4 Integration with existing ProcurementDemandLine

The `Backorder` model **wraps** the existing procurement demand flow:

- `Backorder.procurementDemandLineId` links to the existing `ProcurementDemandLine` when procurement path applies.
- `StockRequestItem.backorderStatus` continues to reflect the procurement lifecycle.
- The backorder adds the supplementary allocation trigger that the current system lacks.

### 4.4 Allocation methods

| Method | Code | Description |
|--------|------|-------------|
| Auto FEFO multi-source | `AUTO_FEFO_MULTI` | Engine runs FEFO across all sources by priority. Default for new plans. |
| Auto FEFO single-source | `AUTO_FEFO` | Existing behavior; FEFO at one `fromLocationId`. Preserved for backward compatibility. |
| Manual | `MANUAL` | Owner manually adds allocation lines per source. |
| Hybrid | `HYBRID` | Auto FEFO multi-source fills what it can; owner manually adjusts or adds lines. |

### 4.5 Over-allocation prevention

```
Guard: on each allocation line write (create or update):
  assert line.quantityAllocated <= (lot.onHandQty - lot.reservedQty + existingLineQty)

Guard: on plan confirm:
  for each variant:
    totalAllocated = sum(lines.where(variantId == v).quantityAllocated)
    assert totalAllocated <= demandQty(v)

Guard: concurrent plans on same lot:
  Reservation on confirm uses SELECT ... FOR UPDATE on StockLotBalance rows.
  Two plans confirming simultaneously will serialize at the DB row lock level.
```

---

## 5. Database Schema (Prisma)

### 5.1 Existing model changes (non-destructive, additive only)

#### 5.1.1 AllocationPlan — extended fields

```prisma
model AllocationPlan {
  // ... existing fields unchanged ...

  // NEW FIELDS (nullable for backward compat with existing single-source plans)
  allocationScope    AllocationScope   @default(SINGLE_SOURCE)
  sourceCount        Int               @default(1)
  parentPlanId       Int?              @unique
  parentPlan         AllocationPlan?   @relation("SupplementaryPlan", fields: [parentPlanId], references: [id])
  supplementaryPlan  AllocationPlan?   @relation("SupplementaryPlan")

  // NEW RELATIONS
  sourceSummaries    AllocationSourceSummary[]
  backorders         Backorder[]
}

enum AllocationScope {
  SINGLE_SOURCE
  MULTI_SOURCE
}
```

#### 5.1.2 AllocationPlanLine — add explicit sourceLocationId

```prisma
model AllocationPlanLine {
  // ... existing fields unchanged ...

  // EXISTING `locationId` is already present in the model.
  // No schema change needed — locationId already stores the source location.
  // Lines in a multi-source plan will have varying locationId values.

  // NEW: explicit warehouseId for query convenience
  sourceWarehouseId  Int?
  sourceWarehouse    Warehouse?  @relation(fields: [sourceWarehouseId], references: [id])
}
```

#### 5.1.3 AllocationPlanStatus — add new values

```prisma
enum AllocationPlanStatus {
  DRAFT
  ALLOCATED              // existing
  PARTIALLY_ALLOCATED    // existing
  FAILED                 // existing
  CONFIRMED              // existing
  PICKING                // existing
  PICKED                 // existing
  DISPATCHED             // existing
  CANCELLED              // existing
  ON_HOLD                // existing
  PARTIALLY_CONFIRMED    // NEW: some sources confirmed, others pending
  PARTIALLY_DISPATCHED   // NEW: some sources dispatched, others still picking
}
```

### 5.2 New models

#### 5.2.1 AllocationSourceSummary

Aggregated view per source location within a multi-source plan. Denormalized for efficient warehouse queue queries.

```prisma
model AllocationSourceSummary {
  id                  Int                          @id @default(autoincrement())
  orgId               Int
  allocationPlanId    Int
  allocationPlan      AllocationPlan               @relation(fields: [allocationPlanId], references: [id])
  locationId          Int
  location            InventoryLocation            @relation(fields: [locationId], references: [id])
  warehouseId         Int?
  warehouse           Warehouse?                   @relation(fields: [warehouseId], references: [id])

  // Quantities (sum of lines for this source)
  totalAllocatedQty   Int                          @default(0)
  totalLineCount      Int                          @default(0)

  // Per-source lifecycle
  sourceStatus        AllocationSourceStatus       @default(PENDING)
  confirmedAt         DateTime?
  pickListId          Int?                         @unique
  pickList            PickList?                    @relation(fields: [pickListId], references: [id])
  pickCompletedAt     DateTime?
  dispatchId          Int?                         @unique
  dispatch            StockDispatch?               @relation(fields: [dispatchId], references: [id])
  dispatchedAt        DateTime?

  createdAt           DateTime                     @default(now())
  updatedAt           DateTime                     @updatedAt

  @@unique([allocationPlanId, locationId])
  @@index([orgId, sourceStatus])
  @@index([warehouseId, sourceStatus])
}

enum AllocationSourceStatus {
  PENDING           // Lines allocated, not yet confirmed (reservation not yet held)
  CONFIRMED         // Reservation held; ready for picking
  PICKING           // Pick list created and in progress
  PICKED            // Pick complete; ready for dispatch handoff
  DISPATCHED        // StockDispatch created and sent
  CANCELLED         // Source cancelled (stock unavailable at confirm time)
  SKIPPED           // Source had zero effective lines after reallocation
}
```

#### 5.2.2 Backorder

```prisma
model Backorder {
  id                      Int                  @id @default(autoincrement())
  orgId                   Int
  stockRequestId          Int
  stockRequest            StockRequest         @relation(fields: [stockRequestId], references: [id])
  stockRequestItemId      Int?
  stockRequestItem        StockRequestItem?    @relation(fields: [stockRequestItemId], references: [id])
  allocationPlanId        Int
  allocationPlan          AllocationPlan       @relation(fields: [allocationPlanId], references: [id])
  variantId               Int
  variant                 ProductVariant       @relation(fields: [variantId], references: [id])

  shortageQty             Int
  fulfilledQty            Int                  @default(0)
  remainingQty            Int                  @default(0)   // computed: shortageQty - fulfilledQty

  status                  BackorderStatus      @default(OPEN)
  priority                Int                  @default(0)    // inherits from SR urgency

  // Procurement linkage (optional — only if procurement path chosen)
  procurementDemandLineId Int?
  procurementDemandLine   ProcurementDemandLine? @relation(fields: [procurementDemandLineId], references: [id])

  // Supplementary fulfillment linkage
  supplementaryPlanId     Int?
  supplementaryPlan       AllocationPlan?      @relation("BackorderSupplementary", fields: [supplementaryPlanId], references: [id])

  notes                   String?
  createdAt               DateTime             @default(now())
  updatedAt               DateTime             @updatedAt
  closedAt                DateTime?
  cancelledAt             DateTime?

  @@index([orgId, status])
  @@index([stockRequestId])
  @@index([variantId, status])
}

enum BackorderStatus {
  OPEN
  PROCUREMENT_LINKED
  PARTIALLY_FULFILLED
  FULFILLED
  CLOSED
  CANCELLED
}
```

### 5.3 Model relationship diagram

```
StockRequest (1)
  │
  ├──► AllocationPlan (1..N via parentPlanId chain)
  │      │
  │      ├──► AllocationPlanLine (N, across multiple locationIds)
  │      │
  │      ├──► AllocationSourceSummary (N, one per source location)
  │      │      │
  │      │      ├──► PickList (0..1 per source)
  │      │      │      └──► PickListLine (N)
  │      │      │
  │      │      └──► StockDispatch (0..1 per source)
  │      │             └──► StockDispatchItem (N)
  │      │
  │      ├──► AllocationPlanEvent (N, audit trail)
  │      │
  │      └──► Backorder (N, one per short variant)
  │
  ├──► StockRequestItem (N)
  │      └──► Backorder (0..1)
  │
  └──► StockDispatch (N, linked by stockRequestId)
```

### 5.4 Index strategy

```prisma
// High-frequency queries
@@index([orgId, status])                          // AllocationPlan: warehouse queue
@@index([allocationPlanId, locationId])            // AllocationPlanLine: per-source grouping
@@index([allocationPlanId, variantId])             // AllocationPlanLine: per-variant lookup
@@index([orgId, sourceStatus])                     // AllocationSourceSummary: warehouse dashboard
@@index([warehouseId, sourceStatus])               // AllocationSourceSummary: per-warehouse queue
@@index([orgId, status])                           // Backorder: backorder dashboard
@@index([variantId, status])                       // Backorder: variant-level backorder check
@@index([stockRequestId])                          // Backorder: SR detail view
```

---

## 6. API Design

### 6.1 Availability lookup API

**Purpose:** Before creating an allocation plan, the owner can query cross-warehouse availability.

```
GET /api/v1/availability/multi-source

Query params:
  orgId: number (from auth)
  variantIds: number[]           // comma-separated
  branchId?: number              // requesting branch (for priority resolution)
  preferredLocationId?: number   // optional preferred source

Response 200:
{
  "variants": [
    {
      "variantId": 101,
      "totalAvailable": 150,
      "sources": [
        {
          "locationId": 1,
          "warehouseId": 10,
          "warehouseName": "Central DC",
          "priority": "PREFERRED",
          "available": 80,
          "lots": [
            { "lotId": 5, "batchNo": "B001", "expiryDate": "2026-09-01", "available": 50 },
            { "lotId": 8, "batchNo": "B003", "expiryDate": "2026-12-15", "available": 30 }
          ]
        },
        {
          "locationId": 3,
          "warehouseId": 12,
          "warehouseName": "North Hub",
          "priority": "SAME_REGION",
          "available": 70,
          "lots": [...]
        }
      ]
    }
  ],
  "meta": {
    "excludedLots": { "recall": [...], "qcHold": [...] }
  }
}
```

**Permission:** `inventory.view` or `warehouse.allocation.manage`

### 6.2 Create allocation plan (multi-source)

**Extends existing endpoint:** `POST /api/v1/allocation-plans/from-stock-request`

```
POST /api/v1/allocation-plans/from-stock-request

Body:
{
  "stockRequestId": 42,
  "fromLocationId": 1,                 // preferred (kept for backward compat)
  "warehouseId": 10,                   // optional
  "allocationScope": "MULTI_SOURCE",   // NEW — default "SINGLE_SOURCE" for compat
  "sourceLocationIds": [1, 3, 7],      // NEW — explicit source list (optional)
  "skipAutoAllocation": false,
  "autoBackorder": true                // NEW — create backorders for shortage
}

Response 201:
{
  "id": 99,
  "status": "ALLOCATED",
  "allocationScope": "MULTI_SOURCE",
  "sourceCount": 2,
  "totalDemandQty": 100,
  "totalAllocatedQty": 100,
  "shortageQty": 0,
  "sourceSummaries": [
    { "locationId": 1, "warehouseName": "Central DC", "allocatedQty": 80, "sourceStatus": "PENDING" },
    { "locationId": 3, "warehouseName": "North Hub", "allocatedQty": 20, "sourceStatus": "PENDING" }
  ],
  "lines": [...],
  "backorders": []
}
```

**Backward compatibility:** If `allocationScope` is omitted or `"SINGLE_SOURCE"`, behavior is identical to current `createFromStockRequest`.

### 6.3 Confirm allocation plan (multi-source)

**Extends existing endpoint:** `POST /api/v1/allocation-plans/:id/confirm`

For multi-source plans, confirmation can be:

#### 6.3.1 Full confirm (all sources at once)

```
POST /api/v1/allocation-plans/:id/confirm

Body:
{
  "confirmAll": true    // default behavior — reserves all lines across all sources
}
```

#### 6.3.2 Per-source confirm (progressive)

```
POST /api/v1/allocation-plans/:id/confirm

Body:
{
  "sourceLocationIds": [1],    // confirm only source location 1
  "autoBackorder": true
}
```

- Reserves stock only at the specified source locations.
- Plan status → `PARTIALLY_CONFIRMED` (if not all sources confirmed yet).
- Plan status → `CONFIRMED` (when all sources confirmed).
- Creates backorder records for shortage lines if `autoBackorder` is true.

### 6.4 Per-source pick list creation

**Extends existing endpoint:** `POST /api/v1/pick-lists/from-plan/:planId`

```
POST /api/v1/pick-lists/from-plan/:planId

Body:
{
  "sourceLocationId": 1    // NEW — filter lines to this source only
}

Response 201:
{
  "id": 55,
  "allocationPlanId": 99,
  "sourceLocationId": 1,
  "status": "DRAFT",
  "lines": [...]
}
```

- For single-source plans (or when `sourceLocationId` omitted), behavior is unchanged.
- For multi-source plans, creates a pick list with only the lines for the specified source.
- Updates `AllocationSourceSummary.pickListId` and `.sourceStatus → PICKING`.

### 6.5 Per-source dispatch handoff

**Extends existing endpoint:** `POST /api/v1/pick-lists/:id/handoff-dispatch`

No change to the endpoint itself — it already creates a `StockDispatch` from a completed pick list. The pick list is already scoped to one source location.

The dispatch handoff:
1. Creates `StockDispatch` with `fromLocationId` = pick list source location.
2. Updates `AllocationSourceSummary.dispatchId` and `.sourceStatus → DISPATCHED`.
3. Updates `AllocationPlan.status` based on aggregate source statuses.

### 6.6 Dispatch by source (direct, skip pick list)

For organizations that don't use pick lists:

```
POST /api/v1/allocation-plans/:id/dispatch-source

Body:
{
  "sourceLocationId": 1,
  "transportMode": "ROAD",
  "vehicleNumber": "DHA-1234",
  "driverName": "Rahim",
  "notes": "Partial shipment from Central DC"
}
```

- Creates `StockDispatch` directly from confirmed allocation lines at the specified source.
- Releases reservations and posts `TRANSFER_OUT` ledger entries.
- Updates source summary and plan status.

### 6.7 Backorder management APIs

```
GET    /api/v1/backorders                       // List backorders (filterable)
GET    /api/v1/backorders/:id                   // Backorder detail
PATCH  /api/v1/backorders/:id                   // Update (link procurement, notes)
POST   /api/v1/backorders/:id/create-plan       // Trigger supplementary allocation
POST   /api/v1/backorders/:id/cancel            // Cancel backorder
```

### 6.8 API summary table

| Endpoint | Method | New/Extended | Permission |
|----------|--------|-------------|------------|
| `/availability/multi-source` | GET | **New** | `inventory.view` |
| `/allocation-plans/from-stock-request` | POST | Extended | `warehouse.allocation.manage` |
| `/allocation-plans/:id/confirm` | POST | Extended | `warehouse.allocation.manage` |
| `/allocation-plans/:id/dispatch-source` | POST | **New** | `warehouse.dispatch.manage` |
| `/pick-lists/from-plan/:planId` | POST | Extended | `warehouse.pick.manage` |
| `/backorders` | GET | **New** | `inventory.view` |
| `/backorders/:id` | GET | **New** | `inventory.view` |
| `/backorders/:id` | PATCH | **New** | `warehouse.allocation.manage` |
| `/backorders/:id/create-plan` | POST | **New** | `warehouse.allocation.manage` |
| `/backorders/:id/cancel` | POST | **New** | `warehouse.allocation.manage` |

---

## 7. State Machine & Guards

### 7.1 AllocationPlan state transitions (extended)

```
                                    ┌─────────────────┐
                                    │      DRAFT       │
                                    └────────┬────────┘
                                             │ runFefo / manualLines
                                             ▼
                          ┌─────────────────────────────────────┐
                          │  ALLOCATED / PARTIALLY_ALLOCATED    │
                          │  / FAILED                           │
                          └────────┬───────────┬───────────────┘
                                   │           │
                        confirmAll │           │ confirmPartial
                                   │           │
                                   ▼           ▼
                          ┌──────────┐  ┌──────────────────┐
                          │CONFIRMED │  │PARTIALLY_CONFIRMED│
                          └────┬─────┘  └────────┬─────────┘
                               │                 │ confirmRemaining
                               │                 │
                               │    ┌────────────┘
                               ▼    ▼
                          ┌──────────┐
                          │CONFIRMED │ (all sources)
                          └────┬─────┘
                               │ createPickList (any source)
                               ▼
                          ┌──────────┐
                          │ PICKING  │
                          └────┬─────┘
                               │ allPicksComplete
                               ▼
                          ┌──────────┐
                          │  PICKED  │
                          └────┬─────┘
                               │ dispatchHandoff (per source)
                               ▼
                    ┌────────────────────────┐
                    │ PARTIALLY_DISPATCHED   │ (some sources dispatched)
                    └────────┬───────────────┘
                             │ allSourcesDispatched
                             ▼
                    ┌────────────────────────┐
                    │     DISPATCHED         │
                    └────────────────────────┘

  From any non-terminal state:
    ──► CANCELLED
    ──► ON_HOLD (reversible to previous state)
```

### 7.2 Plan-level status derivation

The plan header status is **derived** from source summary statuses:

```typescript
function derivePlanStatus(sources: AllocationSourceSummary[]): AllocationPlanStatus {
  const active = sources.filter(s => s.sourceStatus !== 'CANCELLED' && s.sourceStatus !== 'SKIPPED');

  if (active.length === 0) return 'CANCELLED';

  const allDispatched = active.every(s => s.sourceStatus === 'DISPATCHED');
  if (allDispatched) return 'DISPATCHED';

  const anyDispatched = active.some(s => s.sourceStatus === 'DISPATCHED');
  if (anyDispatched) return 'PARTIALLY_DISPATCHED';

  const allPicked = active.every(s => ['PICKED', 'DISPATCHED'].includes(s.sourceStatus));
  if (allPicked) return 'PICKED';

  const anyPicking = active.some(s => ['PICKING', 'PICKED'].includes(s.sourceStatus));
  if (anyPicking) return 'PICKING';

  const allConfirmed = active.every(s =>
    ['CONFIRMED', 'PICKING', 'PICKED', 'DISPATCHED'].includes(s.sourceStatus)
  );
  if (allConfirmed) return 'CONFIRMED';

  const anyConfirmed = active.some(s => s.sourceStatus === 'CONFIRMED');
  if (anyConfirmed) return 'PARTIALLY_CONFIRMED';

  return currentAllocationStatus; // DRAFT / ALLOCATED / PARTIALLY_ALLOCATED / FAILED
}
```

### 7.3 Edit lock rules

| Condition | Locked operations |
|-----------|-------------------|
| Plan has any source in `CONFIRMED+` | Cannot delete/modify lines at that source. |
| Plan has any source in `PICKING+` | Cannot cancel that source's confirmation. |
| Plan has any source `DISPATCHED` | Cannot cancel entire plan. |
| Pick list `IN_PROGRESS` | Cannot reallocate lines for that source. |
| StockDispatch created for source | Cannot modify or cancel pick list for that source. |
| Plan `ON_HOLD` | All mutation endpoints return 409; only resume/cancel allowed. |

### 7.4 Validation layers

#### Layer 1: Request validation (controller)

- Schema validation (Zod/Joi) for all request bodies.
- Auth + permission check.
- Org/branch isolation.

#### Layer 2: Business rule validation (service)

- Stock request status allows allocation (`STOCK_REQUEST_ALLOC_STATUSES`).
- Source locations belong to the org.
- Variant exists and is active.
- No duplicate active plan for the same stock request (unless supplementary via `parentPlanId`).
- Over-allocation guard (allocated ≤ demand per variant).

#### Layer 3: Concurrency guard (database)

- `SELECT ... FOR UPDATE` on `StockLotBalance` rows during confirm.
- Optimistic concurrency via `AllocationPlan.version` — confirm checks version matches, increments on success.
- Unique constraints: `AllocationSourceSummary(allocationPlanId, locationId)`, `AllocationPlan(stockRequestId)` (for primary plans).

#### Layer 4: Post-mutation integrity (service)

- After any state change: re-derive plan status from source summaries.
- After dispatch: update `StockRequest` status via existing `markStockRequestStatusFromDispatchReceive`.
- After confirm with shortage: create backorder records.

---

## 8. Warehouse Flow (Pick → Pack → Dispatch)

### 8.1 Per-warehouse execution

Each source location in a multi-source plan operates **independently**. Warehouse staff at location A do not need to coordinate with warehouse B.

```
┌─────────────────────────────────────────────────────────────┐
│  WAREHOUSE A (source location 1)                            │
│                                                             │
│  1. Plan confirmed → source summary CONFIRMED               │
│  2. Create pick list → source summary PICKING                │
│     - Pick list contains only lines where locationId = A     │
│     - Assign picker (warehouse staff)                        │
│  3. Picker walks warehouse, picks items                      │
│     - Update pick line quantities                            │
│  4. Complete picking → source summary PICKED                 │
│  5. Handoff to dispatch → StockDispatch created              │
│     - Source summary DISPATCHED                              │
│  6. Pack items, generate challan/DO                          │
│  7. Send dispatch → TRANSFER_OUT ledger, IN_TRANSIT          │
│                                                             │
│  (All steps use existing PickList + StockDispatch services)  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  WAREHOUSE B (source location 3)                            │
│                                                             │
│  Same flow, independent timing.                              │
│  May complete before or after Warehouse A.                   │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Multi-dispatch per request

A single `StockRequest` can now have **multiple `StockDispatch` records**, one per source. This is already supported by the schema (`StockDispatch.stockRequestId` is not unique — it's a many-to-one relation).

### 8.3 Branch receiving

The receiving branch handles each dispatch independently:

```
For each incoming StockDispatch:
  1. Branch staff opens receive session (DispatchReceiveSession)
  2. Scans/counts items, records received/damaged/short per line
  3. Submits receive session
  4. System posts TRANSFER_IN ledger entries
  5. System updates StockRequest status based on aggregate:
     - Sum all received qty across all dispatches
     - Compare to total demanded qty
     - PARTIALLY_RECEIVED if some remain
     - RECEIVED if all covered
```

### 8.4 Warehouse fulfillment queue (updated)

The existing `warehouseFulfillmentQueue.service.ts` is extended to:

```typescript
// Existing: lists plans in CONFIRMED/PICKING/PICKED
// Extended: for multi-source plans, show per-source tasks

function getWarehouseQueue(warehouseId: number, orgId: number) {
  // Query AllocationSourceSummary where:
  //   warehouseId = given
  //   sourceStatus IN ('CONFIRMED', 'PICKING', 'PICKED')
  //   allocationPlan.status NOT IN ('CANCELLED', 'ON_HOLD')

  // Return per-source tasks with:
  //   - Stock request info (requester branch, items summary)
  //   - Source-specific quantities
  //   - Next action hint (create pick / continue pick / handoff dispatch)
  //   - Priority (from SR urgency + age)
}
```

This means each warehouse only sees **its portion** of multi-source plans — warehouse staff are unaware of the multi-source nature.

---

## 9. Failure & Edge Cases

### 9.1 No stock anywhere

| Trigger | System behavior |
|---------|-----------------|
| `allocateVariantMultiSource` returns zero allocated for all variants | Plan status = `FAILED`. |
| Owner confirms failed plan | Allowed — creates backorder records for all demand. No reservations made. Plan status stays `FAILED` or transitions to `CONFIRMED` with zero source summaries. |
| Auto-backorder enabled | Backorder records created automatically at confirm time. |
| Auto-backorder disabled | Owner must manually create procurement demand or wait. |

### 9.2 Partial fulfillment

| Scenario | Behavior |
|----------|----------|
| 60% at WH-A, 40% nowhere | Plan = `PARTIALLY_ALLOCATED`. Owner can confirm partial. 60% dispatched. Backorder for 40%. |
| 60% at WH-A, 30% at WH-B, 10% nowhere | Plan = `PARTIALLY_ALLOCATED`. Two source summaries. Backorder for 10%. |
| Stock depleted between allocation and confirm | Confirm fails for affected source (reservation fails). Owner can reallocate or cancel source. |
| Picker finds less than allocated | Pick quantity < allocation quantity. Dispatch created with actual picked qty. Difference tracked. |

### 9.3 Over-allocation prevention

```
Invariant: For any variant V in any plan P:
  SUM(allocationPlanLine.quantityAllocated WHERE variantId = V AND planId = P)
    ≤ demandQty(V, P)

Invariant: For any lot L at location LOC:
  SUM(reservation WHERE lotId = L AND locationId = LOC)
    ≤ StockLotBalance.onHandQty WHERE lotId = L AND locationId = LOC

Enforcement:
  1. FEFO allocator caps at demand.
  2. Manual line creation validates against remaining unallocated demand.
  3. Confirm uses row-level locks on StockLotBalance.
  4. Plan version check prevents stale confirm.
```

### 9.4 Source cancellation mid-flow

| Scenario | Handling |
|----------|----------|
| Cancel one source before confirm | Remove source summary + lines. Reallocate to other sources or backorder. |
| Cancel one source after confirm (before pick) | Release reservations for that source. Create/update backorder for released qty. |
| Cancel one source after pick started | Block cancellation. Require pick list cancellation first, then source cancellation. |
| Cancel one source after dispatch | Block. Dispatch in-transit cannot be cancelled. Handle via return/discrepancy flow. |

### 9.5 Concurrent allocation on same lots

```
Timeline:
  T1: Plan A confirms, locks lot L1 (100 units), reserves 80
  T2: Plan B tries to confirm, locks lot L1 (blocked, waits)
  T3: Plan A commit releases lock
  T4: Plan B locks lot L1, sees 20 available, reserves 20 (was requesting 50)
  T5: Plan B confirm succeeds with PARTIALLY_ALLOCATED for that variant

Protection: PostgreSQL row-level locks via SELECT FOR UPDATE in transaction.
No application-level distributed locks needed.
```

### 9.6 Network/process failure during multi-source confirm

```
Confirm is transactional per source:
  - confirmAll wraps all sources in a single DB transaction.
  - confirmPartial wraps the specified sources in a single DB transaction.

If the process crashes mid-transaction:
  - PostgreSQL rolls back the transaction.
  - No partial reservation state.
  - Client retries confirm (idempotent check via plan version).
```

### 9.7 Receiving discrepancies across multiple dispatches

```
Branch receives Dispatch-A: 80 units OK, 5 damaged
Branch receives Dispatch-B: 15 units OK, 3 short

StockRequest status derivation:
  totalDemanded = 100
  totalReceived = 80 + 15 = 95
  totalDamaged = 5
  totalShort = 3

  If 95 < 100: status = PARTIALLY_RECEIVED
  Owner reviews discrepancies, may:
    - Accept partial (close SR)
    - Create supplementary allocation for shortfall (5 + 3 = 8 units)
```

---

## 10. Migration Plan (Legacy → Multi-Source)

### 10.1 Migration phases

#### Phase 0: Preparation (no code changes)

- [ ] Audit all existing `AllocationPlan` records in production.
- [ ] Verify all plans have `fromLocationId` set.
- [ ] Verify `AllocationPlanLine.locationId` matches `AllocationPlan.fromLocationId` for all existing lines.
- [ ] Document current plan count and status distribution.

#### Phase 1: Schema migration (backward compatible)

```sql
-- Migration: add_multi_warehouse_fulfillment_fields

-- 1. Add AllocationScope enum
CREATE TYPE "AllocationScope" AS ENUM ('SINGLE_SOURCE', 'MULTI_SOURCE');

-- 2. Add BackorderStatus enum
CREATE TYPE "BackorderStatus" AS ENUM (
  'OPEN', 'PROCUREMENT_LINKED', 'PARTIALLY_FULFILLED',
  'FULFILLED', 'CLOSED', 'CANCELLED'
);

-- 3. Add AllocationSourceStatus enum
CREATE TYPE "AllocationSourceStatus" AS ENUM (
  'PENDING', 'CONFIRMED', 'PICKING', 'PICKED',
  'DISPATCHED', 'CANCELLED', 'SKIPPED'
);

-- 4. Extend AllocationPlanStatus enum
ALTER TYPE "AllocationPlanStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_CONFIRMED';
ALTER TYPE "AllocationPlanStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_DISPATCHED';

-- 5. Add new columns to AllocationPlan
ALTER TABLE "allocation_plans" ADD COLUMN "allocation_scope" "AllocationScope" DEFAULT 'SINGLE_SOURCE';
ALTER TABLE "allocation_plans" ADD COLUMN "source_count" INTEGER DEFAULT 1;
ALTER TABLE "allocation_plans" ADD COLUMN "parent_plan_id" INTEGER UNIQUE REFERENCES "allocation_plans"("id");

-- 6. Add new column to AllocationPlanLine
ALTER TABLE "allocation_plan_lines" ADD COLUMN "source_warehouse_id" INTEGER
  REFERENCES "warehouses"("id");

-- 7. Create AllocationSourceSummary table
CREATE TABLE "allocation_source_summaries" (
  "id" SERIAL PRIMARY KEY,
  "org_id" INTEGER NOT NULL,
  "allocation_plan_id" INTEGER NOT NULL REFERENCES "allocation_plans"("id"),
  "location_id" INTEGER NOT NULL REFERENCES "inventory_locations"("id"),
  "warehouse_id" INTEGER REFERENCES "warehouses"("id"),
  "total_allocated_qty" INTEGER DEFAULT 0,
  "total_line_count" INTEGER DEFAULT 0,
  "source_status" "AllocationSourceStatus" DEFAULT 'PENDING',
  "confirmed_at" TIMESTAMPTZ,
  "pick_list_id" INTEGER UNIQUE REFERENCES "pick_lists"("id"),
  "pick_completed_at" TIMESTAMPTZ,
  "dispatch_id" INTEGER UNIQUE REFERENCES "stock_dispatches"("id"),
  "dispatched_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE("allocation_plan_id", "location_id")
);
CREATE INDEX ON "allocation_source_summaries"("org_id", "source_status");
CREATE INDEX ON "allocation_source_summaries"("warehouse_id", "source_status");

-- 8. Create Backorder table
CREATE TABLE "backorders" (
  "id" SERIAL PRIMARY KEY,
  "org_id" INTEGER NOT NULL,
  "stock_request_id" INTEGER NOT NULL REFERENCES "stock_requests"("id"),
  "stock_request_item_id" INTEGER REFERENCES "stock_request_items"("id"),
  "allocation_plan_id" INTEGER NOT NULL REFERENCES "allocation_plans"("id"),
  "variant_id" INTEGER NOT NULL REFERENCES "product_variants"("id"),
  "shortage_qty" INTEGER NOT NULL,
  "fulfilled_qty" INTEGER DEFAULT 0,
  "remaining_qty" INTEGER DEFAULT 0,
  "status" "BackorderStatus" DEFAULT 'OPEN',
  "priority" INTEGER DEFAULT 0,
  "procurement_demand_line_id" INTEGER REFERENCES "procurement_demand_lines"("id"),
  "supplementary_plan_id" INTEGER REFERENCES "allocation_plans"("id"),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),
  "closed_at" TIMESTAMPTZ,
  "cancelled_at" TIMESTAMPTZ
);
CREATE INDEX ON "backorders"("org_id", "status");
CREATE INDEX ON "backorders"("stock_request_id");
CREATE INDEX ON "backorders"("variant_id", "status");

-- 9. Backfill existing plans with source summaries
INSERT INTO "allocation_source_summaries" (
  "org_id", "allocation_plan_id", "location_id", "warehouse_id",
  "total_allocated_qty", "total_line_count", "source_status"
)
SELECT
  ap."org_id",
  ap."id",
  ap."from_location_id",
  ap."warehouse_id",
  COALESCE(agg."total_qty", 0),
  COALESCE(agg."line_count", 0),
  CASE
    WHEN ap."status" = 'DISPATCHED' THEN 'DISPATCHED'::"AllocationSourceStatus"
    WHEN ap."status" = 'PICKED' THEN 'PICKED'::"AllocationSourceStatus"
    WHEN ap."status" IN ('PICKING') THEN 'PICKING'::"AllocationSourceStatus"
    WHEN ap."status" = 'CONFIRMED' THEN 'CONFIRMED'::"AllocationSourceStatus"
    ELSE 'PENDING'::"AllocationSourceStatus"
  END
FROM "allocation_plans" ap
LEFT JOIN (
  SELECT "allocation_plan_id",
         SUM("quantity_allocated") AS "total_qty",
         COUNT(*) AS "line_count"
  FROM "allocation_plan_lines"
  GROUP BY "allocation_plan_id"
) agg ON agg."allocation_plan_id" = ap."id"
WHERE ap."status" != 'CANCELLED';
```

**Important:** Follow `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`:
- New migration file only (never edit applied migrations).
- Run `node scripts/check-migration-integrity.js` before and after.
- Use `prisma migrate deploy` (never `db push` or `migrate reset` on production-like DB).

#### Phase 2: Backend services (feature-flagged)

```
Environment variable: MULTI_SOURCE_ALLOCATION_ENABLED=false (default)

When false:
  - createFromStockRequest ignores allocationScope/sourceLocationIds
  - Existing single-source FEFO runs as before
  - No AllocationSourceSummary records created for new plans
  - Backorder model exists but not populated

When true:
  - New multi-source allocator activated
  - AllocationSourceSummary records created for all plans
  - Backorder records created on confirm with shortage
  - Availability API returns multi-source data
```

Implementation order:

1. **MultiSourceAllocator service** — `src/api/v1/services/multiSourceAllocator.service.ts`
2. **AvailabilityService** — `src/api/v1/services/multiSourceAvailability.service.ts`
3. **AllocationSourceSummary CRUD** — integrated into `allocationPlan.service.ts`
4. **Extended confirm** — per-source and full confirm
5. **Extended pick list creation** — source-filtered
6. **Backorder service** — `src/api/v1/modules/backorders/`
7. **Warehouse queue update** — source summary-based filtering
8. **Extended dispatch handoff** — source summary linkage

#### Phase 3: API routes & controllers

1. `GET /availability/multi-source` — new route
2. Extended `POST /allocation-plans/from-stock-request` — new body fields
3. Extended `POST /allocation-plans/:id/confirm` — per-source support
4. `POST /allocation-plans/:id/dispatch-source` — new route
5. `POST /pick-lists/from-plan/:planId` — extended with `sourceLocationId`
6. Backorder CRUD routes — new module

#### Phase 4: Legacy guard update

```typescript
// legacyFulfillmentGuard.service.ts — extend
function shouldBlockLegacyOwnerFulfillment(stockRequestId: number): boolean {
  // Existing: block if non-cancelled AllocationPlan exists
  // Extended: also block if any non-cancelled Backorder exists
  // Extended: also block if supplementary AllocationPlan exists
}
```

#### Phase 5: Frontend integration (bpa_web)

1. Owner allocation board — show source summaries, multi-warehouse badge.
2. Availability lookup widget — pre-allocation cross-warehouse view.
3. Warehouse queue — already scoped per warehouse; source summary integration.
4. Branch receive — handle multiple incoming dispatches for same SR.
5. Backorder dashboard — new page under owner inventory.

#### Phase 6: Testing & rollout

1. Unit tests for `MultiSourceAllocator` (priority resolution, FEFO, edge cases).
2. Integration tests: multi-source confirm → per-source pick → per-source dispatch → branch receive.
3. Flow simulation script extension (`scripts/simulateStockFlow.ts`).
4. Staged rollout: enable `MULTI_SOURCE_ALLOCATION_ENABLED` per org (if multi-tenant config exists) or globally.

### 10.2 Rollback plan

```
If issues discovered after enabling:
  1. Set MULTI_SOURCE_ALLOCATION_ENABLED=false
  2. New plans revert to single-source behavior
  3. Existing multi-source plans remain in DB but no new ones created
  4. AllocationSourceSummary and Backorder tables remain (no data loss)
  5. Legacy guard continues to function

Schema rollback NOT recommended — tables are additive.
Feature flag is the rollback mechanism.
```

### 10.3 Data integrity checks

```sql
-- Verify no over-allocation after migration
SELECT apl."allocation_plan_id", apl."variant_id",
       SUM(apl."quantity_allocated") AS total_alloc,
       MAX(sri."requested_qty") AS demand
FROM "allocation_plan_lines" apl
JOIN "stock_request_items" sri ON sri."variant_id" = apl."variant_id"
  AND sri."stock_request_id" = (
    SELECT "stock_request_id" FROM "allocation_plans"
    WHERE "id" = apl."allocation_plan_id"
  )
GROUP BY apl."allocation_plan_id", apl."variant_id"
HAVING SUM(apl."quantity_allocated") > MAX(sri."requested_qty");

-- Verify source summary totals match line totals
SELECT ass."id", ass."allocation_plan_id", ass."location_id",
       ass."total_allocated_qty",
       COALESCE(line_sum."actual", 0) AS actual_line_sum
FROM "allocation_source_summaries" ass
LEFT JOIN (
  SELECT "allocation_plan_id", "location_id",
         SUM("quantity_allocated") AS actual
  FROM "allocation_plan_lines"
  GROUP BY "allocation_plan_id", "location_id"
) line_sum ON line_sum."allocation_plan_id" = ass."allocation_plan_id"
  AND line_sum."location_id" = ass."location_id"
WHERE ass."total_allocated_qty" != COALESCE(line_sum."actual", 0);
```

---

## 11. Security & RBAC

### 11.1 Permission matrix

| Action | Required permission | Scope |
|--------|-------------------|-------|
| View multi-source availability | `inventory.view` | Org |
| Create multi-source allocation plan | `warehouse.allocation.manage` | Org |
| Confirm plan (any scope) | `warehouse.allocation.manage` | Org |
| Create pick list (per source) | `warehouse.pick.manage` | Warehouse |
| Execute pick (update lines) | `warehouse.pick.manage` | Warehouse |
| Handoff dispatch | `warehouse.dispatch.manage` | Warehouse |
| Send dispatch | `warehouse.dispatch.manage` | Warehouse |
| View backorders | `inventory.view` | Org |
| Manage backorders | `warehouse.allocation.manage` | Org |
| Cancel backorder | `warehouse.allocation.manage` | Org |
| Receive dispatch (branch) | `inventory.receive` | Branch |

### 11.2 Isolation rules

```
All queries include:
  WHERE orgId = :authOrgId

Warehouse-scoped operations additionally check:
  WHERE warehouseId IN (user's assigned warehouses)

Branch-scoped operations additionally check:
  WHERE branchId IN (user's branch access list)

Cross-org allocation: IMPOSSIBLE by design (source locations filtered by orgId).
```

### 11.3 Audit requirements

Every state transition in the multi-source flow must create an `AllocationPlanEvent`:

| Action | Event logged |
|--------|-------------|
| Multi-source FEFO allocation | `MULTI_SOURCE_ALLOCATED` with source breakdown |
| Per-source confirm | `SOURCE_CONFIRMED` with locationId |
| Per-source pick created | `SOURCE_PICK_CREATED` with pickListId |
| Per-source dispatch | `SOURCE_DISPATCHED` with dispatchId |
| Source cancelled | `SOURCE_CANCELLED` with reason |
| Backorder created | `BACKORDER_CREATED` with variant/qty |
| Supplementary plan linked | `SUPPLEMENTARY_PLAN_LINKED` |

---

## 12. Observability & Audit

### 12.1 Metrics to track

| Metric | Description | Alert threshold |
|--------|-------------|-----------------|
| `allocation.multi_source.plans_created` | Count of multi-source plans | Informational |
| `allocation.multi_source.sources_per_plan` | Histogram of source count | > 5 sources (unusual) |
| `allocation.multi_source.shortage_rate` | % of plans with shortage | > 30% (stock issue) |
| `allocation.confirm.duration_ms` | Time to confirm (with row locks) | > 5000ms |
| `backorder.open_count` | Currently open backorders | > 100 per org |
| `backorder.age_days` | Days since backorder creation | > 14 days |
| `dispatch.multi_source.receive_lag_hours` | Time between first and last dispatch receive | > 72 hours |

### 12.2 Logging requirements

```typescript
// All multi-source operations log structured JSON:
logger.info({
  event: 'multi_source_allocation',
  orgId,
  planId,
  stockRequestId,
  sourceCount: sources.length,
  totalDemand,
  totalAllocated,
  shortageQty,
  sources: sources.map(s => ({
    locationId: s.locationId,
    warehouseId: s.warehouseId,
    allocatedQty: s.allocatedQty,
    priority: s.priority,
  })),
  durationMs: elapsed,
});
```

---

## 13. Implementation Phases

### Phase 1: Foundation (Week 1–2)

| Task | Priority | Effort |
|------|----------|--------|
| Prisma schema migration (§5) | P0 | 1 day |
| Run migration on dev, verify integrity | P0 | 0.5 day |
| `MultiSourceAllocator` service (§4.1–4.2) | P0 | 3 days |
| Unit tests for allocator (priority, FEFO, edge cases) | P0 | 2 days |
| `AllocationSourceSummary` CRUD in allocationPlan.service | P0 | 1 day |
| Feature flag `MULTI_SOURCE_ALLOCATION_ENABLED` | P0 | 0.5 day |

### Phase 2: Core Flow (Week 3–4)

| Task | Priority | Effort |
|------|----------|--------|
| `AvailabilityService` + API route (§6.1) | P1 | 2 days |
| Extended `createFromStockRequest` (multi-source path) | P0 | 2 days |
| Extended `confirmPlan` (per-source + full) | P0 | 3 days |
| Extended pick list creation (source-filtered) | P0 | 1 day |
| Extended dispatch handoff (source summary linkage) | P0 | 1 day |
| `dispatch-source` API (direct dispatch without pick) | P1 | 1 day |

### Phase 3: Backorder & Supplementary (Week 5–6)

| Task | Priority | Effort |
|------|----------|--------|
| `Backorder` service + CRUD routes (§6.7) | P1 | 3 days |
| Backorder → supplementary plan trigger | P1 | 2 days |
| Procurement demand integration (§4.3.4) | P1 | 2 days |
| Legacy guard update (§10 Phase 4) | P0 | 1 day |
| Warehouse queue update (§8.4) | P1 | 1 day |

### Phase 4: Integration Testing (Week 7)

| Task | Priority | Effort |
|------|----------|--------|
| End-to-end integration tests | P0 | 3 days |
| Flow simulation script update | P1 | 1 day |
| Concurrency stress tests (parallel confirm) | P1 | 1 day |
| Backfill verification queries (§10.3) | P0 | 0.5 day |

### Phase 5: Frontend (Week 8–9)

| Task | Priority | Effort |
|------|----------|--------|
| Owner allocation board — multi-source view | P0 | 3 days |
| Availability lookup widget | P1 | 2 days |
| Backorder dashboard | P1 | 2 days |
| Branch receive — multi-dispatch handling | P0 | 2 days |
| Warehouse queue — source summary integration | P1 | 1 day |

### Phase 6: Rollout (Week 10)

| Task | Priority | Effort |
|------|----------|--------|
| Staging deployment + smoke test | P0 | 1 day |
| Production migration (with integrity check) | P0 | 0.5 day |
| Enable feature flag (staged) | P0 | 0.5 day |
| Monitor metrics + alerts (§12.1) | P0 | Ongoing |

---

## Appendix A — Glossary

| Term | Definition |
|------|-----------|
| **Allocation Plan** | A plan that maps demand (from a stock request) to inventory lots across one or more source locations. |
| **Allocation Line** | A single lot-level allocation slice within a plan, tied to a specific source location. |
| **Source Summary** | Per-source-location aggregate within a multi-source plan, tracking that source's lifecycle independently. |
| **Backorder** | A persistent record of unmet demand from an allocation plan, driving procurement or supplementary allocation. |
| **Supplementary Plan** | A follow-up allocation plan created to fulfill backorder quantities after stock becomes available. |
| **FEFO** | First Expired, First Out — lot selection strategy based on expiry date ascending. |
| **Source Priority** | The order in which warehouse locations are considered for allocation (preferred → same hub → same region → any org). |
| **Reservation** | A ledger-backed stock hold (`RESERVE_FULFILLMENT`) that prevents allocated stock from being used by other plans. |
| **Pick List** | A warehouse execution document listing items and locations for a picker to collect. One per source location in multi-source plans. |
| **Dispatch** | A `StockDispatch` record representing a physical shipment from one location to another. One per source location. |
| **Challan/DO** | Delivery Order / dispatch document accompanying a physical shipment. |

---

## Appendix B — Decision Log

| # | Decision | Rationale | Date |
|---|----------|-----------|------|
| D1 | Use `AllocationSourceSummary` instead of multiple `AllocationPlan` records | One plan per SR preserves the 1:1 (or 1:N via supplementary) relationship; source summaries are denormalized for efficient warehouse queue queries without complex joins. | 2026-04-11 |
| D2 | Per-source independent pick/dispatch | Warehouse staff should not coordinate across DCs. Each source is an independent execution unit. | 2026-04-11 |
| D3 | Feature flag for rollout | `MULTI_SOURCE_ALLOCATION_ENABLED` allows gradual rollout and instant rollback without schema changes. | 2026-04-11 |
| D4 | Derive plan status from source summaries | Avoids manual status management; plan status is always consistent with actual source states. | 2026-04-11 |
| D5 | Backorder as separate model (not just ProcurementDemandLine) | Backorder covers both procurement and inter-warehouse supplementary paths; cleaner lifecycle than overloading ProcurementDemandLine. | 2026-04-11 |
| D6 | Transaction-per-source on confirm | Full transaction across all sources in confirmAll; per-source transaction in confirmPartial. PostgreSQL row locks prevent double-reserve. | 2026-04-11 |
| D7 | Additive schema only | No column drops, no table renames, no enum value removals. New columns are nullable or have defaults. Follows `PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`. | 2026-04-11 |
| D8 | Keep single-source as default | `allocationScope` defaults to `SINGLE_SOURCE`. Existing API calls without the new field work identically. Zero breaking changes. | 2026-04-11 |

---

## Related Documents

- [ENTERPRISE_ALLOCATION_AND_PICKING_PLAN.md](./ENTERPRISE_ALLOCATION_AND_PICKING_PLAN.md) — Current single-source allocation spec (this plan extends §"Deferred: Wave batching / multi-warehouse lines").
- [SUPPLY_CHAIN_STATE_MACHINE.md](./SUPPLY_CHAIN_STATE_MACHINE.md) — Authoritative enum reference.
- [COMPLETE_STOCK_REQUEST_DELIVERY_FLOW_IMPLEMENTATION_SUMMARY.md](./COMPLETE_STOCK_REQUEST_DELIVERY_FLOW_IMPLEMENTATION_SUMMARY.md) — Current enterprise flow implementation.
- [CENTRAL_WAREHOUSE_BRANCH_FULFILLMENT_ENTERPRISE_PLAN.md](./CENTRAL_WAREHOUSE_BRANCH_FULFILLMENT_ENTERPRISE_PLAN.md) — Index document for central warehouse fulfillment.
- [WAREHOUSE_INTERNAL_DELIVERY_AUDIT_AND_GAP_REPORT.md](./WAREHOUSE_INTERNAL_DELIVERY_AUDIT_AND_GAP_REPORT.md) — Audit identifying multi-warehouse as deferred.
- [PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md](./PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md) — Migration safety policy.
