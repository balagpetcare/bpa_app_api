# DELIVERY SYSTEM — CODE TRUTH AUDIT

> **Date:** 2026-04-11
> **Source of truth:** Code in `backend-api/` and `bpa_web/` at branch `release/V-A1.0.7` / `release/V-A1.0.8`
> **Existing docs used as secondary context only.**

---

## Table of Contents

1. [Data Model (Prisma Schema)](#1-data-model-prisma-schema)
2. [Current Flow: Product → Stock Request → Receive](#2-current-flow-product--stock-request--receive)
3. [Legacy Flow (StockTransfer Path)](#3-legacy-flow-stocktransfer-path)
4. [Enterprise Flow (AllocationPlan / StockDispatch Path)](#4-enterprise-flow-allocationplan--stockdispatch-path)
5. [Dual Flow Classification](#5-dual-flow-classification)
6. [Backend Route & Service Map](#6-backend-route--service-map)
7. [Frontend Page & Component Map](#7-frontend-page--component-map)
8. [Migration Chain State](#8-migration-chain-state)
9. [Environment Flags & Feature Gates](#9-environment-flags--feature-gates)
10. [Cross-Reference: Code vs Existing Docs](#10-cross-reference-code-vs-existing-docs)

---

## 1. Data Model (Prisma Schema)

### 1.1 Core Delivery Models

| Model | Key Fields | Status Enum | Role |
|-------|-----------|-------------|------|
| `StockRequest` | orgId, branchId, requesterUserId, status, requestIntent, urgency | `StockRequestStatus` | Demand signal from branch |
| `StockRequestItem` | stockRequestId, productId, variantId, requestedQty, fulfilledQty, cancelledQty, lineKind, backorderStatus | `StockRequestItemLineKind`, `StockRequestItemBackorderStatus` | Per-variant demand line |
| `AllocationPlan` | orgId, stockRequestId (unique), fromLocationId, warehouseId, status, allocationScope, sourceCount, version, parentPlanId | `AllocationPlanStatus`, `AllocationScope` | Enterprise fulfillment plan |
| `AllocationPlanLine` | allocationPlanId, variantId, lotId, locationId, quantityAllocated, demandQty, quantityShort, sourceWarehouseId | — (lineStatus is optional string) | Per-lot allocation |
| `AllocationPlanEvent` | allocationPlanId, action, fromStatus, toStatus | — | Audit trail |
| `AllocationSourceSummary` | allocationPlanId, locationId, warehouseId, totalAllocatedQty, sourceStatus, pickListId, dispatchId | `AllocationSourceStatus` | Multi-source tracking |
| `PickList` | orgId, allocationPlanId (unique), status, fromLocationId, stockDispatchId | `PickListStatus` | Warehouse pick work |
| `PickListLine` | pickListId, variantId, lotId, locationId, quantityToPick, quantityPicked | — | Per-lot pick instruction |
| `StockDispatch` | orgId, stockRequestId, fromLocationId, toLocationId, status, carrier/vehicle/tracking | `StockDispatchStatus` | Shipment record |
| `StockDispatchItem` | stockDispatchId, variantId, lotId, quantityDispatched, quantityReceived, quantityDamaged, quantityShort | — | Per-lot dispatch line |
| `DispatchReceiveSession` | orgId, stockDispatchId (unique), status | `DispatchReceiveSessionStatus` | Branch receive workflow |
| `DispatchReceiveSessionLine` | sessionId, stockDispatchItemId, quantityReceived, quantityDamaged, quantityShort | — | Per-line receive data |
| `StockDispatchDiscrepancy` | orgId, stockDispatchId, variantId, quantity, status, reasonCode | `StockDiscrepancyStatus` | Post-receive discrepancy |
| `StockTransfer` | fromLocationId, toLocationId, status, stockRequestId, enterpriseSupersededAt | `StockTransferStatus` | Legacy internal move |
| `StockTransferItem` | transferId, variantId, quantitySent, quantityReceived, quantityDamaged, stockRequestItemId | — | Legacy transfer line |
| `StockDiscrepancy` | transferId, variantId, expected/received/damaged/missing | `StockDiscrepancyStatus` | Legacy transfer discrepancy |

### 1.2 Procurement / Shortage Models

| Model | Key Fields | Status Enum | Role |
|-------|-----------|-------------|------|
| `ProcurementDemandLine` | orgId, stockRequestId, stockRequestItemId, allocationPlanId, variantId, demandQty, fulfilledQty, purchaseOrderId, fulfillmentDispatchId, status | `ProcurementDemandStatus` | Shortage → PO link |
| `Backorder` | orgId, stockRequestId, stockRequestItemId, allocationPlanId, variantId, shortageQty, fulfilledQty, remainingQty, supplementaryPlanId, status | `BackorderStatus` | Persistent shortage tracker |
| `PurchaseOrder` / `PurchaseOrderLine` | vendor, warehouse, status, orderedQty, receivedQty | `PurchaseOrderStatus` | Vendor procurement |

### 1.3 Inventory Foundation

| Model | Key Fields | Role |
|-------|-----------|------|
| `InventoryLocation` | branchId, type, warehouseId, zoneId, binId | Canonical stock location |
| `StockBalance` | locationId, variantId, onHandQty, reservedQty | Aggregate balance |
| `StockLotBalance` | locationId, lotId, onHandQty, reservedQty | Lot-level balance |
| `StockLedger` | locationId, variantId, type, quantityDelta, refType, refId | Immutable movement log |
| `StockLot` | orgId, variantId, lotCode, mfgDate, expDate | Lot identity |
| `Grn` / `GrnLine` | locationId, stockDispatchId, purchaseOrderId, status, qty fields | Goods received note |
| `VendorReceiveSession` | grnId, status | Vendor receive workflow |

### 1.4 Warehouse Infrastructure

| Model | Role |
|-------|------|
| `Warehouse` | DC/warehouse identity with type, QC flags, tolerances |
| `WarehouseZone` | Logical zone within warehouse |
| `WarehouseRack` | Physical rack within zone |
| `WarehouseBin` | Storage bin within rack |
| `WarehouseStaffAssignment` | User ↔ warehouse role mapping |
| `WarehouseTransferOrder` / Line | Inter-DC transfers |
| `PutawayTask` | Post-receive putaway work |
| `QcInspection` | Quality check workflow |
| `DeliveryAssignment` | Driver/delivery assignment |
| `ProofOfDelivery` | POD capture |

### 1.5 Key Enums (Delivery)

| Enum | Values (key ones) |
|------|-------------------|
| `StockRequestStatus` | DRAFT, SUBMITTED, OWNER_REVIEW, APPROVED, PARTIALLY_DISPATCHED, DISPATCHED, PARTIALLY_RECEIVED, RECEIVED_FULL, CLOSED, CANCELLED, DECLINED |
| `StockRequestIntent` | INTERNAL_TRANSFER, PROCUREMENT |
| `AllocationPlanStatus` | DRAFT, ALLOCATED, PARTIALLY_ALLOCATED, FAILED, CONFIRMED, PICKING, PICKED, CANCELLED |
| `AllocationScope` | SINGLE_SOURCE, MULTI_SOURCE |
| `AllocationSourceStatus` | PENDING, CONFIRMED, PICKING, PICKED, DISPATCHED, CANCELLED |
| `StockDispatchStatus` | CREATED, PACKED, IN_TRANSIT, DELIVERED, FAILED, CANCELLED |
| `DispatchReceiveSessionStatus` | DRAFT, AWAITING_CONFIRMATION, POSTED, CANCELLED |
| `StockTransferStatus` | DRAFT, SENT, IN_TRANSIT, RECEIVED, DISPUTED, RESOLVED, CANCELLED |
| `PickListStatus` | PENDING, IN_PROGRESS, COMPLETED, CANCELLED |
| `BackorderStatus` | OPEN, PARTIALLY_FULFILLED, FULFILLED, CANCELLED |
| `ProcurementDemandStatus` | PENDING, PO_LINKED, RECEIVED, DISPATCHED, CANCELLED |

---

## 2. Current Flow: Product → Stock Request → Receive

### 2.1 Product / Variant / Stock Entry

- **Product** → **ProductVariant** (sku, lot/expiry flags)
- Stock tracked at `InventoryLocation` via **StockBalance** (aggregate) + **StockLotBalance** (lot-level)
- Movements recorded in **StockLedger** (immutable, type + quantityDelta)
- Legacy `Inventory` model still exists for simple branch stock (non-enterprise)

### 2.2 Branch Stock Request Create/Edit/Submit

**Staff creates request:**
- `POST /api/v1/stock-requests` → `stock_requests.service.createRequest`
- Status: `DRAFT`
- Branch staff edits lines: `PATCH /api/v1/stock-requests/:id` → `updateRequestItems`
- Submit: `POST /api/v1/stock-requests/:id/submit` → `submitRequest` → status `SUBMITTED`
- Cancel: `POST /api/v1/stock-requests/:id/cancel` → `cancelRequest` → status `CANCELLED`

**Frontend (staff):**
- List: `app/staff/.../inventory/stock-requests/page.jsx`
- Create: stock-request-create page (via next.config rewrite)
- Detail: `StaffStockRequestDetailClient.jsx` — read-only with submit/cancel actions

### 2.3 Owner Request Review

**Owner reviews:**
- List: `app/owner/.../inventory/stock-requests/page.tsx` (tabs: All, Internal Transfer, Procurement)
- Detail: `app/owner/.../inventory/stock-requests/[id]/page.tsx`
- Approve: `POST /api/v1/stock-requests/:id/approve` → `approveRequest`
- Decline: `POST /api/v1/stock-requests/:id/decline` → `declineRequest` → status `DECLINED`

**From detail page, owner can take TWO paths:**
1. **Legacy fulfill** → `PATCH /api/v1/stock-requests/:id/fulfill` (if not blocked)
2. **Enterprise start** → `POST /api/v1/fulfillment/stock-requests/:id/start`

### 2.4 Owner Fulfill / Allocation / Dispatch (Dual Path)

See sections 3 and 4 below for detailed flow analysis.

### 2.5 Warehouse Pick / Queue / Dispatch

**Warehouse fulfillment queue:**
- `GET /api/v1/owner/warehouse/fulfillment-queue` → `warehouseFulfillmentQueue.service.listWarehouseFulfillmentQueue`
- Returns plans in CONFIRMED/PICKING/PICKED with next-action hints
- Frontend: `app/owner/.../inventory/warehouse-fulfillment/page.tsx`

**Pick list:**
- Created from confirmed allocation plan
- Pick lines with quantityToPick / quantityPicked
- Status: PENDING → IN_PROGRESS → COMPLETED

**Dispatch:**
- `POST /api/v1/inventory/dispatches` → `dispatches.service.createDispatch` → status `CREATED`
- `POST /api/v1/inventory/dispatches/:id/send` → `sendDispatch` → status `IN_TRANSIT`
  - Ledger: optional RELEASE_FULFILLMENT_RESERVE, then TRANSFER_OUT per line
  - SR status updated: DISPATCHED or PARTIALLY_DISPATCHED

### 2.6 Branch Receive / GRN / Discrepancy / Final Close

**Branch inbound queue:**
- `GET /api/v1/staff/branch/:branchId/inbound-queue` → `branchInboundQueue.service`
- Returns unified dispatch + legacy transfer items

**Receive workflow (enterprise - DispatchReceiveSession):**
1. **Verify** (draft): `PUT /api/v1/inventory/dispatches/:id/receive-session` → session `DRAFT`
2. **Submit**: `POST .../receive-session/submit` → session `AWAITING_CONFIRMATION`
3. **Confirm & post**: `POST .../receive-session/confirm` → ledger posting (TRANSFER_IN, DAMAGE), GRN creation, dispatch `DELIVERED`, session `POSTED`
4. **Cancel**: `POST .../receive-session/cancel` → session `CANCELLED`

**Manager immediate path:**
- `POST /api/v1/inventory/dispatches/:id/receive` mode `legacy_immediate` → direct ledger posting

**Post-receive:**
- SR status: `PARTIALLY_RECEIVED` or `RECEIVED_FULL` via `markStockRequestStatusFromDispatchReceive`
- Discrepancies: `StockDispatchDiscrepancy` created when short/damaged
- GRN linked to dispatch via `stockDispatchId`

**Frontend (staff):**
- Incoming list: `app/staff/.../inventory/incoming/page.jsx` (unified)
- Receive page: `app/staff/.../inventory/incoming/[dispatchId]/page.jsx`
  - Per-line receive/damaged/short inputs
  - Different UIs for staff (verify/submit) vs manager (immediate confirm)

---

## 3. Legacy Flow (StockTransfer Path)

### 3.1 Flow

```
Branch DRAFT → SUBMITTED
  ↓
Owner PATCH /stock-requests/:id/fulfill
  → fulfillStockRequestFlexible (stock_requests.service)
  → legacyFulfillmentGuard.assertLegacyFulfillmentAllowedForStockRequest
  → Creates StockTransfer (DRAFT) via transfers.service.createTransfer
  ↓
Owner POST /stock-requests/:id/dispatch
  → fulfillAndDispatch (stock_requests.service)
  → transfers.service.dispatchRequest → sendTransfer
  → StockTransfer: SENT/IN_TRANSIT
  → SR: DISPATCHED / PARTIALLY_DISPATCHED
  ↓
Branch POST /transfers/:id/receive
  → transfers.service.receiveTransfer
  → StockTransfer: RECEIVED
  → Discrepancies via StockDiscrepancy
  ↓
Owner POST /transfers/:id/resolve-dispute (if needed)
  → transfers.service.resolveDispute
```

### 3.2 Guard Logic

`legacyFulfillmentGuard.service.ts` blocks legacy when ANY of:
1. `DISABLE_LEGACY_STOCK_REQUEST_FULFILL=true`
2. Active allocation plan exists (via `shouldBlockLegacyOwnerFulfillment`)
3. Non-cancelled/non-closed backorders exist for the SR

### 3.3 Status: SHOULD DEPRECATE (controlled retirement)

The legacy flow is actively guarded against. Transfer routes log deprecation warnings. But the code paths remain functional for backward compatibility.

---

## 4. Enterprise Flow (AllocationPlan / StockDispatch Path)

### 4.1 Flow

```
Branch DRAFT → SUBMITTED
  ↓
Owner POST /fulfillment/stock-requests/:id/start
  → fulfillment.service.startStockRequestFulfillment
  → allocationPlan.service.createFromStockRequest
  → AllocationPlan: DRAFT → (FEFO run) → ALLOCATED / PARTIALLY_ALLOCATED / FAILED
  ↓
Owner POST /allocation-plans/:id/confirm
  → allocationPlan.service.confirmPlan
  → Optional reservation (RESERVE_FULFILLMENT ledger)
  → Plan: CONFIRMED
  → May create ProcurementDemandLines (from shortage)
  → May create Backorders (from plan shortage)
  → SR: → APPROVED (if transition allowed)
  ↓
Warehouse fulfillment queue picks up CONFIRMED plans
  → PickList created (PENDING → IN_PROGRESS → COMPLETED)
  ↓
POST /inventory/dispatches (createDispatch)
  → StockDispatch: CREATED
  ↓
POST /inventory/dispatches/:id/send (sendDispatch)
  → Optional RELEASE_FULFILLMENT_RESERVE
  → TRANSFER_OUT ledger
  → StockDispatch: IN_TRANSIT
  → SR: DISPATCHED / PARTIALLY_DISPATCHED
  ↓
Branch receive session workflow:
  PUT  .../receive-session        → DispatchReceiveSession: DRAFT
  POST .../receive-session/submit → session: AWAITING_CONFIRMATION
  POST .../receive-session/confirm → ledger posting, GRN, dispatch DELIVERED, session POSTED
  → SR: PARTIALLY_RECEIVED / RECEIVED_FULL
```

### 4.2 Multi-Source Path (behind feature flag)

When `MULTI_SOURCE_ALLOCATION_ENABLED=true` and `allocationScope=MULTI_SOURCE`:
- `multiSourceAllocator.service.ts` allocates across multiple warehouse locations
- `AllocationSourceSummary` records per-source tracking
- Per-source pick lists and dispatches
- **Status: IMPLEMENTED but gated behind feature flag (default off)**

### 4.3 Procurement Shortage Path

When allocation plan has shortage lines:
1. `createProcurementDemandLinesFromShortage` creates `ProcurementDemandLine` entries
2. `createBackordersFromPlanShortage` creates `Backorder` entries
3. Owner links demand lines to PO lines via `POST /procurement-demand/:id/link-po-line`
4. After GRN received: `autoFulfillmentQueue.service` triggers `tryAutoDispatchFulfilledDemandsForGrn`
5. If `AUTO_PROCUREMENT_DEMAND_DISPATCH=true`: auto-creates and sends dispatch

### 4.4 Status: PRIMARY PATH (should be canonical)

This is the enterprise-grade path that should become the sole canonical flow.

---

## 5. Dual Flow Classification

| Component | Legacy | Enterprise | Status |
|-----------|--------|-----------|--------|
| **Stock Request Create/Submit** | Same | Same | IMPLEMENTED (shared) |
| **Owner Review (approve/decline)** | Same | Same | IMPLEMENTED (shared) |
| **Owner Fulfill** | `PATCH .../fulfill` → StockTransfer | `POST /fulfillment/.../start` → AllocationPlan | BOTH IMPLEMENTED |
| **Allocation Plan** | N/A | Full CRUD + FEFO + confirm | IMPLEMENTED |
| **Multi-source Allocation** | N/A | Behind `MULTI_SOURCE_ALLOCATION_ENABLED` | IMPLEMENTED (gated) |
| **Pick List** | N/A | PickList model + service | IMPLEMENTED |
| **Dispatch Create** | Via StockTransfer | Via StockDispatch | BOTH IMPLEMENTED |
| **Dispatch Send** | transfers.sendTransfer | dispatches.sendDispatch | BOTH IMPLEMENTED |
| **Branch Receive** | transfers.receiveTransfer | DispatchReceiveSession (verify/submit/confirm) | BOTH IMPLEMENTED |
| **GRN** | Not created on legacy receive | Created on dispatch receive | ENTERPRISE ONLY |
| **Discrepancy** | StockDiscrepancy (transfer) | StockDispatchDiscrepancy (dispatch) | SEPARATE MODELS |
| **Procurement Demand** | N/A | From plan shortage | IMPLEMENTED |
| **Backorders** | N/A | From plan shortage | IMPLEMENTED |
| **Supplementary Plans** | N/A | parentPlanId on AllocationPlan | SCHEMA READY, not wired |
| **Legacy Guard** | legacyFulfillmentGuard blocks | N/A | IMPLEMENTED |
| **Owner Warehouse Queue** | N/A | warehouseFulfillmentQueue | IMPLEMENTED |
| **Branch Inbound Queue** | Shows transfers + dispatches | Shows transfers + dispatches | IMPLEMENTED (unified) |
| **SR Status Derivation** | Basic status | deriveRequestStatus (plan + dispatch aware) | IMPLEMENTED |
| **Quantity Computation** | Basic | computeFullRequestSummary (FEFO-aware) | IMPLEMENTED |
| **Reservation (ledger)** | N/A | RESERVE_FULFILLMENT / RELEASE | IMPLEMENTED (env-gated) |
| **Auto-dispatch from GRN** | N/A | autoFulfillmentQueue + procurement demand | IMPLEMENTED (env-gated) |
| **Print (challan/worksheet)** | N/A | Multiple print endpoints | IMPLEMENTED |

### 5.1 Per-Component Verdict

| Component | Verdict |
|-----------|---------|
| StockTransfer create/send/receive | **DEPRECATED** — should remove after migration period |
| `PATCH /stock-requests/:id/fulfill` | **DEPRECATED** — legacy shortcut |
| `POST /stock-requests/:id/dispatch` | **DEPRECATED** — legacy shortcut |
| `POST /transfers/:id/send` | **DEPRECATED** — use dispatches.sendDispatch |
| `POST /transfers/:id/receive` | **DEPRECATED** — use dispatch receive session |
| AllocationPlan full lifecycle | **SHOULD KEEP** — canonical enterprise path |
| StockDispatch full lifecycle | **SHOULD KEEP** — canonical dispatch |
| DispatchReceiveSession | **SHOULD KEEP** — canonical branch receive |
| Multi-source allocator | **SHOULD KEEP** — enterprise multi-warehouse |
| Procurement demand/backorders | **SHOULD KEEP** — shortage management |
| Warehouse fulfillment queue | **SHOULD KEEP** — operational queue |
| Branch inbound queue | **SHOULD KEEP** — operational queue |
| Legacy fulfillment guard | **SHOULD KEEP** — transitional safety |
| Transfer routes | **SHOULD REMOVE** — after legacy retirement |

---

## 6. Backend Route & Service Map

### 6.1 Route Registration (`src/api/v1/routes.ts`)

| Mount Path | Module | Delivery? |
|-----------|--------|-----------|
| `/stock-requests` | stock_requests | Yes |
| `/transfers` | transfers | Yes (legacy) |
| `/allocation-plans` | allocation_plans | Yes |
| `/fulfillment` | fulfillment | Yes |
| `/procurement-demand` | procurement_demand | Yes |
| `/availability` | availability | Yes |
| `/backorders` | backorders | Yes |
| `/grn` | grn | Yes |

**Note:** Dispatches are mounted under `/inventory/dispatches` via `inventory.routes.ts`, NOT at the v1 root. Stock requests are also aliased under `/inventory/stock-requests`. This creates duplicate surface area.

### 6.2 Key Service Files

| Service | File | Role |
|---------|------|------|
| Stock Request CRUD | `modules/stock_requests/stock_requests.service.ts` | Core SR lifecycle + legacy fulfill |
| Dispatches | `modules/dispatches/dispatches.service.ts` | Dispatch create/send/receive + session |
| Allocation Plans | `modules/allocation_plans/allocationPlan.service.ts` | Plan create/FEFO/confirm/cancel |
| Fulfillment Facade | `modules/fulfillment/fulfillment.service.ts` | Thin entry point for enterprise path |
| Reservation | `modules/fulfillment/reservation.service.ts` | Ledger-based stock reservation |
| FEFO Allocation | `modules/inventory/fefoAllocation.service.ts` | FEFO lot selection logic |
| GRN | `modules/grn/grn.service.ts` | GRN create/receive/void + vendor sessions |
| Procurement Demand | `modules/procurement_demand/procurementDemand.service.ts` | Demand line management + auto-dispatch |
| Backorders | `modules/backorders/backorder.service.ts` | Backorder CRUD |
| Transfers (legacy) | `modules/transfers/transfers.service.ts` | Legacy transfer operations |
| Legacy Guard | `services/legacyFulfillmentGuard.service.ts` | Blocks legacy when enterprise active |
| Status Derivation | `services/stockRequestStatus.service.ts` | Pure-logic status rules |
| Quantity Math | `services/stockRequestQuantity.service.ts` | Canonical qty computation |
| Warehouse Queue | `services/warehouseFulfillmentQueue.service.ts` | Owner fulfillment queue |
| Branch Inbound | `services/branchInboundQueue.service.ts` | Branch receive queue |
| Branch Receive Facade | `services/branchReceiveSession.service.ts` | Re-exports dispatches receive functions |
| Multi-Source Allocator | `services/multiSourceAllocator.service.ts` | Multi-warehouse FEFO |
| Multi-Source Availability | `services/multiSourceAvailability.service.ts` | Availability read model |
| Auto-Fulfillment Queue | `modules/fulfillment/autoFulfillmentQueue.service.ts` | GRN → auto-dispatch trigger |
| Warehouse Ops Notifications | `services/warehouseOpsNotifications.service.ts` | In-app notifications |
| Branch Type Resolver | `services/branchTypeResolver.service.ts` | Branch category detection |

### 6.3 Key Endpoint Summary

**Stock Requests (15 endpoints):**
- CRUD: create, list, getById, updateItems
- Lifecycle: submit, cancel, approve, decline
- Fulfill: fulfill (legacy), dispatch (legacy), allocation-preview
- Lines: cancelLine, restoreLine

**Dispatches (17 endpoints):**
- CRUD: listDispatches, createDispatch, getDispatch
- Lifecycle: updateStatus, sendDispatch
- Receive: receiveDispatch, receive-session (GET/PUT/POST submit/confirm/cancel)
- Discrepancy: list, create, resolve
- Print: challan, branch-confirmation, discrepancy, worksheet

**Allocation Plans (9 endpoints):**
- CRUD: list, getById
- Create: from-stock-request, from-medicine-requisition
- Mutate: addManualLine, reallocate, run-fefo
- Lifecycle: confirm, cancel

**GRN (11 endpoints):**
- CRUD: create, list, getById, update
- Lifecycle: receive, void, confirm
- Vendor receive: draft, submit
- Print: standard, discrepancy, worksheet

---

## 7. Frontend Page & Component Map

### 7.1 Owner Pages

| Page | Path | Function |
|------|------|----------|
| SR List | `app/owner/.../stock-requests/page.tsx` | Tabs (all/transfer/procurement), filters |
| SR Detail | `app/owner/.../stock-requests/[id]/page.tsx` | Review, decline, start enterprise, legacy fulfill |
| Challan | `app/owner/.../stock-requests/[id]/challan/[dispatchId]/page.tsx` | Print dispatch challan |
| Warehouse Queue | `app/owner/.../warehouse-fulfillment/page.tsx` | Fulfillment queue with next-action |
| Allocation Detail | `app/owner/.../allocation/[id]/page.tsx` | Plan review, pick, dispatch handoff |
| PO List | `app/owner/.../purchase-orders/page.tsx` | PO management |
| PO Detail | `app/owner/.../purchase-orders/[id]/page.tsx` | PO actions, vendor receive links |
| Procurement Demand List | `app/owner/.../procurement-demand/page.tsx` | Shortage demand table |
| Procurement Demand Detail | `app/owner/.../procurement-demand/[id]/page.tsx` | Link PO line, cancel |

### 7.2 Staff Pages

| Page | Path | Function |
|------|------|----------|
| SR List | `app/staff/.../inventory/stock-requests/page.jsx` | List with filters, create link |
| SR Detail | `app/staff/.../inventory/stock-requests/[id]/page.tsx` | Read-only with submit/cancel |
| SR Detail (alt) | `app/staff/.../inventory/stock-request-detail-page/[requestId]/page.tsx` | Same component, rewrite URL |
| Incoming List | `app/staff/.../inventory/incoming/page.jsx` | Unified dispatch + transfer inbound |
| Receive Dispatch | `app/staff/.../inventory/incoming/[dispatchId]/page.jsx` | Per-line receive with session workflow |
| Warehouse Dashboard | `app/staff/.../warehouse/page.tsx` | KPIs, queue tabs, quick actions |
| Inbound Transfers | `app/staff/.../warehouse/inbound-transfers/page.tsx` | Branch inbound queue |
| Receive PO | `app/staff/.../warehouse/receive-po/page.tsx` | Vendor receipts queue, bulk receive |
| GRN Detail | `app/staff/.../warehouse/vendor-receipt-grn-detail-page/[grnId]/page.tsx` | GRN confirm/edit |

### 7.3 API Layer

| File | Role |
|------|------|
| `lib/api.ts` | All staff API calls (stock requests, dispatches, receive sessions, GRN, etc.) |
| `app/owner/_lib/ownerApi.ts` | Owner API calls (procurement demand, organizations, etc.) |
| `lib/staffInventoryRoutes.js` | URL helper functions for staff inventory routes |
| `src/lib/branchSidebarConfig.ts` | Sidebar config with warehouse hub detection |
| `app/owner/_lib/stockRequestDestinationResolver.ts` | Location resolution for fulfillment source |

### 7.4 Key Components

| Component | File | Role |
|-----------|------|------|
| StaffStockRequestDetailClient | `app/staff/.../inventory/_components/` | Staff SR detail (shared) |
| VendorReceiveGrnCard | `app/staff/.../warehouse/receive-po/_components/` | GRN card in queue |
| ManagerReceiveEditor | `app/staff/.../warehouse/receive-po/_components/` | Manager GRN confirm flow |
| BulkReceivePage | `app/owner/.../inventory/receipts/bulk/` | Bulk receive (shared by owner + staff) |

---

## 8. Migration Chain State

### 8.1 Total Migrations: 237

- Range: `20260116192630_owner_profile_data` → `20260502000000_ensure_warehouses_po_over_receipt_tolerance_column`

### 8.2 Delivery-Critical Migrations

| Migration | Purpose | Status |
|-----------|---------|--------|
| `20260204000000_add_stock_request_and_items` | StockRequest + items | Applied |
| `20260219180000_stock_workflow_dispatch_ledger_returns` | Dispatch + ledger foundation | Applied |
| `20260401143000_staff_invites_warehouse_target` | **Modified** — idempotent warehouse staff role | Modified (checksum risk) |
| `20260402140000_warehouse_phase1_rack_bin_transfer_line` | **Modified** — racks, bins, transfer item links | Modified (checksum risk) |
| `20260404200000_enterprise_allocation_picking_enhancement` | **BLOCKER** — ALTER TYPE AllocationPlanStatus before table exists | Ordering bug |
| `20260408140000_procurement_demand_lines_central_fulfillment` | **BLOCKER** — FKs to allocation_plans before table exists | Ordering bug |
| `20260409180000_stock_transfer_enterprise_superseded_allocation_trigger` | **BLOCKER** — trigger references allocation_plans before table exists | Ordering bug |
| `20260411180000_multi_warehouse_fulfillment_system` | Placeholder (SELECT 1) — real DDL moved | OK (no-op) |
| `20260429120000_warehouse_enterprise_po_allocation_pick_pod` | Creates AllocationPlan + PickList tables | Foundation |
| `20260429130000_multi_warehouse_fulfillment_system` | AllocationScope enum, multi-source tables | Extends foundation |
| `20260501000000_drift_reconciliation_baseline` | **RISK** — migrate resolve'd; dangerous on new DB | Special handling needed |

### 8.3 Migration Chain Blockers

**CRITICAL: Three migrations reference `allocation_plans` / `AllocationPlanStatus` before `20260429120000` creates them:**

1. `20260404200000_enterprise_allocation_picking_enhancement` — ALTER TYPE + ALTER TABLE on non-existent objects
2. `20260408140000_procurement_demand_lines_central_fulfillment` — FK references to non-existent tables
3. `20260409180000_stock_transfer_enterprise_superseded_allocation_trigger` — trigger queries non-existent table

**Impact:** `prisma migrate deploy` on an empty database will FAIL. Shadow database replay will FAIL. Production works only because migrations were applied incrementally.

**Resolution required:** These migrations must be either:
- Converted to no-ops (like `20260411180000`) with DDL consolidated into `20260429120000+`
- Made idempotent with IF EXISTS guards
- Reordered (risky for applied checksums)

### 8.4 Additional Risks

- **Modified migrations** (`20260401143000`, `20260402140000`) have altered checksums — `prisma migrate deploy` may reject them on databases where originals were applied
- **Duplicate timestamp prefixes** exist at several points — lexicographic ordering is fragile
- **`MemberRole` ADD VALUE** in `20260408180000` has no idempotency guard — replay failure risk

---

## 9. Environment Flags & Feature Gates

| Flag | Default | Purpose |
|------|---------|---------|
| `DISABLE_LEGACY_STOCK_REQUEST_FULFILL` | false | Blocks legacy fulfill endpoint |
| `DISABLE_LEGACY_STOCK_TRANSFER` | false | Blocks legacy transfer create |
| `ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT` | false | Narrows legacy block scope |
| `MULTI_SOURCE_ALLOCATION_ENABLED` | false | Enables multi-warehouse allocation |
| `FULFILLMENT_RESERVATION_ENABLED` | true (unless "false"/"0") | Enables ledger-based stock reservation |
| `AUTO_PROCUREMENT_DEMAND_DISPATCH` | false | Auto-creates dispatch after GRN |

---

## 10. Cross-Reference: Code vs Existing Docs

### 10.1 Documents that align with code

| Document | Alignment |
|----------|-----------|
| `CURRENT_STOCK_REQUEST_FLOW_BN_GUIDE.md` | HIGH — verified against code, accurate snapshot |
| `MASTER_FLOW_AUDIT_AND_EXECUTION_PLAN.md` | HIGH — positions itself as single source, mostly accurate |
| `SUPPLY_CHAIN_STATE_MACHINE.md` | HIGH — enum reference matches schema |
| `MIGRATION_CHAIN_REPAIR_IMPLEMENTATION_NOTES.md` | HIGH — describes real repair work |
| `MIGRATION_CHAIN_REPAIR_PLAN_MULTI_WAREHOUSE.md` | HIGH — root cause analysis matches findings |

### 10.2 Documents with drift from code

| Document | Issue |
|----------|-------|
| `COMPLETE_STOCK_REQUEST_DELIVERY_FLOW_ANALYSIS_AND_FIX_PLAN.md` | References `READY_TO_FULFILL` status (not in code — `APPROVED` used instead); proposes `BranchReceiveSession` model (code uses `DispatchReceiveSession`); lists queue APIs as missing (they exist now) |
| `COMPLETE_STOCK_REQUEST_DELIVERY_FLOW_IMPLEMENTATION_SUMMARY.md` | Header says "complete" but §10 has items "NOT STARTED"; mixed signals on warehouse UI wiring |
| `MULTI_WAREHOUSE_FULFILLMENT_MASTER_PLAN.md` | Marked as "not yet implemented" — but multi-source allocator IS implemented and gated; schema matches plan targets |

### 10.3 Conflicts between documents

1. **`READY_TO_FULFILL` vs `APPROVED`:** Analysis plan targets new enum value; code and master flow use `APPROVED`
2. **`BranchReceiveSession` vs `DispatchReceiveSession`:** Analysis plan proposes new model; code uses existing `DispatchReceiveSession` + facade
3. **Procurement shortage intent:** FLOW_AUTOMATION says both intents create demand; MASTER_FLOW §2.2 says PROCUREMENT SRs don't → code should be verified
4. **Owner API paths:** Implementation summary mixes `/owner/inventory/allocation` and `/owner/inventory/allocation-plans` — need URL audit
