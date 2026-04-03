# Purchase order — enterprise procurement flow (plan)

## 1. Current-state audit

### 1.1 Backend (exists)

| Area | Status |
|------|--------|
| **Routes** | `/api/v1/purchase-orders` — POST create, GET list, GET `:id`, POST `:id/submit|approve|reject|cancel` |
| **Service** | `purchaseOrder.service.ts` — create with `nextPoNumber`, vendor/warehouse validation, line create, subtotal/grandTotal from line unit costs; list/get; status transitions; `applyGrnReceiveToPurchaseOrder` for GRN receive roll-up |
| **Controller** | Org resolution via `getOrgIdsForUser` + optional `orgId` in body/query; drift helper on read paths |
| **Schema** | `PurchaseOrder`: orgId, vendorId, optional warehouseId, poNumber, status enum, currency, subtotal, taxTotal, grandTotal, expectedDeliveryDate, notes, internalNote, createdByUserId, submittedAt, approved/rejected/cancelled fields |
| **Lines** | `PurchaseOrderLine`: variantId, orderedQty, receivedQty, unitCost, note |
| **GRN** | `grn.service` accepts `purchaseOrderId`; receive updates PO lines and status (PARTIALLY_RECEIVED / RECEIVED) |
| **Inventory bulk receive** | `inventory.controller` supports `purchaseOrderId` on receive |
| **Audit** | `logWarehouseAudit` on submit (PO_SUBMIT) and cancel (PO_CANCEL) |
| **Vendors API** | `/api/v1/vendors/lookup?q=&orgId=&limit=` for searchable list |
| **Variant search** | `/api/v1/inventory/variants/search?q=&limit=` (org-scoped in controller) |
| **Warehouses** | `/api/v1/warehouse?orgId=` lists org warehouses |

### 1.2 Frontend (exists)

| Area | Status |
|------|--------|
| **List** | `/owner/inventory/purchase-orders` — table: PO #, vendor, status, line count, Open |
| **Create** | `/owner/inventory/purchase-orders/new` — **primitive**: numeric Vendor ID + JSON textarea for lines |
| **Detail** | `/owner/inventory/purchase-orders/[id]` — status, actions (submit/approve/reject/cancel), lines ordered/received, linked GRNs; generic reject/cancel reasons; weak link to receipts |
| **API helpers** | `lib/api.ts`: `purchaseOrdersList`, `purchaseOrderGet`, `purchaseOrderCreate`, `purchaseOrderAction` |
| **Vendor UX** | `VendorLookup.jsx` — async search via `/vendors/lookup` |
| **Variant UX** | `receipts/bulk/ProductBrowserPanel.tsx` — debounced `/inventory/variants/search` |
| **Bulk receive** | `BulkReceivePage.tsx` — location, vendor search, optional PO id text, approved PO dropdown when org known |

### 1.3 Partially implemented

- **Tax / line discount**: `taxTotal` on PO exists; lines have no tax/discount columns — totals are line-based subtotal only today.
- **Approval governance**: Status transitions exist; no separate “approval queue” or role split (any org user with API access can approve per current backend).
- **PO attachments**: No `PurchaseOrder` attachment model; vendor attachments exist on vendor record only.
- **Priority / payment terms**: Not modeled on `PurchaseOrder`; can be free-text in notes/internalNote only without migration.

### 1.4 Missing / primitive

| Gap | Detail |
|-----|--------|
| **Create UX** | Raw vendor id + JSON — not acceptable for operations |
| **Header fields on UI** | Warehouse, expected date, currency, notes not exposed on create |
| **Totals on create** | No live subtotal/grand preview |
| **List richness** | No warehouse, total, expected date, created date, filters |
| **Detail richness** | No actor names, weak totals header, no deep-link to bulk receive with PO/vendor prefill |
| **Validation UX** | No inline line validation, duplicate variant handling |
| **Reopen** | Not in `PurchaseOrderStatus` / service — deferred |

### 1.5 Broken

- None identified in API contracts; prior Prisma drift is environment-specific (migrations).

---

## 2. Enterprise procurement behavior (target)

1. **Draft PO** — user picks vendor (search), destination warehouse (optional but recommended), dates, notes, currency; adds lines via product/variant search; saves draft.
2. **Submit** — moves to SUBMITTED; audit event.
3. **Approve / Reject** — approver actions with visible timestamps; reject/cancel require explicit reason in UI.
4. **Receive** — GRN/bulk receive linked by `purchaseOrderId`; lines show received vs ordered; PO status rolls up automatically.
5. **Cancel** — allowed until terminal states; reason stored.

---

## 3. PO connections (target)

| Link | Mechanism |
|------|-----------|
| Vendor | `vendorId` + lookup API |
| Variants | `PurchaseOrderLine.variantId` + inventory variant search |
| Warehouse | `warehouseId` on PO + warehouse list API |
| GRN | `Grn.purchaseOrderId` + UI navigation to bulk receive with query params |
| Allocation/pick | Out of PO create scope; no hard dependency |
| Audit | Existing `WarehouseAuditEvent` + PO row timestamps/reason fields |
| Attachments | Defer unless shared “entity attachment” pattern is added later |

---

## 4. UX gaps (to close in implementation)

- Replace JSON lines with table + variant picker (reuse search pattern from bulk receive).
- Replace vendor id with `VendorLookup`.
- Add warehouse `<select>` from `/api/v1/warehouse?orgId=`.
- Add expected delivery (date), currency (select common codes + empty = default), notes + internal notes.
- Summary card: line count, total qty, subtotal (and grand = subtotal until tax).
- Detail: badges, totals, warehouse, dates, actor strip (created/approved/rejected), pending qty column, primary CTA “Receive against this PO”.
- List: optional status filter; columns for warehouse, grand total, expected delivery.

---

## 5. Backend / API changes (this rollout)

- **Validation**: `orderedQty` integer ≥ 1 per line on create; optional stricter variant existence check deferred (inventory search already org-scoped UI).
- **getById**: Include `createdBy`, `approvedBy`, `rejectedBy` with `profile.displayName` (and `username` fallback) for audit display.
- No new routes required for MVP enterprise create (existing POST body already supports `warehouseId`, `expectedDeliveryDate`, `notes`, `internalNote`, `currency`).

---

## 6. Approval flow

- **Current**: Same user can draft, submit, approve (backend allows DRAFT→APPROVED).
- **Product future**: Restrict `approve` to `owner.procurement.approve` or separate role — not in this change unless registry already has keys.
- **UI**: Separate buttons, modals for reject/cancel reason; show `rejectionReason` / `cancelReason` on detail.

---

## 7. Receipt / GRN linkage

- Detail page: link to `/owner/inventory/receipts/bulk?purchaseOrderId=&vendorId=` (and optional `orgId` if needed).
- Bulk receive page: read `useSearchParams` and prefill `purchaseOrderId` (and vendor when PO loaded).

---

## 8. Validation rules

| Rule | Layer |
|------|--------|
| Vendor required | Client + server (existing) |
| ≥ 1 line | Client + server |
| orderedQty ≥ 1 | Client + server (new) |
| variantId required per line | Client |
| Duplicate variant | Client warning / block on add |
| Warehouse optional | If policy later requires it, add server check + migration note |
| unitCost ≥ 0 if provided | Client soft + server accepts Decimal |

---

## 9. Acceptance checklist

- [ ] `/owner/inventory/purchase-orders/new` uses vendor search + line builder (no JSON in default path).
- [ ] Create sends warehouse, dates, notes, currency when set.
- [ ] List shows operational columns; detail shows totals, actors, pending qty, GRN list, receive CTA.
- [ ] Bulk receive deep link prefills PO (and vendor).
- [ ] Draft/submit/approve/reject/cancel still work; GRN receive still updates PO lines.
- [ ] No regressions to allocation/pick/dispatch.

---

## 10. Rollout notes

- Requires DB migrations for warehouse PO tables already applied (enterprise migration chain).
- Train users: submit before approve if they want a two-step discipline (backend still allows approve from DRAFT).

---

## 11. Deferred items

- PO-level attachments table + upload UI.
- Per-line tax/discount + persisted `taxTotal` calculation.
- Separate procurement approval permission and approver queue.
- `reopen` status transition.
- Email / notification on submit.
