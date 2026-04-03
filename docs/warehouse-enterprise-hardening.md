# Warehouse — Enterprise Hardening & Phase-2 Readiness

This document complements [`warehouse-phase1-foundation.md`](./warehouse-phase1-foundation.md) with operational hardening: indexes, rate limits, audit enrichment, transfer edge cases, and validation expectations for multi-tenant stock.

## Database indexes (additive)

Composite indexes support tenant-scoped reporting and fulfillment-style queries:

| Area | Indexes (conceptual) |
|------|------------------------|
| Locations | `(warehouseId, isActive)`, `(branchId, warehouseId)` |
| Stock ledger | `(orgId, locationId, createdAt)`, `(orgId, variantId, createdAt)`, `(orgId, lotId)` |
| Stock transfers | `(stockRequestId, status)`, `(stockRequestId, status, createdAt)` — multi-wave listing |
| Stock lots (inventory) | `(orgId, variantId)`, `(orgId, variantId, expDate)` — FEFO |
| Warehouses | `(orgId, isActive)` |

Apply via Prisma migration; run `node scripts/check-migration-integrity.js` after deploy.

## Rate limiting

Warehouse **mutation** endpoints under `/api/v1/inventory` use `inventoryWarehouseMutationLimiter` (`src/middleware/rateLimiters.ts`):

- `POST /stock/in`, `POST /stock/out`, `POST /transfers`, `POST /transfers/:id/dispatch`

Environment:

- `RL_INVENTORY_WAREHOUSE_MUTATION_WINDOW_MS` (default 60000)
- `RL_INVENTORY_WAREHOUSE_MUTATION_MAX` (default 120 per window per IP)

Reads (`GET /warehouses`, `GET /stock`) are not limited separately beyond global API policy.

## Audit trail

- `auditMetadataFromRequest` (`warehouseAudit.service.ts`) merges `X-Request-Id` / `X-Correlation-Id` and client IP into `WarehouseAuditEvent.metadata` for warehouse inventory handlers.
- **Transfer receive** (`transfers.service` `receiveTransfer`) emits `TRANSFER_RECEIVE` after successful processing, including `stockRequestId` when linked (multi-wave traceability).

## Edge cases: partial receive & multi-line transfers

**Receive matching** (`receiveTransfer`):

1. Optional **`transferItemId`** on each receive line maps 1:1 to `StockTransferItem` (required when multiple lines share the same `variantId` or mix lot / non-lot rows).
2. Without `transferItemId`, lines match an **unmatched** transfer row by `(variantId, lotId)`; if `lotId` is omitted on the receive payload, only **non-lot** (`lotId IS NULL`) transfer rows are matched, in `id` order.
3. **Totals**: `totalReceived` is derived from per–transfer-item received quantities (fixes duplicate-`variantId` under-counting).

**Multi-wave stock requests**: multiple `StockTransfer` rows can reference one `stockRequestId`; indexes on `(stockRequestId, status, createdAt)` support listing and audits.

## Validation expectations

### Multi-org isolation

- Every stock mutation must resolve `orgId` via `Branch` → `InventoryLocation` or explicit `StockLedger.orgId` (auto-filled in `recordLedgerEntryInTx` when omitted).
- API handlers use `userCanAccessOrgForLocations` (or equivalent) before mutating.

### Concurrent updates & ledger consistency

- Balance changes run **inside the same Prisma transaction** as `StockLedger` inserts (`recordLedgerEntryInTx` / transfer `receive` / `send` transactions).
- Concurrent requests serialize at the DB level per row (`StockBalance`, `StockLotBalance`); the first commit wins; others fail with insufficient stock — no silent overwrite.

### Ledger consistency

- Append-only `StockLedger`; derived `StockBalance` / `StockLotBalance` updated only through ledger service paths.
- Reconciliation: use existing reports (`/inventory/reports/*`, `/inventory/reconciliation`) for drift checks.

## Phase-2 — Fulfillment engine (preparation)

- **FEFO picking**: use `getFefoPickCandidates` (alias of `getAvailableLotsFEFO`) from `inventory/services/stockLedger.service.ts` for lot-ordered slices at a location.
- **Line identity**: `StockTransferItem.stockRequestItemId` links fulfillment waves to request lines.
- **Correlation**: clients should send `X-Request-Id` on mutations for cross-service tracing into `WarehouseAuditEvent`.

Future Phase-2 work may introduce allocation reservations (`RESERVE_*` ledger types), pick tasks, and idempotent receive idempotency keys — without changing existing Phase-1 API contracts.
