# Central Warehouse / Delivery Hub Module — Enterprise Design Plan

Complete enterprise-grade Central Warehouse architecture for BPA/WPA, covering procurement, GRN, QC, storage, inventory governance, batch/expiry, allocation, dispatch, delivery, returns, write-off, recall, and audit.

---

## A. CURRENT STATE AUDIT

### A.1 Schema Models (backend-api/prisma/schema.prisma)

| Domain | Model | Status | Lines |
|--------|-------|--------|-------|
| Inventory Location | `InventoryLocation` | ✅ Solid | 6418-6453 |
| Location Config | `LocationVariantConfig` | ✅ Solid | 6455-6472 |
| Stock Balance | `StockBalance` | ✅ Solid | 6492-6505 |
| Stock Ledger | `StockLedger` | ✅ Solid | 6507-6534 |
| Stock Lot | `StockLot` | ✅ Solid | 6708-6744 |
| Stock Lot Balance | `StockLotBalance` | ✅ Solid | 6746-6759 |
| Stock Transfer | `StockTransfer` + Items | ✅ Solid | 6536-6583 |
| Stock Dispatch | `StockDispatch` + Items | ✅ Partial | 6586-6647 |
| Stock Request | `StockRequest` + Items | ✅ Solid | 6649-6706 |
| Stock Return | `StockReturn` + Items | ✅ Solid | 6949-7012 |
| Stock Discrepancy | `StockDiscrepancy` | ✅ Solid | 6761-6788 |
| Stock Adjustment | `StockAdjustmentRequest` | ✅ Solid | 6790-6818 |
| Stock Count | `StockCountSession` + Lines | ✅ Solid | 6820-6862 |
| GRN | `Grn` + `GrnLine` | ✅ Solid | 7192-7254 |
| Batch Recall | `BatchRecall` | ✅ Solid | 11657-11680 |
| Expiry Write-Off | `ExpiryWriteOffLog` | ✅ Solid | 11682-11705 |
| Return Request | `ReturnRequest` + Items | ✅ Solid | 6864-6900 |
| Medicine Requisition | `MedicineRequisition` + Items + Timeline | ✅ Solid | 11554-11651 |
| Vendor | `Vendor` + Contact + Attachment + Ledger | ✅ Solid | 7014-7190 |
| Product/Variant | `Product`, `ProductVariant` | ✅ Solid | 4811-4948 |

### A.2 Enums

| Enum | Values | Notes |
|------|--------|-------|
| `InventoryLocationType` | CLINIC, SHOP, ONLINE_HUB, **CENTRAL_WAREHOUSE**, BRANCH_STORE, CLINIC_STORE, PHARMACY, **DAMAGE_AREA**, **RETURN_AREA** | Warehouse & quarantine types exist but no dedicated Warehouse entity |
| `StockLedgerType` | OPENING, GRN_IN, PURCHASE_IN, PRODUCTION_IN, SALE_POS, SALE_CLINIC, RESERVE/RELEASE_ONLINE, SALE_ONLINE, TRANSFER_OUT/IN, ADJUSTMENT, DAMAGE, EXPIRED, LOSS, RETURN_IN/OUT | Well-designed, extensible |
| `StockTransferStatus` | DRAFT→SENT→IN_TRANSIT→RECEIVED/PARTIAL/PARTIAL_RECEIVED/COMPLETED/DISPUTED/CANCELLED | Good |
| `StockRequestStatus` | DRAFT→SUBMITTED→OWNER_REVIEW→APPROVED/REJECTED→FULFILLED→DISPATCHED→RECEIVED→CLOSED/CANCELLED | Comprehensive |
| `StockDispatchStatus` | CREATED→PACKED→IN_TRANSIT→DELIVERED | **Missing**: CANCELLED, FAILED, PARTIAL_DELIVERED |
| `MemberRole` | OWNER, ORG_ADMIN, BRANCH_MANAGER, BRANCH_STAFF, SELLER, DELIVERY_MANAGER, DELIVERY_STAFF | **No warehouse roles** |
| `RecallSeverity/Status` | STANDARD/URGENT/CRITICAL; ACTIVE/QUARANTINED/RESOLVED/CANCELLED | Good |

### A.3 Backend Modules

| Module Path | Files | Purpose |
|-------------|-------|---------|
| `modules/inventory/` | 14 files | Core inventory: ledger, balance, lots, recalls, expiry, pharmacy dashboard, stock count, direct dispatch |
| `modules/grn/` | 4 files | GRN CRUD + receive (creates lots, writes GRN_IN ledger) |
| `modules/dispatches/` | 6 files | Dispatch management: create, send, receive, status, notifications |
| `modules/stock_requests/` | 4 files | Branch stock requests: create, submit, approve, decline, dispatch |
| `modules/transfers/` | 3 files | Location-to-location transfers with discrepancy handling |
| `modules/returns/` | 3 files | Customer return requests: create, approve, receive |
| `modules/medicine_requisitions/` | 4 files | Pharmacy supply chain: FEFO dispatch, approval workflow |
| `modules/vendors/` | 8 files | Vendor CRUD, contacts, attachments, ledger, payments |

### A.4 Route Registration (routes.ts)

| Mount Point | Module |
|-------------|--------|
| `/inventory` | inventory.routes (includes sub-mounts for stock-requests, dispatches) |
| `/grn` | grn.routes |
| `/transfers` | transfers.routes |
| `/stock-requests` | stock_requests.routes (also mounted under /inventory/stock-requests) |
| `/returns` | returns.routes |
| `/medicine-requisitions` | medicine_requisitions.routes |
| `/vendors` | vendors.routes |
| `/vendor-payments` | vendor_payments.routes |

**Route collision risk**: `/stock-requests` is mounted both at root AND under `/inventory/stock-requests`.

### A.5 Roles & Permissions

**MemberRole enum** (schema): OWNER, ORG_ADMIN, BRANCH_MANAGER, BRANCH_STAFF, SELLER, DELIVERY_MANAGER, DELIVERY_STAFF

**Branch role matrix** (branchRoles.ts) adds: CLINIC_STAFF, CLINIC_RECEPTION, CLINIC_INVENTORY_STAFF, ACCOUNTANT

**DELIVERY_MANAGER perms**: branch.view, dashboard.view, tasks.view, approvals.view, inventory.read, reports.view  
**DELIVERY_STAFF perms**: branch.view, dashboard.view, tasks.view, inventory.read

**Key gap**: No warehouse-specific permissions (warehouse.*, procurement.*, qc.*, dispatch.manage, etc.)

### A.6 Frontend Pages

**Owner Panel** (`app/owner/(larkon)/`):
- `inventory/` — stock overview, warehouse, stock-requests, transfers, receipts, locations, adjustments, batches, stock-counts, expiry-management, recalls
- `pharmacy/` — dashboard, requisitions
- `vendors/` — vendor management

**Staff Panel** (`app/staff/(larkon)/branch/[branchId]/`):
- `inventory/` — overview, receive, adjustments, transfers, incoming, stock-requests
- `pharmacy/` — dashboard, requisitions

**Sidebar configs**:
- `permissionMenu.ts` — Owner: Inventory group (9 items) + Pharmacy group (4 items)
- `branchSidebarConfig.ts` — Staff: Operations group (inventory, receive, adjustments, transfers, POS) + Pharmacy group

### A.7 Key Findings — Gaps & Issues

1. **No Warehouse entity** — `InventoryLocation` type=CENTRAL_WAREHOUSE exists but no dedicated model for warehouse metadata, staff, zones, capacity
2. **No Purchase Order** — GRN links to vendor but no formal PO→GRN flow
3. **No QC/Quarantine** — DAMAGE_AREA location type exists but no inspection model or quarantine workflow
4. **No Putaway/Storage Locations** — No zone/bin/rack/shelf hierarchy within a warehouse
5. **No PickList** — StockDispatch is flat; no pick→pack→ship separation
6. **No Proof of Delivery** — StockDispatch.deliveredAt exists but no signature/photo/POD
7. **No Allocation Plan** — StockRequest approval goes directly to dispatch; no formal allocation step
8. **No warehouse-specific roles** — DELIVERY_MANAGER/STAFF exist but with minimal perms; no WAREHOUSE_MANAGER, INVENTORY_CONTROLLER, etc.
9. **Dual requisition flows** — `StockRequest` (general) and `MedicineRequisition` (pharmacy) are separate but overlapping
10. **StockDispatchStatus missing states** — No CANCELLED, FAILED, PARTIAL states
11. **Duplicate route mounting** — stock-requests mounted at both `/stock-requests` and `/inventory/stock-requests`
12. **Permission bypass** — `requirePermission()` in inventory.routes falls through when no permission match (MVP mode)
13. **No formal warehouse dashboard** — `/owner/inventory/warehouse` page exists but no dedicated warehouse KPIs

---

## B. TARGET ENTERPRISE ARCHITECTURE

### B.1 Bounded Contexts

```
┌─────────────────────────────────────────────────────────────┐
│                    CENTRAL WAREHOUSE HUB                     │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ Procurement  │   Inbound    │  Storage &   │  Outbound      │
│ & Sourcing   │   & QC       │  Inventory   │  & Delivery    │
│              │              │              │                │
│ PurchaseOrder│ GRN          │ Warehouse    │ Requisition    │
│ Vendor Mgmt  │ QcInspection │ Zones/Bins   │ Allocation     │
│ PO Approval  │ Quarantine   │ Putaway      │ PickList       │
│              │ Putaway      │ StockBalance │ Packing        │
│              │              │ StockLot     │ Dispatch       │
│              │              │ BatchRecall  │ Delivery       │
│              │              │ ExpiryMgmt   │ POD            │
├──────────────┴──────────────┴──────────────┴────────────────┤
│              Reverse Logistics & Control                     │
│  Returns │ Write-Off │ Recall │ CycleCount │ Audit          │
└─────────────────────────────────────────────────────────────┘
```

### B.2 Architecture Principles

1. **Extend, don't duplicate** — Build on existing `StockLedger`, `StockBalance`, `StockLot`, `InventoryLocation`
2. **Warehouse as a first-class entity** — New `Warehouse` model wrapping one or more `InventoryLocation`s
3. **Unified requisition** — Consolidate `StockRequest` and `MedicineRequisition` under a common allocation flow
4. **Separation of concerns** — Picking/packing/dispatch are distinct steps, not a single StockDispatch
5. **Immutable ledger** — All stock movements continue through `ledger.service.ts`
6. **Branch isolation** — Warehouse is org-scoped; branches see only their requisitions and incoming deliveries
7. **Approval gates** — Sensitive operations require explicit approval (PO, adjustment, write-off, recall)

---

## C. STAFF / ROLE MODEL

### C.1 Role Definitions

| Role | Scope | Priority | Phase | Description |
|------|-------|----------|-------|-------------|
| **WAREHOUSE_MANAGER** | ORG | Must-have | 1 | Full warehouse operations: inventory, dispatch, staff, reports |
| **RECEIVING_STAFF** | BRANCH (warehouse) | Must-have | 1 | GRN creation, inbound inspection, putaway |
| **DISPATCH_STAFF** | BRANCH (warehouse) | Must-have | 1 | Pick, pack, dispatch operations |
| **INVENTORY_CONTROLLER** | ORG | Recommended | 2 | Cycle counts, adjustments, variance analysis, audit |
| **PROCUREMENT_OFFICER** | ORG | Recommended | 2 | PO creation, vendor management, sourcing |
| **QC_OFFICER** | BRANCH (warehouse) | Scale-up | 3 | QC inspection, quarantine, release decisions |
| **DISPATCH_MANAGER** | ORG | Recommended | 2 | Dispatch approval, delivery assignment, logistics |
| **DELIVERY_MANAGER** | BRANCH | Already exists | 1 | Extended: delivery tracking, POD review, returns |
| **DELIVERY_STAFF** | BRANCH | Already exists | 1 | Extended: delivery execution, POD capture |
| **AUDIT_OFFICER** | ORG | Scale-up | 3 | Read-only audit, variance review, exception reports |

### C.2 Permission Matrix

| Permission Key | WH_MGR | RCV_STAFF | DSP_STAFF | INV_CTRL | PROC_OFF | QC_OFF | DSP_MGR | DEL_MGR | DEL_STAFF | AUDIT |
|---|---|---|---|---|---|---|---|---|---|---|
| warehouse.dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | - | ✅ |
| warehouse.staff.manage | ✅ | - | - | - | - | - | - | - | - | - |
| procurement.po.create | ✅ | - | - | - | ✅ | - | - | - | - | - |
| procurement.po.approve | ✅ | - | - | - | - | - | - | - | - | - |
| inbound.grn.create | ✅ | ✅ | - | - | - | - | - | - | - | - |
| inbound.grn.receive | ✅ | ✅ | - | - | - | - | - | - | - | - |
| inbound.qc.inspect | ✅ | - | - | - | - | ✅ | - | - | - | - |
| inbound.qc.release | ✅ | - | - | - | - | ✅ | - | - | - | - |
| inventory.balance.read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | - | ✅ |
| inventory.lot.read | ✅ | ✅ | ✅ | ✅ | - | ✅ | ✅ | - | - | ✅ |
| inventory.adjustment.request | ✅ | ✅ | - | ✅ | - | - | - | - | - | - |
| inventory.adjustment.approve | ✅ | - | - | ✅ | - | - | - | - | - | - |
| inventory.count.execute | ✅ | ✅ | - | ✅ | - | - | - | - | - | - |
| inventory.count.post | ✅ | - | - | ✅ | - | - | - | - | - | - |
| inventory.recall.create | ✅ | - | - | ✅ | - | ✅ | - | - | - | - |
| inventory.recall.quarantine | ✅ | - | - | - | - | ✅ | - | - | - | - |
| inventory.writeoff.request | ✅ | ✅ | - | ✅ | - | ✅ | - | - | - | - |
| inventory.writeoff.approve | ✅ | - | - | ✅ | - | - | - | - | - | - |
| outbound.requisition.view | ✅ | - | ✅ | ✅ | - | - | ✅ | - | - | ✅ |
| outbound.allocate | ✅ | - | - | - | - | - | ✅ | - | - | - |
| outbound.pick | ✅ | - | ✅ | - | - | - | - | - | - | - |
| outbound.pack | ✅ | - | ✅ | - | - | - | - | - | - | - |
| outbound.dispatch.create | ✅ | - | ✅ | - | - | - | ✅ | - | - | - |
| outbound.dispatch.approve | ✅ | - | - | - | - | - | ✅ | - | - | - |
| delivery.assign | ✅ | - | - | - | - | - | ✅ | ✅ | - | - |
| delivery.execute | - | - | - | - | - | - | - | ✅ | ✅ | - |
| delivery.pod.capture | - | - | - | - | - | - | - | - | ✅ | - |
| delivery.pod.review | ✅ | - | - | - | - | - | ✅ | ✅ | - | ✅ |
| returns.receive | ✅ | ✅ | - | - | - | - | - | - | - | - |
| returns.inspect | ✅ | - | - | ✅ | - | ✅ | - | - | - | - |
| audit.read | ✅ | - | - | ✅ | - | - | - | - | - | ✅ |
| audit.export | ✅ | - | - | - | - | - | - | - | - | ✅ |

---

## D. DATA MODEL / SCHEMA PLAN

### D.1 New Models

#### Warehouse (org-level entity wrapping locations)
```
Warehouse {
  id, orgId, name, code, address, type(CENTRAL|REGIONAL|TRANSIT),
  managerId?, isActive, createdAt, updatedAt
  → Organization, User(manager)
  → WarehouseZone[], WarehouseStaffAssignment[]
}
```
**Purpose**: First-class warehouse entity. Maps 1:N to InventoryLocation.  
**Key relation**: `InventoryLocation.warehouseId` (nullable FK added to existing model).  
**Approval**: Creation requires OWNER/ORG_ADMIN.

#### WarehouseZone (optional sub-locations within warehouse)
```
WarehouseZone {
  id, warehouseId, name, code, type(RECEIVING|STORAGE|PICKING|PACKING|STAGING|DAMAGE|RETURN|QUARANTINE),
  capacity?, isActive, createdAt
  → Warehouse, InventoryLocation[]
}
```
**Purpose**: Logical zones for putaway and picking. Maps to InventoryLocation.  
**Phase**: 2 (Phase 1 uses flat InventoryLocation).

#### WarehouseStaffAssignment
```
WarehouseStaffAssignment {
  id, warehouseId, userId, role(enum), isActive, assignedAt, removedAt?
  → Warehouse, User
}
```
**Purpose**: Track which staff are assigned to which warehouse.  
**Phase**: 1.

#### PurchaseOrder + PurchaseOrderLine
```
PurchaseOrder {
  id, orgId, vendorId, warehouseId?, poNumber, status(DRAFT|SUBMITTED|APPROVED|PARTIALLY_RECEIVED|RECEIVED|CANCELLED),
  expectedDeliveryDate?, totalAmount?, currency?, approvedByUserId?, approvedAt?,
  createdByUserId, note?, createdAt, updatedAt
  → Organization, Vendor, Warehouse?, User(creator), User(approver)
  → PurchaseOrderLine[], Grn[]
}

PurchaseOrderLine {
  id, purchaseOrderId, variantId, orderedQty, receivedQty(default 0),
  unitPrice?, totalPrice?, note?, createdAt
  → PurchaseOrder, ProductVariant
}
```
**Purpose**: Formal procurement flow. PO→GRN link.  
**Key change**: `Grn.purchaseOrderId` (nullable FK added).  
**Phase**: 2.

#### QcInspection (inbound quality control)
```
QcInspection {
  id, grnId, grnLineId?, lotId?, status(PENDING|PASSED|FAILED|PARTIAL),
  inspectedQty, passedQty, failedQty,
  failureReason?, inspectedByUserId, inspectedAt?,
  disposition(ACCEPT|QUARANTINE|REJECT|RETURN_TO_VENDOR),
  quarantineLocationId?, note?, evidenceMediaIds?,
  createdAt, updatedAt
  → Grn, GrnLine?, StockLot?, User, InventoryLocation?(quarantine)
}
```
**Purpose**: QC gate between GRN receive and putaway.  
**Phase**: 3.

#### AllocationPlan (requisition → allocation)
```
AllocationPlan {
  id, orgId, requisitionType(STOCK_REQUEST|MEDICINE_REQUISITION),
  requisitionId, status(DRAFT|CONFIRMED|PICKING|COMPLETED|CANCELLED),
  allocatedByUserId, confirmedAt?, note?, createdAt, updatedAt
  → Organization, User
  → AllocationPlanLine[]
}

AllocationPlanLine {
  id, allocationPlanId, variantId, lotId, locationId,
  allocatedQty, pickedQty(default 0),
  createdAt, updatedAt
  → AllocationPlan, ProductVariant, StockLot, InventoryLocation
}
```
**Purpose**: FEFO-based allocation between approval and picking.  
**Phase**: 2 (Phase 1: direct dispatch as-is).

#### PickList + PickListLine
```
PickList {
  id, allocationPlanId?, dispatchId?, warehouseId,
  status(OPEN|IN_PROGRESS|COMPLETED|CANCELLED),
  assignedToUserId?, startedAt?, completedAt?,
  createdByUserId, createdAt, updatedAt
  → AllocationPlan?, StockDispatch?, Warehouse, User(assignee), User(creator)
  → PickListLine[]
}

PickListLine {
  id, pickListId, variantId, lotId, locationId,
  requestedQty, pickedQty(default 0), note?,
  createdAt, updatedAt
  → PickList, ProductVariant, StockLot, InventoryLocation
}
```
**Purpose**: Picker-assigned work unit.  
**Phase**: 2.

#### DeliveryAssignment + ProofOfDelivery
```
DeliveryAssignment {
  id, dispatchId, assignedToUserId, status(ASSIGNED|EN_ROUTE|ARRIVED|COMPLETED|FAILED),
  assignedByUserId, assignedAt, startedAt?, completedAt?, failureReason?, note?,
  createdAt, updatedAt
  → StockDispatch, User(assignee), User(assigner)
  → ProofOfDelivery?
}

ProofOfDelivery {
  id, deliveryAssignmentId, receivedByName?, signatureMediaId?,
  photoMediaIds?, note?, gpsLat?, gpsLng?, capturedAt, createdAt
  → DeliveryAssignment, Media?
}
```
**Purpose**: Last-mile delivery tracking with evidence capture.  
**Phase**: 1 (basic), 2 (full POD).

### D.2 Existing Models to Extend

| Model | Change | Phase |
|-------|--------|-------|
| `InventoryLocation` | Add `warehouseId?` FK, `zoneId?` FK | 1 |
| `Grn` | Add `purchaseOrderId?` FK | 2 |
| `StockDispatch` | Add `pickListId?` FK, extend status enum (CANCELLED, FAILED) | 2 |
| `StockDispatchStatus` | Add CANCELLED, FAILED, PARTIAL_DELIVERED | 1 |
| `MemberRole` | Add WAREHOUSE_MANAGER, RECEIVING_STAFF, DISPATCH_STAFF | 1 |
| `InventoryLocationType` | Add QUARANTINE, STAGING | 1 |
| `StockLedgerType` | Add QC_REJECT, QUARANTINE_IN, QUARANTINE_OUT | 3 |

### D.3 Models NOT Needed (existing coverage is sufficient)

- **InventoryBatch** → `StockLot` already serves this purpose
- **InventoryBalance** → `StockBalance` + `StockLotBalance` already cover this
- **InventoryMovement** → `StockLedger` is the immutable movement log
- **Shipment** → `StockDispatch` with extended status covers this

---

## E. WORKFLOW DESIGNS

### E.1 Owner Bulk Purchase → Available Stock

```
[Vendor PO]──►[PO Approved]──►[Vendor Ships]──►[GRN Created]──►[GRN Received]
                                                      │
                                                [Lot Created/Found]
                                                      │
                                                [Ledger: GRN_IN]
                                                      │
                                              [StockBalance Updated]
                                                      │
                                              [Available for Allocation]

Phase 2 addition:
[GRN Received]──►[QC Inspection]──►[PASSED]──►[Putaway to Zone]──►[Available]
                                   [FAILED]──►[Quarantine/Return]
```

### E.2 Branch Requisition → Branch Receive

```
[Branch Staff]──►[StockRequest DRAFT]──►[SUBMITTED]──►[Owner APPROVED]
                                                            │
                                                    [AllocationPlan Created]
                                                    (FEFO lot selection)
                                                            │
                                                    [PickList Generated]
                                                            │
                                                    [Picker Picks Items]
                                                            │
                                                    [Packer Packs]
                                                            │
                                                    [StockDispatch Created]
                                                    [Ledger: TRANSFER_OUT]
                                                            │
                                                    [DeliveryAssignment]
                                                            │
                                                    [IN_TRANSIT]
                                                            │
                                                    [Branch Receives]
                                                    [Ledger: TRANSFER_IN]
                                                            │
                                        ┌──────────────────┴──────────────┐
                                   [Full Match]                    [Mismatch]
                                   [COMPLETED]                 [StockDiscrepancy]
                                                               [DISPUTED → Resolve]

Phase 1 simplified: Approve → Direct Dispatch → Receive (no pick/pack)
```

### E.3 Near Expiry / Damaged → Write-Off

```
[Auto-scan or Manual]──►[Identify Expired/Damaged Lots]
                              │
                    [ExpiryWriteOff Request]
                    or [StockAdjustmentRequest]
                              │
                    [PENDING Approval]
                              │
                    [APPROVED by Manager/Controller]
                              │
                    [Ledger: EXPIRED or DAMAGE]
                    [Balance Decremented]
                              │
                    [ExpiryWriteOffLog Created]
```

### E.4 Product Recall

```
[Recall Initiated]──►[BatchRecall ACTIVE]──►[Freeze Lot]
                                                  │
                                    [Block outbound for lot]
                                    (ledger.service checks)
                                                  │
                                    [Quarantine: move to DAMAGE_AREA]
                                    [Ledger: TRANSFER_OUT from source]
                                    [Ledger: QUARANTINE_IN to DAMAGE_AREA]
                                                  │
                                    [BatchRecall QUARANTINED]
                                                  │
                              ┌─────────────────┴─────────────────┐
                         [RESOLVED]                          [CANCELLED]
                    (dispose/destroy)                     (false alarm, unfreeze)
                    [Ledger: DAMAGE]                      [Return to storage]
```

### E.5 Delivery Failure → Return

```
[Delivery Staff]──►[Mark FAILED]──►[Capture reason + evidence]
                                          │
                                [DeliveryAssignment FAILED]
                                          │
                                [Return to Warehouse]
                                [StockReturn CREATED]
                                          │
                                [Warehouse Receives]
                                [Inspect Condition]
                                          │
                        ┌─────────────────┴──────────────┐
                   [RESELLABLE]                    [DAMAGED/EXPIRED]
                   [Ledger: RETURN_IN]             [Ledger: DAMAGE]
                   [Back to available]             [Write-off flow]
```

---

## F. APPROVAL DESIGN

### F.1 Action Classification

| Action | Propose | Verify | Approve | Execute | Audit |
|--------|---------|--------|---------|---------|-------|
| Create PO | PROC_OFFICER | - | WH_MANAGER/OWNER | System (on approve) | AUDIT_OFFICER |
| Receive GRN | RCV_STAFF | QC_OFFICER | WH_MANAGER (high value) | RCV_STAFF | Auto-logged |
| Stock Adjustment | Any warehouse staff | - | WH_MANAGER/INV_CONTROLLER | System (on approve) | Auto-logged |
| Write-Off | RCV_STAFF/INV_CONTROLLER | QC_OFFICER | WH_MANAGER/OWNER | System (on approve) | Auto-logged |
| Dispatch | DSP_STAFF | - | DSP_MANAGER/WH_MANAGER | DSP_STAFF | Auto-logged |
| Recall | WH_MANAGER/QC_OFFICER | - | OWNER | System (on approve) | AUDIT_OFFICER |
| Cycle Count Post | INV_CONTROLLER | - | WH_MANAGER | System (on approve) | Auto-logged |

### F.2 Sensitive Action Thresholds

- **PO above threshold** → Requires OWNER approval
- **Adjustment > X units** → Requires dual approval
- **Write-off > value threshold** → Escalates to OWNER
- **Recall CRITICAL severity** → Auto-notify OWNER + all branch managers

---

## G. API DESIGN

### G.1 New Route Groups

All under `/api/v1/warehouse/` prefix:

```
# Warehouse Management
POST   /warehouse                         # Create warehouse
GET    /warehouse                         # List warehouses (org-scoped)
GET    /warehouse/:id                     # Get warehouse detail
PATCH  /warehouse/:id                     # Update warehouse
GET    /warehouse/:id/dashboard           # Warehouse KPIs

# Warehouse Staff
POST   /warehouse/:id/staff              # Assign staff
GET    /warehouse/:id/staff              # List staff
DELETE /warehouse/:id/staff/:assignmentId # Remove staff

# Purchase Orders (Phase 2)
POST   /warehouse/purchase-orders         # Create PO
GET    /warehouse/purchase-orders         # List POs
GET    /warehouse/purchase-orders/:id     # Get PO
PATCH  /warehouse/purchase-orders/:id     # Update draft PO
POST   /warehouse/purchase-orders/:id/submit   # Submit for approval
POST   /warehouse/purchase-orders/:id/approve  # Approve PO
POST   /warehouse/purchase-orders/:id/cancel   # Cancel PO

# Inbound (extends existing GRN)
# Existing /grn routes remain; add:
POST   /warehouse/inbound/grn-from-po/:poId    # Create GRN from PO

# QC Inspection (Phase 3)
POST   /warehouse/qc/inspections         # Create inspection
GET    /warehouse/qc/inspections         # List inspections
POST   /warehouse/qc/inspections/:id/release    # Release to available
POST   /warehouse/qc/inspections/:id/quarantine # Send to quarantine

# Allocation (Phase 2)
POST   /warehouse/allocations            # Create allocation plan
GET    /warehouse/allocations            # List allocations
POST   /warehouse/allocations/:id/confirm # Confirm allocation
POST   /warehouse/allocations/:id/cancel  # Cancel allocation

# Pick Lists (Phase 2)
POST   /warehouse/pick-lists             # Generate from allocation
GET    /warehouse/pick-lists             # List pick lists
GET    /warehouse/pick-lists/:id         # Get pick list detail
POST   /warehouse/pick-lists/:id/start   # Start picking
PATCH  /warehouse/pick-lists/:id/lines   # Update picked quantities
POST   /warehouse/pick-lists/:id/complete # Complete picking

# Dispatch (extends existing /inventory/dispatches)
# Existing dispatch routes remain; add:
POST   /warehouse/dispatches/:id/assign-delivery  # Assign delivery staff

# Delivery
GET    /warehouse/delivery/assignments    # My delivery assignments
POST   /warehouse/delivery/:id/start      # Start delivery
POST   /warehouse/delivery/:id/arrive     # Mark arrived
POST   /warehouse/delivery/:id/complete   # Complete with POD
POST   /warehouse/delivery/:id/fail       # Mark failed

# Returns (extends existing)
GET    /warehouse/returns/incoming        # Returns heading to warehouse
POST   /warehouse/returns/:id/inspect     # Inspect returned items

# Reports
GET    /warehouse/reports/inventory-summary    # Stock by zone/location
GET    /warehouse/reports/movement-history     # Ledger filtered
GET    /warehouse/reports/expiry-forecast      # Near-expiry projections
GET    /warehouse/reports/dispatch-performance  # Dispatch SLAs
GET    /warehouse/reports/delivery-performance  # Delivery completion rates
```

### G.2 Module Structure

```
src/api/v1/modules/warehouse/
  warehouse.routes.ts
  warehouse.controller.ts
  warehouse.service.ts
  warehouseStaff.controller.ts
  warehouseStaff.service.ts
  purchaseOrder.controller.ts      # Phase 2
  purchaseOrder.service.ts         # Phase 2
  allocation.controller.ts         # Phase 2
  allocation.service.ts            # Phase 2
  pickList.controller.ts           # Phase 2
  pickList.service.ts              # Phase 2
  delivery.controller.ts
  delivery.service.ts
  qcInspection.controller.ts       # Phase 3
  qcInspection.service.ts          # Phase 3
  warehouseReports.controller.ts
  warehouseReports.service.ts
```

### G.3 Naming Conventions & Collision Avoidance

- All new warehouse routes under `/warehouse/*` prefix — no collision with existing `/inventory/*`, `/grn/*`, `/dispatches/*`
- Existing modules remain unchanged; warehouse module composes them via service-level imports
- `ledger.service.ts` remains the single source of truth for all stock movements

---

## H. FRONTEND / PANEL PLAN

### H.1 Page Structure

**Owner Panel** — Warehouse section (`app/owner/(larkon)/warehouse/`):

| Page | Path | Description |
|------|------|-------------|
| Warehouse List | `/owner/warehouse` | All warehouses in org |
| Warehouse Detail | `/owner/warehouse/[id]` | Dashboard, staff, zones |
| Warehouse Staff | `/owner/warehouse/[id]/staff` | Staff assignments |
| Inbound Queue | `/owner/warehouse/[id]/inbound` | GRNs pending/received |
| Requisition Queue | `/owner/warehouse/[id]/requisitions` | Pending branch requests |
| Dispatch Board | `/owner/warehouse/[id]/dispatches` | Active dispatches |
| Delivery Tracking | `/owner/warehouse/[id]/delivery` | Delivery status map |
| Returns | `/owner/warehouse/[id]/returns` | Incoming returns |
| Inventory Overview | `/owner/warehouse/[id]/stock` | Stock by location |
| Batch / Expiry | `/owner/warehouse/[id]/batches` | Lot expiry management |
| Recalls | `/owner/warehouse/[id]/recalls` | Active recalls |
| Reports | `/owner/warehouse/[id]/reports` | Warehouse analytics |

**Staff Panel** — Warehouse staff pages (`app/staff/(larkon)/warehouse/[warehouseId]/`):

| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/staff/warehouse/[id]` | My tasks, KPIs |
| Receive | `/staff/warehouse/[id]/receive` | GRN creation/receive |
| Pick Lists | `/staff/warehouse/[id]/pick-lists` | My pick assignments |
| Pack & Dispatch | `/staff/warehouse/[id]/dispatch` | Packing station |
| My Deliveries | `/staff/warehouse/[id]/delivery` | Delivery staff view |
| Stock View | `/staff/warehouse/[id]/stock` | Warehouse stock |
| Adjustments | `/staff/warehouse/[id]/adjustments` | Request adjustments |

### H.2 Sidebar Updates

**Owner sidebar** (`permissionMenu.ts`): Add "Warehouse" group:
```
Warehouse
  ├─ Warehouses        /owner/warehouse
  ├─ Inbound           /owner/warehouse/inbound
  ├─ Dispatch Board    /owner/warehouse/dispatches
  ├─ Delivery Tracking /owner/warehouse/delivery
  └─ Reports           /owner/warehouse/reports
```

**Staff sidebar** (`branchSidebarConfig.ts`): Add warehouse context (only shown when user has warehouse assignment):
```
Warehouse
  ├─ Dashboard          /staff/warehouse/[id]
  ├─ Receive Stock      /staff/warehouse/[id]/receive
  ├─ Pick Lists         /staff/warehouse/[id]/pick-lists
  ├─ Dispatch           /staff/warehouse/[id]/dispatch
  ├─ My Deliveries      /staff/warehouse/[id]/delivery
  └─ Stock              /staff/warehouse/[id]/stock
```

---

## I. IMPLEMENTATION ROADMAP

### Phase 1: Foundation (4-6 weeks)

**Goal**: Warehouse entity, staff assignment, enhanced dispatch/delivery, basic dashboard.

**Backend**:
- [ ] Add `Warehouse`, `WarehouseStaffAssignment` models to schema
- [ ] Add `warehouseId?` to `InventoryLocation`
- [ ] Add WAREHOUSE_MANAGER, RECEIVING_STAFF, DISPATCH_STAFF to `MemberRole` enum
- [ ] Add CANCELLED, FAILED to `StockDispatchStatus`
- [ ] Add QUARANTINE, STAGING to `InventoryLocationType`
- [ ] Add warehouse.*, inbound.*, outbound.*, delivery.* permission keys
- [ ] Create `warehouse/` module: CRUD, staff, dashboard
- [ ] Create `delivery/` sub-module: DeliveryAssignment, basic POD
- [ ] Extend `branchRoles.ts` with warehouse role permissions
- [ ] Update `seedRolesPermissions.ts`
- [ ] Migration: add columns, create tables

**Frontend**:
- [ ] Owner: Warehouse list + create page
- [ ] Owner: Warehouse detail dashboard
- [ ] Owner: Warehouse staff management
- [ ] Owner: Dispatch board (enhanced)
- [ ] Owner: Delivery tracking page
- [ ] Staff: Warehouse dashboard
- [ ] Staff: Receive stock (existing GRN flow, scoped to warehouse)
- [ ] Sidebar: Add Warehouse group to owner + staff menus

**Migration**: Additive only — no breaking changes.  
**Seed**: Default warehouse from existing CENTRAL_WAREHOUSE locations.  
**QA**: Warehouse CRUD, staff assign, dispatch with delivery assignment, branch receive.

### Phase 2: Control & Quality (4-6 weeks)

**Goal**: PO flow, allocation engine, pick/pack separation, full POD.

**Backend**:
- [ ] Add `PurchaseOrder`, `PurchaseOrderLine` models
- [ ] Add `purchaseOrderId?` to `Grn`
- [ ] Add `AllocationPlan`, `AllocationPlanLine` models
- [ ] Add `PickList`, `PickListLine` models
- [ ] Add `ProofOfDelivery` model (full: signature, photo, GPS)
- [ ] PO module: CRUD, submit, approve, cancel
- [ ] Allocation service: FEFO-based lot selection
- [ ] Pick list service: generate from allocation, assign, track
- [ ] Enhanced delivery: full POD capture
- [ ] Warehouse reports module

**Frontend**:
- [ ] Owner: Purchase Orders (list, create, detail, approve)
- [ ] Owner: Allocation Board
- [ ] Staff: Pick list view + mobile-friendly picking UI
- [ ] Staff: Packing station UI
- [ ] Staff: Delivery POD capture (photo + signature)
- [ ] Owner: Warehouse reports (inventory, dispatch, delivery)

**Migration**: New tables only.  
**QA**: End-to-end PO→GRN→Allocate→Pick→Pack→Dispatch→Deliver→POD.

### Phase 3: Enterprise Advanced (4-6 weeks)

**Goal**: QC/quarantine, zones/bins, audit officer, advanced analytics.

**Backend**:
- [ ] Add `WarehouseZone` model
- [ ] Add `QcInspection` model
- [ ] Add QC_REJECT, QUARANTINE_IN, QUARANTINE_OUT to `StockLedgerType`
- [ ] Add QC_OFFICER, INVENTORY_CONTROLLER, AUDIT_OFFICER roles
- [ ] QC module: inspect, release, quarantine
- [ ] Zone-based putaway logic
- [ ] Advanced recall workflow with multi-location freeze
- [ ] Audit trail export
- [ ] Threshold-based approval escalation

**Frontend**:
- [ ] Owner: QC Center (inspection queue, quarantine view)
- [ ] Owner: Zone management within warehouse
- [ ] Owner: Audit trail viewer + export
- [ ] Owner: Advanced analytics dashboards
- [ ] Staff: QC inspection form

**Migration**: New tables + enum extensions.  
**QA**: Full QC workflow, zone-based operations, audit export.

---

## J. ASSUMPTIONS & OPEN QUESTIONS

### Assumptions Made

1. **Single-org warehouses**: A warehouse belongs to exactly one organization (multi-org warehouses are out of scope).
2. **Warehouse = enhanced branch**: Warehouse wraps a branch of type DELIVERY_HUB or similar, but is a first-class entity for better UX.
3. **Ledger is sacred**: All stock movements continue through `ledger.service.ts` — no bypass.
4. **Backward compatible**: Existing StockRequest, StockDispatch, GRN flows continue to work. Warehouse module is additive.
5. **MedicineRequisition stays separate**: Pharmacy has domain-specific needs (substitution, urgency). It composes with the allocation engine but isn't merged into StockRequest.
6. **Phase 1 does not require pick/pack**: Direct dispatch (current flow) is sufficient for Phase 1. Pick/pack is Phase 2.
7. **POD is optional in Phase 1**: Basic delivery assignment with status tracking. Full POD (signature, photo) in Phase 2.
8. **No external WMS integration**: This is a built-in WMS, not an integration with SAP/Oracle.
9. **Roles are additive to MemberRole enum**: New roles extend the existing enum. No role refactoring.

### Open Questions

1. Should warehouse staff have a separate login/panel, or reuse the existing staff branch dashboard?
2. Should PO approval thresholds be configurable per org, or hardcoded?
3. Should allocation auto-run on requisition approval, or be manually triggered?
4. Is there a need for wave-based picking (batch multiple orders into one pick run)?
5. Should delivery tracking include real-time GPS, or just checkpoint-based?

---

## K. NEXT IMPLEMENTATION STEPS (after plan approval)

1. **Create Prisma schema additions**: `Warehouse`, `WarehouseStaffAssignment`, `DeliveryAssignment` models + enum extensions
2. **Generate migration**: `prisma migrate dev --name add_warehouse_module`
3. **Create backend module**: `src/api/v1/modules/warehouse/` with routes, controller, service
4. **Update role/permission system**: Add warehouse roles to `MemberRole`, `branchRoles.ts`, `seedRolesPermissions.ts`
5. **Register routes**: Add `/warehouse` to `routes.ts`
6. **Create owner frontend pages**: Warehouse list, detail, staff management
7. **Create staff frontend pages**: Warehouse dashboard, receive
8. **Update sidebar configs**: `permissionMenu.ts` + `branchSidebarConfig.ts`
9. **Seed data**: Create default warehouse from existing CENTRAL_WAREHOUSE locations
10. **Test**: End-to-end warehouse creation, staff assignment, enhanced dispatch
