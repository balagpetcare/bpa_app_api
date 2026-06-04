# POS vs Inventory Stock Mismatch Diagnosis (2026-04-21)

## Confirmed Root Cause

POS product stock is read from the legacy `inventory` table (`inventory.quantity`), while the staff Inventory page is read from ledger-derived `stock_balances` (`onHandQty` / `reservedQty` / `availableQty`).

Because these are different sources, Inventory can show stock available while POS shows `stock = 0` and renders "Out of stock".

## Exact Mismatch Point

### Inventory page source (staff inventory screen)
- Frontend: `bpa_web/lib/api.ts:378-387` (`staffInventoryList`) calls `GET /api/v1/inventory?branchId=...`
- Backend: `backend-api/src/api/v1/modules/inventory/inventory.controller.ts:148-199` (`getInventory`)
- Backend service: `backend-api/src/api/v1/modules/inventory/inventory.service.ts:387-466` (`getInventorySummaryV2`)
- Query source: `prisma.stockBalance.findMany(...)`
- Quantity fields returned:
  - `quantity = onHandQty`
  - `availableQty = onHandQty - reservedQty`

### POS browse source (staff POS product browser)
- Frontend fetch: `bpa_web/lib/api.ts:827-834` (`staffPosProducts`)
- Backend: `backend-api/src/api/v1/modules/pos/pos.controller.ts:261-417` (`getProducts`)
- Query source: `prisma.inventory.findMany(...)` at `pos.controller.ts:326-338`
- Stock mapping: `stock = sum(inventory.quantity)` by `variantId` at `pos.controller.ts:340-349, 392-405`

### POS barcode source
- Frontend fetch: `bpa_web/lib/api.ts:836-842` (`staffPosBarcodeLookup`)
- Backend: `backend-api/src/api/v1/modules/pos/pos.service.ts:402-466` (`getProductByBarcode`)
- Query source: `prisma.inventory.aggregate(...)` at `pos.service.ts:428-435`
- Stock mapping: `stock = sum(inventory.quantity)` at `pos.service.ts:436`

## Frontend Rendering Path Verified

- Route branch ID is taken from URL param and passed through:
  - `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/page.jsx:34-39, 405-412`
  - `PosSaleWorkspace` fetches with this `branchId`: `PosSaleWorkspace.jsx:144-156`
- POS marks out-of-stock strictly from `stock`:
  - flatten/mapping: `PosSaleWorkspace.jsx:326-340`
  - label/button disable: `PosProductPanel.jsx:98-100, 130, 141`
  - add-to-cart guard: `PosSaleWorkspace.jsx:501-503`
- Frontend coercion exists (`Number(item.stock ?? 0)`), but backend currently provides `stock` explicitly, so this is not the primary cause.

## Failure Mode Checklist

1. Wrong `branchId` reaching backend: **Not indicated**
- POS and Inventory both pass route `branchId` via query param.
- POS middleware resolves `req.posBranchId` from query/body/params (`pos.middleware.ts:15-31, 45-88`).

2. Hardcoded `branchId`: **Not found in runtime POS code**
- Only test fixtures contain hardcoded branch IDs.

3. Route `branchId` propagation failure: **Not found**
- Propagation is consistent from route -> API calls.

4. Different location/branch stock scope: **Confirmed mismatch**
- Inventory is location-based (`stock_balances` per `locationId`, filtered by `location.branchId`).
- POS browse/barcode use branch-level legacy `inventory` rows with no location dimension.

5. Variant key mismatch: **Contributing risk**
- POS browse stock map is keyed by `variantId`; product-level legacy rows (`variantId = null`) do not populate variant stock for variant products.

6. Quantity field mismatch: **Confirmed**
- Inventory view uses `onHandQty` / `availableQty`.
- POS uses legacy `inventory.quantity`.

7. Frontend missing-stock -> 0 coercion: **Present, secondary**
- Exists in POS UI, but root issue is upstream source divergence.

8. Nested vs flat stock field mismatch: **Not found**
- Backend sends flat `variant.stock`; frontend expects flat `stock`.

9. Page/search subset transform issue: **Not primary**
- POS slices for display, but stock already resolved upstream per item.

10. Barcode vs browse logic divergence: **Partially**
- Different code paths, but both read the same legacy table (`inventory`), so both inherit the same mismatch.

## Affected Files / Functions

- `backend-api/src/api/v1/modules/pos/pos.controller.ts` (`getProducts`)
- `backend-api/src/api/v1/modules/pos/pos.service.ts` (`getProductByBarcode`)
- `backend-api/src/api/v1/modules/inventory/inventory.controller.ts` (`getInventory`)
- `backend-api/src/api/v1/modules/inventory/inventory.service.ts` (`getInventorySummaryV2`)
- `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/_components/PosSaleWorkspace.jsx`
- `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/_components/PosProductPanel.jsx`
- `bpa_web/lib/api.ts` (`staffPosProducts`, `staffPosBarcodeLookup`, `staffInventoryList`)

## Minimal Safe Fix Plan (No Broad Refactor)

1. Keep response shape unchanged for POS frontend.
2. Replace POS stock read in browse/barcode from `prisma.inventory` to ledger-derived stock (`stockBalance`) for the same branch.
3. Use one shared helper for POS stock resolution so browse and barcode cannot drift.
4. Decide and document stock semantic for POS button enable:
- Recommended: `availableQty` (`onHandQty - reservedQty`) to align sellable stock behavior.
5. Optional temporary local instrumentation (guarded by env flag) for 1-2 days:
- Log per variant when `legacyInventoryQty !== ledgerAvailableQty` to validate rollout.
6. Regression verify:
- Same branch + variant should match between `/api/v1/inventory` and `/api/v1/pos/products` stock semantics.

---

## Fix Applied (2026-04-22)

### Exact fix implemented

1. Added shared POS stock resolver based on ledger balances:
- `backend-api/src/api/v1/modules/pos/pos.service.ts`
- New helper: `getBranchVariantStockMap(branchId, variantIds)`
- Source: `stock_balances` filtered by `location.branchId`
- Stock semantic: `availableQty = max(0, sum(onHandQty) - sum(reservedQty))`

2. POS browse flow switched from legacy `inventory` table to shared helper:
- `backend-api/src/api/v1/modules/pos/pos.controller.ts` (`getProducts`)
- Removed `prisma.inventory.findMany(...)` variant/base stock reads
- Variant `stock` now comes from shared branch variant stock map
- `baseStock` now derived from summed variant available qty per product

3. POS barcode flow switched to the same shared helper:
- `backend-api/src/api/v1/modules/pos/pos.service.ts` (`getProductByBarcode`)
- Removed `prisma.inventory.aggregate(...)` stock read
- `stock` now uses `getBranchVariantStockMap(...)` for the scanned variant

4. Frontend stock coercion hardening (non-breaking):
- `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/_components/PosSaleWorkspace.jsx`
- Added `toStockValue()` to avoid `|| 0` style fallback masking non-finite values
- Applied to flattened browse stock and barcode item stock mapping

### Files changed

- `backend-api/src/api/v1/modules/pos/pos.service.ts`
- `backend-api/src/api/v1/modules/pos/pos.controller.ts`
- `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/_components/PosSaleWorkspace.jsx`
- `backend-api/docs/pos/POS_STOCK_MISMATCH_DIAGNOSIS_2026-04-21.md`

### Validation performed

1. Type/lint checks on touched paths:
- Backend: `npm run typecheck` (pass)
- Frontend: `npx eslint "app/staff/(larkon)/branch/[branchId]/pos/_components/PosSaleWorkspace.jsx"` (pass)

2. Data-level branch/variant parity check (DB-backed script):
- Sample result:
  - `branchId: 2`, `variantId: 278`
  - Inventory-equivalent available: `490`
  - POS browse stock (shared helper): `490`
  - Match: `true`

3. Add-to-cart enable/disable logic:
- UI logic unchanged and still correct:
  - Disabled when `stock <= 0` or `price` missing
  - Enabled when `stock > 0` and price is configured
- With corrected stock source, button state now reflects ledger-derived availability.

### Remaining limitations

- Barcode parity could not be live-verified with a stocked variant barcode in the current DB snapshot (`barcode` was null on stocked sample rows).  
  Even so, browse and barcode now call the same stock helper, so they are code-path aligned.
