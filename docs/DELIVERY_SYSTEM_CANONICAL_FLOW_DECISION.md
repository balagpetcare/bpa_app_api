# Canonical delivery flow — hard decision

> **Status:** Active (2026-04-11)  
> **See also:** `DELIVERY_SYSTEM_BUILD_BLUEPRINT.md` §1

## Canonical path (only path for new fulfillment work)

```
StockRequest → POST /fulfillment/stock-requests/:id/start
  → AllocationPlan (FEFO / manual lines) → POST /allocation-plans/:id/confirm
  → PickList → POST /inventory/dispatches → POST .../send
  → DispatchReceiveSession (verify / submit / confirm) → GRN on post
```

## Deprecated (controlled fallback only)

- `PATCH /stock-requests/:id/fulfill` and `POST /stock-requests/:id/dispatch` (StockTransfer)
- `POST /transfers/*` write operations when `LEGACY_TRANSFERS_ENABLED=false` (future Phase 9)

## UI

- Owner stock request detail: enterprise card is primary; legacy quick dispatch is **collapsed by default** (`bpa_web`).

## Environment

- `DISABLE_LEGACY_STOCK_REQUEST_FULFILL=true` — API rejects legacy fulfill (optional hardening).
- `ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT=true` — narrows legacy block when a plan is only in DRAFT (default false).
- `MULTI_SOURCE_ALLOCATION_ENABLED` — multi-source allocation (default false until execution complete).

## No new Prisma statuses

- Use `APPROVED` on `StockRequest` after plan confirm — do **not** add `READY_TO_FULFILL`.
- Branch receive remains `DispatchReceiveSession` — do **not** add `BranchReceiveSession`.
