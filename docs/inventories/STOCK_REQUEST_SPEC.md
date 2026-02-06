# Stock Request — Spec (PHASE 1)

Aligned with STOCK_REQUEST_AUDIT.md and existing routes/models.

---

## 1) Data objects

### StockRequest (new)
- id, orgId, branchId, requesterUserId, status (enum), createdAt, updatedAt, submittedAt (nullable).
- Relations: org, branch, requester (User), items (StockRequestItem[]), transfer (StockTransfer? optional).

### StockRequestItem (new)
- id, stockRequestId, productId, variantId, requestedQty, note (optional).
- No batch/lot stored here (owner chooses at fulfillment).

### Fulfillment → Transfer mapping
- Fulfillment = owner action: for each request item, select lotId + fulfillQty (0 = backorder).
- Result: create StockTransfer with fromLocationId = owner source location, toLocationId = branch’s receiving location; items = [{ variantId, lotId, quantity: fulfillQty }].
- Optional: StockTransfer.stockRequestId to link transfer to request (for status updates: DISPATCHED, RECEIVED_*).

### ReceiveReport
- Use existing: POST /api/v1/transfers/:id/receive with items[{ variantId, lotId, quantityReceived, quantityDamaged, quantityExpired }]. StockDiscrepancy and ledger (TRANSFER_IN, DAMAGE, EXPIRED, LOSS) already handled.

---

## 2) Status transitions

### StockRequest status
- DRAFT → SUBMITTED (branch submit).
- SUBMITTED → OWNER_REVIEW (owner opens; optional auto or on first view).
- OWNER_REVIEW → FULFILLED_PARTIAL | FULFILLED_FULL (after owner saves fulfillment; full when all lines have fulfillQty >= requestedQty).
- FULFILLED_* → DISPATCHED (after owner dispatches = create transfer + send).
- DISPATCHED → RECEIVED_PARTIAL | RECEIVED_FULL (after branch receives; from transfer status).
- RECEIVED_* → CLOSED (auto or manual close).
- Any → CANCELLED (branch before submit; owner or branch per policy).

### StockTransfer status (existing)
- DRAFT → SENT (send) → IN_TRANSIT → RECEIVED/PARTIAL_RECEIVED/COMPLETED; DISPUTED if mismatch.

---

## 3) Validation rules

- Branch: no batch at request; only productId, variantId, requestedQty, note. requestedQty > 0.
- Owner: fulfill qty 0 ≤ fulfillQty ≤ available (per lot); partial allowed; can split one request line into multiple lots (multiple transfer lines).
- Dispatch: validate sender location has sufficient lot balance for each (variantId, lotId, qty); reject expired lots.
- Receive: received + damaged + expired ≤ sent per line; missing = sent − (received + damaged + expired). Ledger: TRANSFER_IN (received), DAMAGE/EXPIRED/LOSS as needed.

---

## 4) Permissions matrix

| Action | Owner | Branch Manager | Seller |
|--------|-------|----------------|--------|
| Create/edit draft request | — | ✓ | — |
| Submit request | — | ✓ | — |
| List own branch requests | — | ✓ | read-only if needed |
| List all org requests, fulfill, dispatch | ✓ | — | — |
| List incoming transfers, receive | — | ✓ | — |
| Resolve dispute | ✓ | — | — |

Use existing: inventory.read, inventory.update, org.read, org.write. Branch scope: only own branch’s requests / incoming transfers.

---

## 5) Notifications (requirements)

- Owner: count of requests in SUBMITTED / OWNER_REVIEW for menu badge (phase-2: push/email).
- Branch: count of incoming transfers (IN_TRANSIT / SENT) for menu badge (phase-2: push/email).
- MVP: optional counts from list endpoints; no new notification tables required.

---

## 6) MVP vs phase-2

- **MVP:** Create request (bulk table), submit, owner list/detail, fulfill table (requested, available, fulfill qty, lot selector), dispatch → transfer + send, branch receive (existing receive API), ledger correct, request status updated from transfer.
- **Phase-2:** “Repeat last request” helper, backorder handling (explicit backorder state), CSV bulk add, evidence upload on receive, notification delivery.

---

## 7) Naming alignment with doc

- StockRequest, StockRequestItem = doc.
- Fulfillment = owner action (no separate Fulfillment table; state in request status + transfer).
- Transfer / StockTransfer, TransferItem / StockTransferItem = existing.
- ReceiveReport = existing receive API + StockDiscrepancy.
- Ledger = StockLedger.
