# WAREHOUSE_PO_RECEIVE_QUEUE_FIX_PLAN

**Created:** 2026-04-03
**Branch:** V-A1.0.7
**Status:** IMPLEMENTED

---

## 1. Root Cause

Approved purchase orders are not visible in the warehouse staff receiving workflow because
of two independent gaps:

### Gap A — Backend: no endpoint returns pending POs for a branch warehouse

`GET /api/v1/inventory/receipts/incoming-unified` powers the Receive Center.
Its implementation (`inboundReceipts.service.ts` → `getIncomingInboundUnifiedForBranch`) only
queries `StockDispatch` (challan) and `StockTransfer` rows — vendor purchase orders are
entirely absent.

No other endpoint filters purchase orders by warehouse branch.

### Gap B — Frontend: `inventory/receive` page only shows transfers/dispatches

`app/staff/(larkon)/branch/[branchId]/inventory/receive/page.jsx` calls only
`staffGetIncomingInboundUnified(branchId)` and renders dispatches + transfers.
PO-linked GRN receive is handled by a **separate** page
(`warehouse/receive-po`) that is reachable only via the owner deep-link, not via
any sidebar item in the warehouse group.

### Gap C — Sidebar: `warehouse/receive-po` is unreachable by normal navigation

`branchSidebarConfig.ts` Warehouse group has "Receive stock" → `inventory/receive`.
There is **no** sidebar item for `warehouse/receive-po`.
Staff who do not receive the owner deep-link URL have no way to discover vendor PO
receiving through the normal UI.

---

## 2. Implementation Decisions

| Decision | Rationale |
|---|---|
| Add `GET /api/v1/inventory/receipts/pending-po-receipts?branchId=` | Keeps the receive-center's existing endpoint unchanged; separates concerns cleanly |
| Implement in `purchaseOrder.service.ts` + registered via `dispatches.controller.ts` | Re-uses existing branch-scoped auth helpers (`getOrgIdForInboundUser`, `getAllowedBranchIdsForInboundReceive`) |
| Filter POs via Prisma relation filter `warehouse: { branchId, isActive: true }` | Cleaner than a two-step warehouse-ID lookup; uses the existing FK |
| Add PO section to existing `inventory/receive` page | Zero new routes; staff already land here via "Receive stock" sidebar |
| Keep transfers/dispatches section 100% unchanged | Backward compatibility preserved; no regression risk |
| Add "Vendor receipts" sidebar item to Warehouse group | Gives warehouse staff a direct first-class navigation path |

### Warehouse resolution logic
`Warehouse.branchId` is set at PO creation time (via `resolveWarehouseId` which creates a
compatibility Warehouse row linked to the branch when a `branchId` is passed).
The new endpoint queries:
```
PurchaseOrder WHERE orgId = orgId
              AND status IN [APPROVED, PARTIALLY_RECEIVED]
              AND warehouse.branchId = requestedBranchId
              AND warehouse.isActive = true
```
Then filters in-memory for `pendingQty > 0` (orderedQty − receivedQty per line).

---

## 3. Files Changed

### Backend
| File | Change |
|---|---|
| `src/api/v1/modules/purchase_orders/purchaseOrder.service.ts` | Add `listPendingPoReceiptsForBranch(branchId, orgId)` |
| `src/api/v1/modules/dispatches/dispatches.controller.ts` | Add `exports.listPendingPoReceipts` handler |
| `src/api/v1/modules/inventory/inventory.routes.ts` | Add `GET /receipts/pending-po-receipts` route |

### Frontend
| File | Change |
|---|---|
| `lib/api.ts` | Add `staffGetPendingPoReceipts(branchId)` |
| `app/staff/(larkon)/branch/[branchId]/inventory/receive/page.jsx` | Add "Vendor PO receipts" section |
| `src/lib/branchSidebarConfig.ts` | Add "Vendor receipts" sidebar item in Warehouse group |

---

## 4. API Contract

**Request**
```
GET /api/v1/inventory/receipts/pending-po-receipts?branchId=<number>
Authorization: Bearer <staff JWT>
Permission: inventory.receive OR inbound.grn OR purchase.receive OR procurement.po.view
```

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "id": 42,
      "poNumber": "PO-1-00001",
      "status": "APPROVED",
      "vendorId": 7,
      "vendorName": "ACME Supplies",
      "expectedDeliveryDate": "2026-04-10T00:00:00.000Z",
      "lineCount": 3,
      "pendingQty": 150,
      "totalOrderedQty": 150,
      "totalReceivedQty": 0,
      "warehouseId": 2,
      "warehouseName": "Bala G LTD Central Warehouse",
      "createdAt": "2026-03-28T08:00:00.000Z"
    }
  ]
}
```

---

## 5. Business Rules Enforced

| Rule | Enforcement |
|---|---|
| Only APPROVED or PARTIALLY_RECEIVED POs appear | `status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] }` in query |
| Fully received POs are excluded | Post-query filter: `pendingQty > 0` |
| CANCELLED / REJECTED / DRAFT / SUBMITTED are excluded | Status filter above |
| Org scoping | `orgId` resolved from JWT via `getOrgIdForInboundUser` |
| Branch access control | `getAllowedBranchIdsForInboundReceive` validates the branchId param |
| Warehouse must belong to branch | Prisma relation filter `warehouse: { branchId }` |

---

## 6. QA Checklist (logic-verified in code)

- [x] APPROVED PO with matching warehouse branchId appears — `status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] }` AND `warehouse: { branchId }`
- [x] DRAFT / SUBMITTED PO does not appear — excluded by status filter
- [x] CANCELLED / REJECTED / RECEIVED PO does not appear — excluded by status filter
- [x] RECEIVED PO with all lines received also excluded — `pendingQty = 0` → filtered out by `.filter(po => po.pendingQty > 0)`
- [x] PARTIALLY_RECEIVED PO appears with correct pendingQty — `Math.max(0, orderedQty - receivedQty)` per line; `receivedQty Int @default(0)` in schema
- [x] Over-received lines capped at 0 pending — `Math.max(0, ...)` guard
- [x] Staff accessing wrong branch gets 403 — `getAllowedBranchIdsForInboundReceive` check in handler
- [x] Different-org PO excluded — `orgId` resolved from JWT via `getOrgIdForInboundUser`; query filters `orgId`
- [x] Transfers/dispatches still appear unchanged — existing `incoming-unified` endpoint and card untouched
- [x] "Receive PO" button links correctly — `receiveHref` = `/staff/branch/${branchId}/warehouse/receive-po?purchaseOrderId=${po.id}&vendorId=${po.vendorId}`
- [x] Deep link opens BulkReceivePage pre-filled — `receive-po/page.tsx` passes `purchaseOrderId` to `BulkReceivePage`; that component already handles it via `useSearchParams()`
- [x] After GRN post, PO status updated — `applyGrnReceiveToPurchaseOrder` in `grn.service.ts` updates `receivedQty` per line and rolls PO to `PARTIALLY_RECEIVED` / `RECEIVED`; next poll of `pending-po-receipts` will exclude fully-received POs
- [x] Sidebar "Vendor receipts" gated on `purchase.receive` OR `grn.post` OR `grn.create` OR `inbound.grn`
- [x] Sidebar item navigates to `warehouse/receive-po` (empty = browse mode, staff can search POs)
- [x] `requirePermission` is OR semantics (verified in `requirePermission.ts` line 7: `required.some(...)`)
- [x] `receivedQty` is `Int` in schema — no Decimal cast needed; `Number()` wrap is safe no-op

---

## 7. Follow-up Recommendations

1. **Badge count on sidebar**: Add a `pendingPoReceipts` badge key to
   `BranchSummaryCounts` (server-side count call) so the warehouse group shows how many
   POs are awaiting receipt — same pattern as `approvals` badge.

2. **Warehouse-only POs** (standalone DC without `branchId`): These are currently
   invisible in the branch queue. If needed, add a warehouse-level receive queue at
   `/staff/branch/{branchId}/warehouse/operations` surfaced via `warehouseId` filter.

3. **Overdue PO highlighting**: Surface `expectedDeliveryDate < today` visually with a
   warning badge on the receive-center PO row.

4. **Push notification / task**: At PO approval time, optionally enqueue a warehouse task
   or send an in-app notification to warehouse staff — this avoids relying on polling.
