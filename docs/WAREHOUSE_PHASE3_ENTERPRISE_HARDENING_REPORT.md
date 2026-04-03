# Warehouse Phase-3 enterprise hardening (report)

Concise record of backend/frontend hardening for warehouse operations, scanning UX, cycle count, KPIs, and org isolation.

## Files changed

| Area | Path |
|------|------|
| Warehouse dashboard API | `src/api/v1/modules/warehouse/warehouseOperations.service.ts` |
| Pick list API (barcode for scan UX) | `src/api/v1/modules/pick_lists/pickList.service.ts` |
| Cycle count posting | `src/api/v1/modules/inventory/stockCount.service.ts` |
| Cycle count tests | `src/api/v1/modules/inventory/stockCount.service.test.ts` |
| Staff pick list UI | `bpa_web/app/staff/(larkon)/branch/[branchId]/warehouse/pick-lists/[id]/page.tsx` |
| Warehouse dashboard types | `bpa_web/types/warehouse-dashboard.ts` |

## Key fixes

1. **Org isolation (search)** — Product variant search on the staff warehouse dashboard now scopes variants with `product: { orgId: warehouse.orgId }` and `isActive: true`, closing cross-org leakage via SKU/barcode/title matches.

2. **Numeric ID search** — Stock request and warehouse transfer order search no longer uses `id: -1` in `OR` clauses; numeric ID predicates are only added when the query is all digits.

3. **Delivery assignments** — `deliveryAssignment` queries now require `dispatch: { orgId: warehouse.orgId, ... }` so assignments cannot attach to dispatches from another org if data were inconsistent.

4. **Alerts and KPIs (semantic correctness)** — The `low_stock` alert and `kpis.lowStockAlerts` now use the count of low on-hand rows at the warehouse (`stockBalance` at linked locations with `onHandQty <= limitPerQueue` slice length), not a sum of near-expiry, expired, and dispatch discrepancy metrics. A separate **`expired_on_hand`** alert bucket and **`expiredOnHandLotRows`** KPI field document expired on-hand rows without double-counting them as “low stock.”

5. **Cycle count post** — `postStockCount` uses a single `recordLedgerEntryInTx` path for positive and negative variance (duplicate branches removed). Jest tests cover idempotent `POSTED` behavior and mixed-sign variance lines.

6. **Pick list scan UX** — API returns `variant.barcode` on pick lines; the staff pick list detail page adds a scan/search field (SKU or barcode, including leading-zero tolerant numeric barcode match), row highlight, and scroll-into-view for mobile scanning workflows.

## Index and performance recommendations (not all applied as migrations)

- **StockDispatch / DeliveryAssignment** — Existing `@@index([orgId])` on `StockDispatch` supports the added `orgId` filter; ensure `delivery_assignments` has an index on `(assignedToUserId, status)` if task lists grow large.
- **ProductVariant** — For org-scoped search, composite index on `(productId)` is already implied by FK; consider `(productId, isActive)` if product catalogs are huge.
- **StockBalance** — Warehouse low-stock queries filter `locationId IN (...)` and `onHandQty <= N`; composite `(locationId, onHandQty)` can help if profiling shows sequential scans.
- **WarehouseAuditEvent** — Dashboard already filters `orgId`, `warehouseId`; keep `@@index([warehouseId, createdAt])` under review for audit feeds.

## Remaining lower-priority follow-ups

- **Dedicated warehouse scan events** — If Phase-3 requires immutable scan logs per pick/pack/receive (distinct from producer serial `ScanEvent`), add a first-class model and APIs with idempotent keys `(orgId, refType, refId, scannedAt bucket, rawPayload hash)`.
- **Duplicate pick UIs** — Reconcile `warehouse/operations/picks/[pickListId]` vs `warehouse/pick-lists/[id]` routes: single canonical URL or explicit redirect to avoid drift.
- **Analytics regression fixtures** — Add integration tests that seed known ledger + dispatch + task rows and assert KPI parity with SQL snapshots.
- **Stock count lot-level lines** — `freezeStockCount` is variant-level; extending to lot-level snapshots would align cycle count with lot-tracked warehouses.

## QA checklist (manual)

- [ ] Staff warehouse search: query another org’s SKU — should not return hits.
- [ ] Dashboard alerts: low stock count matches “low on-hand” rows, not expiry/discrepancy totals.
- [ ] Pick list: scan SKU and barcode (with leading zeros) — line highlights and scrolls.
- [ ] Cycle count: post twice — second call idempotent; ledger entries not duplicated.
