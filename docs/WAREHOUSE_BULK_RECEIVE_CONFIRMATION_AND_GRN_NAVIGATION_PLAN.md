# Warehouse Bulk Receive Confirmation & GRN Navigation Plan

## Status: IMPLEMENTED

---

## 1. Current Broken Behavior

### GRN Navigation / Discoverability
- Receipts table at `/owner/inventory/receipts` has **no clickable row link** to the GRN detail page
- "View" button opens a **drawer/offcanvas** only — not a full page
- The GRN detail page at `/owner/inventory/grn/[id]` exists and works, but is **unreachable** from the receipts list
- After bulk receive creates a draft, the success banner does link to `/owner/inventory/grn/{id}` but if user navigates away, the GRN becomes hard to find
- STATUS_OPTIONS in receipts list only has DRAFT and RECEIVED — missing PENDING_CONFIRMATION and VOIDED

### Submit for Confirmation
- The "Submit for confirmation" button on BulkReceivePage success banner **does call the real API** (`grnSubmitForConfirmation`)
- The API endpoint `POST /api/v1/grn/:id/vendor-receive/submit` **works correctly** — transitions VendorReceiveSession from DRAFT → AWAITING_CONFIRMATION
- However: after submit, no status badge update occurs on the success banner (it still shows DRAFT badge)
- The GRN status itself stays DRAFT (only the vendorReceiveSession changes to AWAITING_CONFIRMATION) — this is confusing for the owner
- The owner GRN detail page does **not** show the vendorReceiveSession status or submit-for-confirmation action

### Warehouse Manager Queue
- Warehouse dashboard receiving queue at `/staff/branch/{branchId}/warehouse` shows GRNs but the "Receive" action links to `/staff/branch/{branchId}/inventory/receive` (generic branch receive, not vendor GRN confirmation)
- The dedicated `/staff/branch/{branchId}/warehouse/receive-po` page loads DRAFT GRNs only (not AWAITING_CONFIRMATION)
- Notification for vendor receive submission goes to **org owner only**, not to warehouse managers

### Stock Posting
- Stock posts via `receiveGrn()` in grn.service.ts which requires `grn.confirm.warehouse_manager` perm for controlled GRNs
- The flow works but is only accessible from the receive-po page, not from a clear "pending confirmations" queue

---

## 2. Root Causes

1. **Receipts list** never added a link/route to `/owner/inventory/grn/{id}` — only has drawer
2. **VendorReceiveSession status** is separate from GRN status — UI doesn't surface it clearly
3. **Receive-po page** queries `status=DRAFT` only, missing `AWAITING_CONFIRMATION` session filter
4. **Notification** only targets org owner, not branch/warehouse managers
5. **Owner GRN detail page** has no submit-for-confirmation button and doesn't show session status
6. **Warehouse dashboard receiving queue** links to wrong page

---

## 3. Files to Change

### Backend (D:\BPA_Data\backend-api)
| File | Change |
|------|--------|
| `src/api/v1/modules/grn/grn.service.ts` | Update `listGrns` to support session status filter; add `confirmGrn` method |
| `src/api/v1/modules/grn/grn.controller.ts` | Add `confirm` handler; fix `receive` to delegate to confirm |
| `src/api/v1/modules/grn/grn.routes.ts` | Add `POST /:id/confirm` route |
| `src/api/v1/services/warehouseOpsNotifications.service.ts` | Notify warehouse managers (not just owner) |

### Frontend (D:\BPA_Data\bpa_web)
| File | Change |
|------|--------|
| `app/owner/(larkon)/inventory/receipts/page.tsx` | Add GRN detail link; show session status; add PENDING_CONFIRMATION filter |
| `app/owner/(larkon)/inventory/grn/[id]/page.tsx` | Show session status; add submit/confirm actions |
| `app/owner/(larkon)/inventory/receipts/bulk/BulkReceivePage.tsx` | Update banner after submit |
| `app/staff/(larkon)/branch/[branchId]/warehouse/receive-po/page.tsx` | Query AWAITING_CONFIRMATION; improve cards |
| `app/staff/(larkon)/branch/[branchId]/warehouse/page.tsx` | Fix receiving queue link |
| `lib/api.ts` | Add `grnConfirm` API function |

---

## 4. Final User Journey

### Owner/Admin Flow:
1. Owner navigates to `/owner/inventory/receipts` → sees receipts list
2. Clicks "Bulk receive" → creates GRN draft with lines
3. Success banner shows GRN link + "Submit for confirmation" button
4. Clicks submit → VendorReceiveSession → AWAITING_CONFIRMATION
5. Banner updates to show "Pending confirmation" status
6. From receipts list, GRN ref `#N` is now a clickable link to `/owner/inventory/grn/N`
7. GRN detail page shows session status + all actions based on state
8. Owner can also filter receipts by "Pending confirmation" status

### Warehouse Manager Flow:
1. Manager receives in-app notification "GRN awaiting confirmation"
2. Navigates to `/staff/branch/{id}/warehouse` → sees receiving queue count
3. Clicks receiving queue → sees AWAITING_CONFIRMATION GRNs
4. Clicks on GRN → taken to `/staff/branch/{id}/warehouse/receive-po`
5. Reviews expected vs actual quantities per line
6. Can adjust received qty, mark shortage/damage, add notes
7. Clicks "Confirm & post stock"
8. Stock is posted to inventory via ledger
9. GRN status → RECEIVED, session → POSTED

---

## 5. Status Transition Model

### GRN Status (existing enum — no change needed):
- `DRAFT` → `RECEIVED` (on confirm/receive)
- `DRAFT` → `VOIDED` (on void)

### VendorReceiveSession Status (existing enum — no change needed):
- `DRAFT` → `AWAITING_CONFIRMATION` (on submit)
- `AWAITING_CONFIRMATION` → `POSTED` (on confirm)
- `DRAFT` → `POSTED` (manager shortcut)
- `DRAFT` | `AWAITING_CONFIRMATION` → `CANCELLED` (on void)

### Combined Display Status (frontend-derived):
- DRAFT (GRN=DRAFT, session=DRAFT) → "Draft"
- PENDING_CONFIRMATION (GRN=DRAFT, session=AWAITING_CONFIRMATION) → "Pending Confirmation"
- RECEIVED (GRN=RECEIVED, session=POSTED) → "Received"
- VOIDED (GRN=VOIDED) → "Voided"

---

## 6. Permission Model

| Action | Required Permission |
|--------|-------------------|
| Create GRN draft | `grn.create`, `purchase.receive`, `inbound.grn` |
| Submit for confirmation | `grn.create`, `purchase.receive`, `inbound.grn` (any GRN access) |
| Confirm & post stock | `grn.confirm.warehouse_manager` OR `inventory.emergency.override` |
| Void draft | `grn.void` |
| View GRN | `grn.view` or any GRN access perm |

---

## 7. Notification Model

### On Submit for Confirmation:
- **Target**: Org owner (existing) + all branch managers at the warehouse location's branch
- **Channel**: In-app notification (existing `createNotification`)
- **Dedupe**: `vendor_receive_submit:{grnId}`
- **Action URL**: `/staff/branch/{branchId}/warehouse/receive-po` (deep link to manager receive page)
- **Priority**: P1
- **Content**: "GRN #{id} awaiting confirmation — vendor: {name}, {lineCount} lines"

### On Confirm:
- **Target**: Org owner + original submitter
- **Content**: "GRN #{id} confirmed and stock posted"

---

## 8. Acceptance Criteria

1. ✅ Receipts list: GRN ref column is a clickable link to `/owner/inventory/grn/{id}`
2. ✅ Receipts list: Status column shows combined status (Draft / Pending Confirmation / Received / Voided)
3. ✅ Receipts list: Status filter includes Pending Confirmation and Voided options
4. ✅ Owner GRN detail: Shows vendorReceiveSession status
5. ✅ Owner GRN detail: Submit for confirmation button (when DRAFT session)
6. ✅ Bulk receive: After submit, banner updates to show Pending Confirmation
7. ✅ Warehouse manager: receive-po page shows AWAITING_CONFIRMATION GRNs
8. ✅ Warehouse dashboard: receiving queue "Receive" links to receive-po page
9. ✅ Warehouse manager: Can confirm GRN and post stock
10. ✅ Stock only posts on manager confirmation (not on draft save)
11. ✅ Notifications sent to warehouse managers on submit
12. ✅ Notifications sent to owner + submitter on confirm
13. ✅ Print/discrepancy reports work across all statuses

---

## 9. Regression Checklist

- [ ] Existing GRN create (draft) still works
- [ ] Existing bulk receive still creates draft
- [ ] PO-linked bulk receive still works
- [ ] Manager direct "Confirm & post" shortcut still works
- [ ] Void draft still works
- [ ] GRN print still works
- [ ] Discrepancy report still works
- [ ] Dispatch receive flow unaffected
- [ ] Branch receive flow unaffected
- [ ] Warehouse dashboard other queues unaffected
