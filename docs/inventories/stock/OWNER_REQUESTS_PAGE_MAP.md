
# OWNER REQUESTS & INVENTORY CENTER — PAGE MAP (Port 3104)

This document is a ready-to-implement page map for the Owner Panel.

---

## Sidebar Group: Requests & Approvals
- Inbox
- Product Requests
- Inventory Transfers
- Inventory Adjustments
- Returns & Damages
- Cancellations
- Notifications

---

## 1. Inbox
Route: /owner/requests
Purpose: Unified pending and action-required requests.

API:
GET /api/v1/owner/requests

---

## 2. Product Requests
Routes:
- /owner/product-requests
- /owner/product-requests/new
- /owner/product-requests/[id]

Purpose:
Branch demand → Owner approval → Transfer creation.

APIs:
- GET /api/v1/owner/product-requests
- POST /api/v1/owner/product-requests
- POST /api/v1/owner/product-requests/:id/approve
- POST /api/v1/owner/product-requests/:id/create-transfer

---

## 3. Inventory Transfers
Routes:
- /owner/inventory/transfers
- /owner/inventory/transfers/new
- /owner/inventory/transfers/[id]

Purpose:
Owner to Branch stock movement with batch & expiry.

APIs:
- POST /api/v1/owner/inventory/transfers
- POST /api/v1/owner/inventory/transfers/:id/dispatch
- POST /api/v1/owner/inventory/transfers/:id/close

---

## 4. Inventory Adjustments
Routes:
- /owner/inventory/adjustments
- /owner/inventory/adjustments/new
- /owner/inventory/adjustments/[id]

Purpose:
Damage, expiry, loss, write-off handling.

---

## 5. Returns & Damages
Routes:
- /owner/returns
- /owner/returns/[id]

---

## 6. Cancellations
Routes:
- /owner/cancellations
- /owner/cancellations/[id]

---

## 7. Notifications
Route:
- /owner/notifications

---

## Shared Components
- RequestStatusBadge
- ApprovalDecisionModal
- TransferItemsEditor
- BatchPickerDropdown (FEFO)

---

## Implementation Order
1. Inbox
2. Product Requests
3. Inventory Transfers
4. Reconciliation
5. Adjustments & Cancellations

