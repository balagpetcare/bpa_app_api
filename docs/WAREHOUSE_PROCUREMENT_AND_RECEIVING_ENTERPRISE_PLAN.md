# WAREHOUSE PROCUREMENT AND RECEIVING — ENTERPRISE PLAN

**Created:** 2026-04-03
**Status:** Implementation Phase
**Scope:** Separate warehouse procurement from branch transfer, complete inbound receiving architecture
**Related docs:**
- `PO_TO_GRN_QC_BATCH_PUTAWAY_DISTRIBUTION_ENTERPRISE_PLAN.md` (PO→GRN flow — implemented)
- `WAREHOUSE_PO_RECEIVE_QUEUE_FIX_PLAN.md` (PO visibility in receive center — implemented)
- `enterprise-stock-request-fulfillment-redesign-plan.md` (multi-wave dispatch — implemented)
- `BRANCH_TYPE_WAREHOUSE_CONVERGENCE_IMPLEMENTATION_REPORT.md` (branch=warehouse convergence — implemented)

---

## 1. CURRENT-STATE DIAGNOSIS

### 1.1 Branch Stock Request Flow (WORKING — MUST NOT BREAK)

```
Branch Staff → Create StockRequest (branchId, items)
           → Submit → Owner Review
           → Owner Approve (optional partial qty, extra items)
           → Owner Fulfill (pick from warehouse location, FEFO/manual lots)
           → Create StockDispatch (fromLocationId → toLocationId)
           → Send → TRANSFER_OUT ledger, status IN_TRANSIT
           → Branch Receive → TRANSFER_IN ledger, GRN created
           → StockRequest status → RECEIVED / PARTIALLY_RECEIVED
```

**Key models:** `StockRequest` → `StockDispatch` → `StockDispatchItem` → `Grn` (via `stockDispatchId`)
**Alternative path:** `StockRequest` → `StockTransfer` → `StockTransferItem` (legacy multi-wave)
**Status:** Fully operational, tested, battle-proven.

### 1.2 Warehouse Stock Request Flow (BROKEN / MIXED)

Currently, when a warehouse-type branch (WAREHOUSE_DC) creates a `StockRequest`:
- It uses the **same** `StockRequest` model as a normal branch
- The `branchId` points to the warehouse branch
- Owner approval funnels it into the **same** dispatch/transfer flow
- But a warehouse requesting stock from *itself* for vendor procurement makes no business sense
- There is no linkage from warehouse demand → purchase order creation
- The owner panel shows warehouse requests mixed with branch requests in the same queue

**Problem:** Warehouse demand for external vendor stock is conflated with branch demand for internal warehouse stock. There is no `requestIntent` or `fulfillmentMode` distinction.

### 1.3 Purchase Order → Receiving Flow (PARTIALLY WORKING)

```
Owner/Procurement → Create PO (vendorId, warehouseId, lines)
                  → Submit → Approve
                  → GRN created (draft, linked to PO)
                  → Receive GRN → GRN_IN ledger, PO line receivedQty updated
                  → PO status → PARTIALLY_RECEIVED / RECEIVED
```

**What works:**
- PO CRUD, submit, approve, reject, cancel
- GRN creation linked to PO (`purchaseOrderId`)
- GRN receive with lot/batch/expiry/cost/barcode
- PO line `receivedQty` auto-update via `applyGrnReceiveToPurchaseOrder`
- Pending PO queue visible in staff receive center (`pending-po-receipts`)
- Bulk receive UI supports PO mode with ordered/received/pending columns

**What's missing:**
- No automatic linkage from warehouse stock request → PO creation
- Warehouse inbound receive queue doesn't clearly separate vendor GRN from dispatch receive
- No explicit `requestIntent` to distinguish procurement demand from transfer demand
- GRN line-level comments/remarks not exposed in all UI paths
- Problem receive (reject/damaged qty with reasons) partially exists in GrnLine but not fully surfaced

### 1.4 Existing Data Models (Reusable)

| Model | Status | Notes |
|-------|--------|-------|
| `StockRequest` + `StockRequestItem` | Reuse | Add `requestIntent` field |
| `StockDispatch` + `StockDispatchItem` | Keep unchanged | Branch transfer only |
| `PurchaseOrder` + `PurchaseOrderLine` | Reuse | Already has `warehouseId`, `purchaseRequisitionId` |
| `PurchaseRequisition` | Exists | Wave-2 link from internal demand to PO |
| `Grn` + `GrnLine` | Reuse | Already supports vendor (`vendorId`) and transfer (`stockDispatchId`) |
| `StockLot` + `StockLotBalance` | Reuse | Batch/lot/expiry at receive |
| `StockLedger` + `StockBalance` | Reuse | Canonical stock truth |
| `InboundShipment` + `InboundShipmentLine` | Reuse | ASN/shipment tracking |
| `Warehouse` + `InventoryLocation` | Reuse | Branch-backed warehouse convergence done |

### 1.5 Receiving UI Inventory

| Surface | Type | Fields | Status |
|---------|------|--------|--------|
| BulkReceivePage (owner + staff embed) | Vendor GRN | qty, unitCost, lotCode, mfgDate, expDate, supplierBarcode | Complete |
| SelectedReceiveGrid | Vendor GRN grid | Same + PO ordered/received/pending | Complete |
| DispatchReceiveDrawer | Transfer receive | received, damaged, short, notes | Complete |
| TransferReceiveDrawer | Transfer receive | received, damaged, expired | Complete |
| receive-dispatch page | Transfer receive | Summary + full receive + discrepancy | Complete |
| Staff receive center | Hub | Tabs: PO pending, incoming dispatches/transfers, opening | Complete |

---

## 2. TARGET-STATE ARCHITECTURE

### 2.1 Flow Separation

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEMAND ORIGINATION                            │
├──────────────────────────┬──────────────────────────────────────┤
│  BRANCH REQUEST          │  WAREHOUSE REQUEST                   │
│  intent: INTERNAL_TRANSFER│  intent: PROCUREMENT                │
│  Branch staff creates    │  Warehouse staff creates             │
│  StockRequest            │  StockRequest                        │
│  → Owner approves        │  → Owner reviews                     │
│  → Warehouse fulfills    │  → Creates/links PO                  │
│  → Dispatch/transfer     │  → Vendor ships                      │
│  → Branch receives       │  → Warehouse receives via GRN        │
└──────────────────────────┴──────────────────────────────────────┘
```

### 2.2 Internal Fulfillment Flow (Branch → Warehouse Transfer)

**No changes needed.** Existing flow remains:
1. Branch staff creates StockRequest with `requestIntent = INTERNAL_TRANSFER` (default for non-warehouse branches)
2. Owner approves, fulfills from warehouse location
3. Dispatch → Send → Branch receives
4. GRN created with `stockDispatchId`

### 2.3 Procurement Replenishment Flow (Warehouse → Vendor Purchase)

New orchestration:
1. Warehouse staff creates StockRequest with `requestIntent = PROCUREMENT`
2. Auto-set by system when requester branch is warehouse-type
3. Owner reviews in **separate** "Procurement Requests" section
4. Owner can:
   - Approve → creates `PurchaseRequisition` → links to new/existing PO
   - Approve → directly creates PO draft with request items
   - Decline with reason
5. PO follows normal lifecycle: submit → approve → vendor ships
6. Warehouse receives via GRN against PO
7. StockRequest status updates based on PO receiving progress

### 2.4 Receiving Split

| Receiving Type | Who | Source | GRN Fields |
|----------------|-----|--------|------------|
| **Vendor Inbound** | Warehouse staff | PO/vendor shipment | vendorId, purchaseOrderId, invoiceNo, invoiceDate, batch, lot, expiry, cost, barcode, remarks, damaged, short |
| **Transfer Receive** | Branch staff | StockDispatch from warehouse | stockDispatchId, received/damaged/short per line |
| **Opening Stock** | Any staff | Manual entry | locationId, variant, quantity |

### 2.5 Business Rules

1. **Branch requester** MUST NOT create vendor procurement directly — their requests auto-route to `INTERNAL_TRANSFER`
2. **Warehouse requester** requests auto-route to `PROCUREMENT` — not dispatched through normal branch flow
3. Approved PO in status `APPROVED` or `PARTIALLY_RECEIVED` appears in warehouse inbound queue
4. Fully received PO (`RECEIVED`) disappears from pending inbound queue
5. Partial receive keeps pending balance visible
6. Branch transfer flows remain 100% unchanged
7. Inventory posts ONLY on actual receive confirmation (GRN receive or dispatch receive)
8. Owner panel MUST separate internal requests from procurement requests

---

## 3. SCHEMA CHANGES

### 3.1 New Enum: `StockRequestIntent`

```prisma
enum StockRequestIntent {
  INTERNAL_TRANSFER    // Branch wants stock from warehouse (existing flow)
  PROCUREMENT          // Warehouse wants stock from vendor (new flow)
}
```

### 3.2 StockRequest Model Additions

```prisma
model StockRequest {
  // ... existing fields ...

  // NEW: Intent-based routing
  requestIntent        StockRequestIntent @default(INTERNAL_TRANSFER)

  // NEW: Link to PO when procurement intent is fulfilled via PO
  linkedPurchaseOrderId Int?
  linkedPurchaseOrder   PurchaseOrder? @relation(fields: [linkedPurchaseOrderId], references: [id], onDelete: SetNull)

  // NEW: Procurement metadata
  procurementNote      String?  @db.Text   // Why this stock is needed
  preferredVendorId    Int?                 // Suggestion, not binding
  urgency              String?  @db.VarChar(20) // NORMAL, URGENT, CRITICAL
}
```

### 3.3 PurchaseOrder Model Addition

```prisma
model PurchaseOrder {
  // ... existing fields ...

  // NEW: Back-link to demand source
  stockRequests  StockRequest[]  // Requests that led to this PO
}
```

### 3.4 GrnLine Enhancement (already exists but ensure fields are used)

Existing fields already sufficient:
- `quantity` (good qty)
- `quantityDamaged`
- `quantityShort`
- `unitCost`
- `lotCode`, `mfgDate`, `expDate`
- `supplierBarcode`, `receiveBarcode`
- `lineDiscrepancyNote`
- `lineRemarks`

**No GrnLine schema changes needed.**

---

## 4. IMPLEMENTATION PHASES

### Phase 1: Schema + Backend Routing (LOW RISK)

**Migration:** `YYYYMMDDHHMMSS_stock_request_procurement_intent`

Add to `StockRequest`:
- `requestIntent StockRequestIntent @default(INTERNAL_TRANSFER)`
- `linkedPurchaseOrderId Int?` (FK to PurchaseOrder)
- `procurementNote String? @db.Text`
- `preferredVendorId Int?`
- `urgency String? @db.VarChar(20)`

Add enum `StockRequestIntent { INTERNAL_TRANSFER, PROCUREMENT }`

Add relation on `PurchaseOrder`: `stockRequests StockRequest[]`

**Backend changes:**

| File | Change |
|------|--------|
| `stock_requests.service.ts` | Auto-set `requestIntent` based on branch type at creation |
| `stock_requests.controller.ts` | Accept `requestIntent` in create body; add `intent` filter to list |
| `stock_requests.routes.ts` | Add filter param `?intent=PROCUREMENT\|INTERNAL_TRANSFER` |
| `purchaseOrder.service.ts` | Add `createFromStockRequest()` — create PO from approved procurement request |
| `purchaseOrder.controller.ts` | Add `POST /purchase-orders/from-request/:requestId` endpoint |
| `grn.service.ts` | On GRN receive, update linked `StockRequest` status if `linkedPurchaseOrderId` matches |

### Phase 2: Frontend — Owner Panel Separation (LOW RISK)

| File | Change |
|------|--------|
| `owner/.../stock-requests/page.tsx` | Add tab/filter for `INTERNAL_TRANSFER` vs `PROCUREMENT` |
| `owner/.../stock-requests/[id]/page.tsx` | Show different action buttons based on intent (Fulfill vs Create PO) |
| New: owner PO creation from request | "Create PO from Request" button → pre-fill PO form from request items |

### Phase 3: Warehouse Inbound Queue Enhancement (LOW RISK)

| File | Change |
|------|--------|
| `staff/.../inventory/receive/page.jsx` | Enhanced pending PO section with receive progress bars |
| `staff/.../warehouse/receive-po/page.tsx` | Add line-level comments, remarks, discrepancy notes to UI |
| `BulkReceivePage.tsx` | Add `lineRemarks`, `lineDiscrepancyNote` columns; problem qty entry |
| `SelectedReceiveGrid.tsx` | Add remarks/notes columns per grid row |

### Phase 4: Status Synchronization (MEDIUM RISK)

When a PO linked to a StockRequest is received:
- Partial GRN receive → StockRequest status `FULFILLED_PARTIAL`
- Full GRN receive (all PO lines fully received) → StockRequest status `FULFILLED_FULL`
- Track via `applyGrnReceiveToPurchaseOrder` → also update StockRequest

### Phase 5: Hardening

- RBAC: warehouse staff cannot approve their own procurement requests
- Audit: log intent changes, PO linkage events
- Timeline: status history on StockRequest detail
- Empty states: "No procurement requests" vs "No internal requests"
- Sidebar: separate "Procurement Requests" menu item for owner

---

## 5. FILES CHANGED

### Backend (D:\BPA_Data\backend-api)

| File | Action | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | MODIFY | Add `StockRequestIntent` enum, add fields to `StockRequest`, add relation to `PurchaseOrder` |
| `prisma/migrations/YYYYMMDD_stock_request_procurement_intent/migration.sql` | CREATE | Migration SQL |
| `src/api/v1/modules/stock_requests/stock_requests.service.ts` | MODIFY | Auto-detect intent from branch type, filter by intent |
| `src/api/v1/modules/stock_requests/stock_requests.controller.ts` | MODIFY | Accept intent param, filter list |
| `src/api/v1/modules/stock_requests/stock_requests.routes.ts` | MODIFY | Route for procurement filter |
| `src/api/v1/modules/purchase_orders/purchaseOrder.service.ts` | MODIFY | Add `createFromStockRequest()` |
| `src/api/v1/modules/purchase_orders/purchaseOrder.controller.ts` | MODIFY | Add `createFromRequest` handler |
| `src/api/v1/modules/purchase_orders/purchaseOrder.routes.ts` | MODIFY | Add `POST /from-request/:requestId` |
| `src/api/v1/modules/grn/grn.service.ts` | MODIFY | Update linked StockRequest on GRN receive |
| `prisma/seeders/seedRolesPermissions.ts` | MODIFY | Add `procurement.request.view`, `procurement.request.manage` permissions |

### Frontend (D:\BPA_Data\bpa_web)

| File | Action | Description |
|------|--------|-------------|
| `app/owner/(larkon)/inventory/stock-requests/page.tsx` | MODIFY | Add intent tabs/filter |
| `app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` | MODIFY | Procurement-specific actions |
| `app/owner/(larkon)/inventory/receipts/bulk/BulkReceivePage.tsx` | MODIFY | Add line remarks/notes columns |
| `app/owner/(larkon)/inventory/receipts/bulk/SelectedReceiveGrid.tsx` | MODIFY | Add remarks/discrepancy columns |
| `app/owner/(larkon)/inventory/receipts/bulk/types.ts` | MODIFY | Add remarks/notes to grid types |
| `app/staff/(larkon)/branch/[branchId]/inventory/receive/page.jsx` | MODIFY | Enhanced PO pending section |
| `app/staff/(larkon)/branch/[branchId]/inventory/_components/StaffStockRequestDetailClient.jsx` | MODIFY | Show intent badge, procurement fields |
| `lib/api.ts` | MODIFY | Add `intent` filter to stock request list, add `createPOFromRequest` API |

---

## 6. MIGRATION / COMPATIBILITY NOTES

1. **Default value `INTERNAL_TRANSFER`** ensures all existing StockRequests continue to work unchanged
2. **No existing column removed** — additive only
3. **PurchaseOrder.stockRequests** is a new relation (back-link) — no FK on PO table, FK is on StockRequest
4. **No data migration needed** — existing requests default to INTERNAL_TRANSFER
5. **Frontend filters** default to showing all intents when no filter is applied — backward compatible
6. **Prisma migration policy:** New migration file, review SQL, `migrate deploy`, integrity check

---

## 7. RISKS

| Risk | Severity | Mitigation |
|------|----------|------------|
| Branch flow regression | HIGH | Default intent = INTERNAL_TRANSFER; no changes to dispatch/transfer code |
| Mixed queue confusion | MEDIUM | UI tabs + backend filters enforce separation |
| PO-StockRequest sync drift | MEDIUM | GRN receive handler updates both PO and StockRequest atomically in transaction |
| Warehouse staff creates INTERNAL_TRANSFER | LOW | Auto-detect intent from branch type; override requires explicit param |
| Schema migration on production-like DB | LOW | Additive columns with defaults; no data loss possible |

---

## 8. QA CHECKLIST

- [ ] **QA-1:** Branch request still works end-to-end (create → submit → approve → fulfill → dispatch → receive)
- [ ] **QA-2:** Warehouse request creates procurement-style flow, not branch dispatch flow
- [ ] **QA-3:** Owner panel separates internal requests from procurement requests (tabs/filters)
- [ ] **QA-4:** PO approval causes warehouse inbound queue visibility
- [ ] **QA-5:** Warehouse can receive full PO (all lines received → PO status RECEIVED)
- [ ] **QA-6:** Warehouse can receive partial PO (some lines → PO status PARTIALLY_RECEIVED)
- [ ] **QA-7:** Warehouse can receive with issue markers (damaged/short qty with notes)
- [ ] **QA-8:** Batch/expiry/cost/lot/comment data is saved on GRN lines
- [ ] **QA-9:** Warehouse stock updates after receive (StockBalance, StockLedger)
- [ ] **QA-10:** Branch transfer flow remains unaffected (dispatch receive works as before)
- [ ] **QA-11:** Procurement request auto-links to PO when created from request
- [ ] **QA-12:** RBAC: warehouse staff can create procurement requests, cannot self-approve
- [ ] **QA-13:** Receiving page shows line-level remarks and discrepancy notes
- [ ] **QA-14:** No mixed queue confusion — internal and procurement clearly separated in UI

---

## 9. IMPLEMENTATION LOG

| Date | Phase | Action | Files | Status |
|------|-------|--------|-------|--------|
| 2026-04-03 | Plan | Created enterprise plan | This file | DONE |
| 2026-04-03 | Phase 1 | Schema: `StockRequestIntent` enum, new fields on `StockRequest`, relation to PO/Vendor | `schema.prisma`, migration `20260403163736_stock_request_procurement_intent` | DONE |
| 2026-04-03 | Phase 1 | Backend: Auto-detect intent from branch type, intent filter on list, procurement creation fields | `stock_requests.service.ts`, `stock_requests.controller.ts` | DONE |
| 2026-04-03 | Phase 1 | Backend: `createPurchaseOrderFromStockRequest` endpoint | `purchaseOrder.service.ts`, `purchaseOrder.controller.ts`, `purchaseOrder.routes.ts` | DONE |
| 2026-04-03 | Phase 1 | Backend: GRN receive → sync linked StockRequest status from PO | `grn.service.ts` | DONE |
| 2026-04-03 | Phase 2 | Frontend: Owner stock request list — intent tabs (All/Branch Transfer/Procurement) | `owner/.../stock-requests/page.tsx` | DONE |
| 2026-04-03 | Phase 2 | Frontend: Owner detail — procurement info card, intent badge, "Create PO" button, linked PO badge | `owner/.../stock-requests/[id]/page.tsx` | DONE |
| 2026-04-03 | Phase 2 | Frontend: Receive grid — damaged, short, remarks, discrepancy note columns | `SelectedReceiveGrid.tsx`, `types.ts`, `BulkReceivePage.tsx` | DONE |
| 2026-04-03 | Phase 2 | Frontend: Staff receive center — PO progress bars | `staff/.../receive/page.jsx` | DONE |
| 2026-04-03 | Phase 2 | Frontend: Staff detail — intent badge, procurement note, linked PO | `StaffStockRequestDetailClient.jsx` | DONE |
| 2026-04-03 | Phase 3 | Frontend: Sidebar — stock requests in Operations, procurement requests in Warehouse | `branchSidebarConfig.ts` | DONE |
| 2026-04-03 | Phase 3 | Backend: RBAC — `procurement.request.view/manage` permissions, warehouse role updates | `seedRolesPermissions.ts`, `branchRoles.ts` | DONE |
| 2026-04-03 | Phase 3 | Frontend: API helper — `purchaseOrderCreateFromRequest`, intent filter on list | `lib/api.ts` | DONE |
