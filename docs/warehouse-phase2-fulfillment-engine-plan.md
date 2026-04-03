# Warehouse Phase 2 — Fulfillment Engine + Smart Picking + Warehouse UI

**Status:** Implemented (see codebase references below).
**Related:** [warehouse-phase1-foundation.md](./warehouse-phase1-foundation.md), [enterprise-stock-request-fulfillment-redesign-plan.md](./enterprise-stock-request-fulfillment-redesign-plan.md).

## Implementation references (this rollout)

| Area | Location |
|------|----------|
| Ledger types | `RESERVE_FULFILLMENT`, `RELEASE_FULFILLMENT_RESERVE` in `StockLedgerType` |
| Reservation | `src/api/v1/modules/fulfillment/reservation.service.ts` — called from `allocationPlan.service` on confirm/cancel |
| Send dispatch | `dispatches.service.sendDispatch` — releases fulfillment reserve per lot line then `TRANSFER_OUT` |
| Fulfillment facade | `src/api/v1/modules/fulfillment/` — `POST /api/v1/fulfillment/stock-requests/:id/start`, `GET .../status` |
| Receive → request | `markStockRequestStatusFromDispatchReceive` in `stock_requests.service.ts` (called from `receiveDispatch`) |
| Dispatch discrepancies | `StockDispatchDiscrepancy` model + `GET/POST /api/v1/inventory/dispatches/:id/discrepancies`, `PATCH /api/v1/inventory/dispatches/discrepancies/:discrepancyId/resolve` |
| Frontend (bpa_web) | Staff `warehouse/operations/*`, `inventory/receive-dispatch/[dispatchId]`, owner stock request enterprise panel |

## Executive summary

Phase-2 layers **executable warehouse operations** on existing entities: `StockRequest` → `AllocationPlan` → `PickList` → `StockDispatch` → branch receive, with **FEFO allocation**, **optional hard reservation** at allocation confirm (ledger-backed), **auditable** partial pick/dispatch/receive, and **operations UI** for staff and owners.

## Fulfillment modes

- **LEGACY_TRANSFER:** Owner `PATCH /stock-requests/:id/fulfill` → `StockTransfer` (unchanged).
- **ENTERPRISE_DISPATCH:** Allocation plan → pick list → dispatch DO → `receiveDispatch`. Reservation at confirm when `FULFILLMENT_RESERVATION_ENABLED` is not `false` (default on).

## API summary

- `POST /api/v1/fulfillment/stock-requests/:id/start` — body: `fromLocationId`, optional `warehouseId`; creates allocation plan draft.
- `GET /api/v1/fulfillment/stock-requests/:id/status` — aggregated plan/pick/dispatch for UI.
- Existing: `/api/v1/allocation-plans/*`, `/api/v1/pick-lists/*`, `/api/v1/inventory/dispatches/*`
- `POST/GET /api/v1/inventory/dispatches/:id/discrepancies` — branch/ops exception reporting on a dispatch.

## Concurrency and safety

- Allocation **confirm** runs reservation inside the same transaction pattern as ledger writes (serialized via Prisma transaction; per-line lot balance checks before reserve).
- **send** releases reserved quantity for each lot line before `TRANSFER_OUT`, so on-hand math stays consistent with Phase-1 balance semantics (`effective = onHandQty - reservedQty` in FEFO reads).

## Rollback

- Set env `FULFILLMENT_RESERVATION_ENABLED=false` to skip new reserve/release on confirm/cancel (legacy behavior for confirm without stock lock).
- Feature remains backward compatible: legacy owner fulfill path untouched.

## Definition of done (Phase-2 delivery)

- Reservation integrated on allocation confirm/cancel; dispatch send consumes reserve + outbound ledger.
- Fulfillment facade exposes start + status for UI.
- Stock request status on dispatch receive uses centralized helper with `RECEIVED_FULL` / `RECEIVED_PARTIAL` semantics where applicable.
- Dispatch discrepancy records + API.
- Staff operations and receive pages + owner enterprise summary panel in bpa_web.
