# Stock Request — Receive Flow (PHASE 6)

## Summary

Branch receive is implemented via existing **Transfers** flow: incoming transfers (toLocationId = branch) are listed; receive modal submits per-line received/missing/damaged/expired; backend creates ledger entries and updates transfer (and linked StockRequest when applicable).

## Flow

1. **Incoming list:** Staff → Inventory → Transfers → “Incoming” tab. Shows transfers where toLocation = branch. Status SENT / IN_TRANSIT can be received.
2. **Receive:** Click “Receive” → modal with lines (variant, lot, quantity sent). User enters quantity received, damaged, expired per line. Submit → POST `/api/v1/transfers/:id/receive` with `items: [{ variantId, lotId?, quantityReceived, quantityDamaged, quantityExpired }]`.
3. **Backend:** Ledger: TRANSFER_IN (received), DAMAGE, EXPIRED, LOSS as needed. StockLotBalance/StockBalance updated. If transfer.stockRequestId set, StockRequest status → RECEIVED_PARTIAL or RECEIVED_FULL.
4. **No receive → no sell:** Stock is only added to branch after receive; until then it is not in sellable inventory (ledger-driven).

## Edge cases

- **Partial receive:** total received + damaged + expired < sent → PARTIAL_RECEIVED; remaining can be received later or disputed.
- **Mismatch:** total ≠ sent → StockDiscrepancy created, transfer status DISPUTED; owner resolves via resolve-dispute.
- **Evidence:** API accepts evidenceMediaIds; UI can add upload in phase-2.
- **lotId:** Passed in receive items when transfer items are lot-backed so ledger entries are correct per lot.

## Files touched

- bpa_web/app/staff/branch/[branchId]/inventory/transfers/page.jsx — receive modal: include lotId in lineItems and in submit payload.
