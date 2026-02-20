# Stock Request — API Changelog (PHASE 3)

## New routes (module: stock_requests)

| Method | Path | Description | Scope |
|--------|------|-------------|--------|
| POST | /api/v1/stock-requests | Create draft request | Branch (managed) or org owner |
| GET | /api/v1/stock-requests | List requests | branchIds (managed) or orgId (owner) |
| GET | /api/v1/stock-requests/:id | Get detail | + query fromLocationId for available lots |
| PATCH | /api/v1/stock-requests/:id | Update items (draft only) | Branch/owner |
| POST | /api/v1/stock-requests/:id/submit | Submit request | Branch |
| POST | /api/v1/stock-requests/:id/cancel | Cancel (DRAFT/SUBMITTED) | Branch or owner |
| POST | /api/v1/stock-requests/:id/dispatch | Fulfill and dispatch (create transfer + send) | Org owner only |

## Controllers / services touched

- **New:** src/api/v1/modules/stock_requests/stock_requests.service.ts
- **New:** src/api/v1/modules/stock_requests/stock_requests.controller.ts
- **New:** src/api/v1/modules/stock_requests/stock_requests.routes.ts
- **Modified:** src/api/v1/routes.ts (mount /stock-requests)
- **Modified:** src/api/v1/modules/transfers/transfers.service.ts (receiveTransfer: after commit, call markRequestReceivedIfLinked)

## Validation rules

- Create: branchId + items[] required; each item: productId, variantId, requestedQty > 0; no batch.
- Update items: draft only; items[] required.
- Submit: draft only; request must have items.
- Dispatch: fromLocationId, toLocationId, items[] required; each item: variantId, lotId, quantity. Owner must be org owner. Sender location lot balance validated on send (transfers.service).

## Ledger entries (unchanged)

- TRANSFER_OUT on send (from fromLocation).
- TRANSFER_IN, DAMAGE, EXPIRED, LOSS on receive (to toLocation). StockDiscrepancy on mismatch.

## Request status updates

- Submit: DRAFT → SUBMITTED.
- Dispatch: SUBMITTED/OWNER_REVIEW → DISPATCHED (after transfer created and sent).
- Receive (transfers/:id/receive): if transfer.stockRequestId set, request status → RECEIVED_PARTIAL or RECEIVED_FULL.

## Permissions

- Uses existing auth middleware. Access: getManagedBranchesForUser (branch scope) or organization.ownerUserId (owner scope). No new permission keys; inventory.read/inventory.update implied by existing transfer/inventory usage.
