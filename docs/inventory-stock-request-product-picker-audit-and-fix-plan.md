# Stock request Product Picker — audit and fix plan

**Status:** Implemented (2026-03-28)
**Rule ID:** `BRANCH_LOCAL_STOCK_PLUS_CENTRAL_SUPPLY_PLUS_ZERO_BRANCH_CATALOG`

---

## Live runtime verification (branchId = 1) — before fix

| Check | Result |
|--------|--------|
| `inventoryLocations` (active) for branch 1 | **[] (empty)** |
| `ACTIVE` products for org 1 | **120** |
| Active variants for org 1 | **360** |
| Org warehouses | **[]** |
| Central warehouse `inventory_locations` | **0** |

**Conclusion:** The picker was empty because the service **returned early when there were no branch inventory locations**, not because the catalog was empty.

---

## Smoke test (after fix)

`getStockRequestProducts({ branchId: 1, userId: 1, page: 1, limit: 5 })`:

- **items:** 5 (non-empty)
- **meta:** `defaultLocationCreated: true`, `branchLocalLocationCount: 1`, `centralLocationCount: 0`, `rawProductCount: 120`

First API call **creates** a default SHOP `InventoryLocation` when missing (idempotent with migration + `ensureDefaultBranchInventoryLocation`).

---

## Locked domain rule — what the picker shows

1. **Branch local stock** — `stockOnHand` = sum of `StockBalance.onHandQty` at this branch’s active **non-warehouse** inventory locations.
2. **Requestable central stock** — `centralOnHand` = sum of `onHandQty` at org `InventoryLocation` rows with **`warehouseId` set** (central supply). Zero when no central locations exist.
3. **Zero-stock requestable catalog** — All org `ACTIVE` products with at least one active variant are listed **even when branch `stockOnHand` is 0**.

**Filters:** `stockStatus` **low** / **out** use **branch** `stockOnHand` only.
**Search:** Product name + variant SKU + **partial** barcode (case-insensitive).
**Pagination:** Filter → sort → slice (consistent `total` / pages).

---

## Implementation summary

| Area | Change |
|------|--------|
| Backend service | [`src/api/v1/modules/inventory/inventory.service.ts`](../src/api/v1/modules/inventory/inventory.service.ts) — `getStockRequestProducts`, `ensureDefaultBranchInventoryLocation`, `STOCK_REQUEST_PICKER_RULE` |
| Backend controller | [`src/api/v1/modules/inventory/inventory.controller.ts`](../src/api/v1/modules/inventory/inventory.controller.ts) — branch access (`getManagedBranchesForUser` + owner org), response `meta` |
| Web API client | [`bpa_web/lib/api.ts`](../../bpa_web/lib/api.ts) — `StockRequestProductsMeta`, `centralOnHand`, `meta` on `staffStockRequestProducts` |
| Staff UI | [`bpa_web/app/staff/(larkon)/branch/[branchId]/inventory/stock-request-create/page.jsx`](../../bpa_web/app/staff/(larkon)/branch/[branchId]/inventory/stock-request-create/page.jsx) — Branch / Central columns, meta banners |
| DB migration | [`prisma/migrations/20260328160000_backfill_default_branch_inventory_locations/migration.sql`](../prisma/migrations/20260328160000_backfill_default_branch_inventory_locations/migration.sql) — idempotent INSERT for branches with no locations |
| Script (already in repo) | [`scripts/backfill-default-inventory-locations.ts`](../scripts/backfill-default-inventory-locations.ts) — manual / ops backfill |

**Seed strategy:** Run `npx prisma migrate deploy` (or `migrate dev`) so the migration applies; optional `npx ts-node scripts/backfill-default-inventory-locations.ts` for environments that do not replay migrations. Runtime **still** ensures a location on first picker load so UIs never hard-fail on empty locations.

---

## Verification checklist

- [x] Branch 1 returns non-empty `data` when org has ACTIVE products (verified: 5 items page 1, 120 total).
- [x] `meta.defaultLocationCreated: true` when a default location was created on that request.
- [x] `meta` returned for UI diagnostics (`pickerRule`, `branchLocalLocationCount`, `centralLocationCount`, `catalogTruncated`, `rawProductCount`).
- [x] Branch access enforced: controller checks `getManagedBranchesForUser` + owner org → 403 for unauthorized users.
- [x] DB state post-fix: branch 1 has `InventoryLocation` id 4 (SHOP, "Bala G Pet Clinic, Rampura - Main").
- [x] Partial barcode search: `{ barcode: { contains: s, mode: "insensitive" } }` (case-insensitive).
- [x] Filter/sort/pagination order fixed: filter → sort → paginate (consistent `total`).

---

## Risk notes

- In-memory cap: `MAX_STOCK_REQUEST_PICKER_PRODUCTS = 5000`; `meta.catalogTruncated` when exceeded.
- Central stock requires org warehouse-linked `inventory_locations`; many orgs will show `centralOnHand` as 0 until central warehouse is provisioned.
