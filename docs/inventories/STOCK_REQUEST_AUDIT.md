# Stock Request & Fulfillment — Audit (PHASE 0)

**Purpose:** Reuse map for Stock Request → Fulfillment → Dispatch → Receive. No deletions; merge/extend only.

---

## 1) Existing Prisma models and relations

### Products & variants
- **Product** (id, orgId, name, slug, status, categoryId, brandId, approvalStatus, …) — owner-owned.
- **ProductVariant** (id, productId, sku, title, flavorId, unitId, barcode) — used everywhere for stock.

### Batch/lot (inventory)
- **StockLot** (id, orgId, variantId, lotCode, mfgDate, expDate) — org-level lot; batch-wise inventory.
- **StockLotBalance** (locationId, lotId, onHandQty, reservedQty) — per-location lot balance.
- **Batch** (productVersionId, factoryId, mfgDate, expDate) — authenticity/serial batch; not used for stock requests.

### Inventory & ledger
- **InventoryLocation** (id, branchId, type: CLINIC|SHOP|ONLINE_HUB, name, code) — locations are branch-scoped.
- **StockLedger** (locationId, variantId, lotId?, type, quantityDelta, refType, refId) — append-only.
- **StockLedgerType:** OPENING, SALE_POS, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT, DAMAGE, EXPIRED, LOSS, RETURN_*, etc.
- **StockBalance** (locationId, variantId, onHandQty, reservedQty) — derived/summary.
- **Inventory** — legacy; ledger is source of truth.

### Transfers (existing — reuse)
- **StockTransfer** (id, fromLocationId, toLocationId, status, createdByUserId, sentAt, receivedAt).
- **StockTransferItem** (transferId, variantId, lotId?, quantitySent, quantityReceived, quantityDamaged, quantityExpired).
- **StockTransferStatus:** DRAFT, SENT, IN_TRANSIT, RECEIVED, PARTIAL, PARTIAL_RECEIVED, COMPLETED, DISPUTED, CANCELLED.
- **StockDiscrepancy** (transferId, variantId, lotId?, expectedQty, receivedQty, damagedQty, missingQty, evidenceMediaIds, status, resolvedByUserId).

### Other
- **StockAdjustmentRequest** (orgId, locationId, variantId, lotId?, quantityDelta, status PENDING/APPROVED/REJECTED).
- **ProductChangeRequest** (orgId, type, status, requestedFromBranchId, payload) — product edit requests; not stock requests.

### Gaps (do not exist)
- **StockRequest** — does not exist.
- **StockRequestItem** — does not exist.
- No “request header + items” or “fulfillment → transfer” link.

---

## 2) Existing API routes and controllers

### Inventory
- **GET /api/v1/inventory** — list (ledger-derived).
- **GET /api/v1/inventory/balance, /summary, /lots, /fefo, /locations, /alerts, /expiring**.
- **POST /api/v1/inventory/opening** — opening stock (lot-backed).
- **POST /api/v1/inventory/adjustment-requests**.
- **POST /api/v1/inventory/pos-sale, /online-reserve, /online-sale**.
- **Controller:** inventory.controller.ts. **Service:** inventory.service.ts, ledger.service.ts.

### Transfers (reuse)
- **GET /api/v1/transfers** — list (query: fromLocationId, toLocationId, status).
- **GET /api/v1/transfers/:id** — single.
- **POST /api/v1/transfers** — create draft (body: fromLocationId, toLocationId, allocations[{ lotId, variantId, quantity }]).
- **POST /api/v1/transfers/:id/send** — TRANSFER_OUT ledger, status → IN_TRANSIT.
- **POST /api/v1/transfers/:id/receive** — receive (items[{ variantId, lotId?, quantityReceived, quantityDamaged, quantityExpired }], notes, evidenceMediaIds).
- **POST /api/v1/transfers/:id/resolve-dispute** — owner: ACCEPT_LOSS | RESEND | DAMAGE_WRITEOFF.
- **Controller:** transfers.controller.ts. **Service:** transfers.service.ts (lot-backed create/send/receive).

### Permissions
- inventory.read, inventory.update, org.read, org.write; pos for POS.

---

## 3) Existing UI pages

### Owner (3104)
- **/owner/transfers** — list transfers; send; receive (full); resolve dispute.
- **/owner/transfers/new** — create transfer (needs fromLocationId, toLocationId, allocations).
- **/owner/transfers/[id]** — transfer detail.
- **/owner/inventory** — inventory page.
- **/owner/branches/[id]/inventory** — branch inventory.
- No “Stock Requests” list or “Fulfill by request” flow.

### Branch / Staff
- **/staff/branch/[branchId]/inventory** — inventory.
- **/staff/branch/[branchId]/inventory/receive** — receive flow (opening stock style: location + variant + qty; not transfer-based receive).
- **/staff/branch/[branchId]/inventory/transfers** — transfers.
- **/staff/branch/[branchId]/inventory/adjustments** — adjustments.
- No “Stock Requests” list or “Create request (product + variant + qty)” flow.

### Shop (3101) / Clinic (3102)
- **/shop/inventory**, **/shop/pos** — shop inventory/POS.
- No stock-request UI.

---

## 4) Gaps for Stock Request + Owner Fulfillment

| Area | Exists | Gap |
|------|--------|-----|
| StockRequest table | No | Add StockRequest (branchId, orgId, requesterUserId, status, timestamps). |
| StockRequestItem table | No | Add StockRequestItem (requestId, productId, variantId, requestedQty, note). No batch. |
| Request → Transfer link | No | Add optional stockRequestId on StockTransfer (or keep separate; link by convention). |
| Branch: create/submit request | No | New API + UI. |
| Branch: list/detail requests | No | New API + UI. |
| Owner: list requests (date, branch, status) | No | New API + UI. |
| Owner: fulfill (batch/lot + qty per line) | No | New API + UI (needs available lots per variant at owner location). |
| Owner: dispatch from fulfillment | No | Create StockTransfer from fulfillment, then POST send (reuse existing send). |
| Branch: receive transfer (existing) | Yes | transfers/:id/receive exists; ensure branch receive UI uses it for incoming transfers. |
| Notifications (new requests / incoming) | Partial | Notification model exists; no “new stock request” or “incoming shipment” counts in menu. |

---

## 5) Reuse mapping

- **Transfer / StockTransfer** = doc “Transfer”. **StockTransferItem** = doc “TransferItem” (batch = lotId).
- **StockLot** = batch for fulfillment (owner selects lot + qty).
- **ReceiveReport** = existing receive API (items with quantityReceived, quantityDamaged, quantityExpired); **StockDiscrepancy** for mismatches.
- **Ledger** = StockLedger; types TRANSFER_OUT, TRANSFER_IN, DAMAGE, EXPIRED, LOSS already exist.
- **StockRequest status** = new enum; map to doc: DRAFT → SUBMITTED → OWNER_REVIEW → FULFILLED_* → DISPATCHED → RECEIVED_* → CLOSED, CANCELLED.
- **Fulfillment** = owner action: for each request item choose lot + fulfillQty → create StockTransfer with items (lotId, variantId, quantity).

---

## 6) Summary

- **DB:** Add StockRequest + StockRequestItem; optionally StockTransfer.stockRequestId.
- **API:** New stock-requests module (branch: CRUD + submit; owner: list, get, fulfill, dispatch); receive remains transfers/:id/receive.
- **UI Branch:** Stock Requests list, create (bulk table), detail with status.
- **UI Owner:** Requests list (date/branch/status), request detail with fulfill table (requested, available, fulfill qty, lot selector), dispatch → create + send transfer.
- **UI Branch receive:** Align staff receive page with “incoming transfers” and use POST /transfers/:id/receive for transfer-based receive (lot-wise received/missing/damaged).
