# Stock request owner fulfill — location-aware extra item picker (plan)

**Status:** Planning only — no implementation in this document.
**Page:** `bpa_web/app/owner/(larkon)/inventory/stock-requests/[id]` — “Add extra item (not on original request)”.
**Depends on:** Existing org-scoped source locations, same-org enforcement, and **`getMaxDispatchableQtyAtLocation`** / FEFO rules in `fefoAllocation.service.ts` (do not duplicate).

---

## 1. Problem summary

The extra-item block uses **`GET /api/v1/inventory/stock-request-products?branchId=...`**, which is designed for **stock request creation** and **branch + org-wide “central” warehouse aggregation** (`STOCK_REQUEST_PICKER_RULE`: branch locations + all warehouse-backed hub locations for the org). It is **not** scoped to the owner’s currently selected **source** location (`fromLocationId`).

**Result:** The picker behaves like a **generic catalog search** with misleading stock hints (branch vs central split, not “what I can ship from **this** hub today”). Extra lines must obey the **same** dispatch rules as requested lines — **single source location** and **authoritative max dispatch**.

---

## 2. Current behavior

### Frontend (`page.tsx`)

- `loadPicker` calls
  `GET /api/v1/inventory/stock-request-products?branchId=${branchId}&page=1&limit=30&search=...`
- **No `fromLocationId`** is sent.
- Debounced search (~350ms) refetches the same endpoint.
- Table shows product name + variant `<select>` + Add; **no** per-row book/lot/max columns aligned with fulfill grid.
- `extraLines` store `productId`, `variantId`, `fulfillQty`; dispatch uses **`PATCH .../fulfill`** with `extraItems` — backend already uses **`getMaxDispatchableQtyAtLocation`** for validation (same as requested items).

### Backend (`getStockRequestProducts`)

- Loads **ACTIVE** catalog products for **org** (up to large cap), merges **`stockBalances`** across **`balanceLocationIds` = branch locations ∪ all warehouse-linked hub locations** for org.
- Variant row includes `stockOnHand`, `centralOnHand`, `availableQty` (branch-local net), optional `batchInfo` from **branch** lot balances only for lot-required variants.
- **In-memory** filter/sort/pagination after materializing many products — not keyed to one `inventoryLocation.id`.
- **Does not** call **`getMaxDispatchableQtyAtLocation`**.

---

## 3. Expected enterprise behavior

1. **Only when `fromLocationId` is selected** (and same-org as request): enable the extra-item picker; optionally show a short message if no source is selected.
2. Picker lists **only variants** (or products containing such variants) for which **max dispatchable at `fromLocationId` > 0** by default — using the **same** definition as fulfill validation:
   **`max(non_lot_effective, FEFO_eligible_lot_total)`** via **`getMaxDispatchableQtyAtLocation(request.orgId, fromLocationId, variantId)`**.
3. Each row displays: **product name**, **variant name**, **available / max dispatchable** (authoritative), **non-lot (book) effective**, **lot-side FEFO-eligible total** (and optionally raw lot sum for transparency — see contract).
4. **Search** narrows results **within** location-aware candidates (not global catalog first).
5. **Pagination or infinite scroll** — server-driven — to avoid loading thousands of SKUs client-side.
6. **Optional toggle** “Include zero stock” (default off) — when on, may show variants with 0 max dispatch but then **disable Add** or show reason (reuse diagnostics patterns from `availabilityDiagnostics` if useful).
7. **Manual / FEFO mode** unchanged for **how** dispatch lines are built; picker only supplies **variant + qty** — same as today. Mode affects **`PATCH /fulfill`**, not the picker query.

---

## 4. Backend design

### 4.1 Single source of truth

- **Max dispatchable:** `getMaxDispatchableQtyAtLocation(orgId, locationId, variantId)` in **`fefoAllocation.service.ts`**.
- **Breakdown columns:**
  - `bookEffective` = `getNonLotEffectiveAtLocation(locationId, variantId)`
  - `fefoLotEligible` = `getFefoEligibleLotTotal(orgId, locationId, variantId)`
  - Optional `rawLotOnHandSum` (sum of `stock_lot_balances.onHand` at location for org-matched lots, **before** FEFO filters) — **only** if needed for UX parity with “Lot avail (raw)” on requested lines; otherwise omit to avoid a third definition.

### 4.2 API shape (recommended)

**Option A (preferred):** New endpoint to avoid breaking create flow and keep contracts clear:

- `GET /api/v1/inventory/stock-request-extra-picker`
  **Query:** `fromLocationId` (required), `stockRequestId` (required for auth + `orgId`), `search`, `page`, `limit`, `includeZeroStock` (boolean, default false).

**Option B:** Extend `GET /api/v1/inventory/stock-request-products` with optional `fromLocationId` + `stockRequestId`: when both present, **switch** to location-scoped implementation; when absent, **preserve** current behavior for create.

**Recommendation:** **Option A** — clearer monitoring, smaller regression surface for staff/create flows.

### 4.3 Authorization

- User must be **org owner** of `StockRequest.orgId` (same as fulfill) **or** consistent with existing stock-request detail access.
- Resolve `fromLocationId` → branch → **must match `request.orgId`** (reuse **`resolveOrgIdForLocation`** / same checks as fulfill).

### 4.4 Candidate set (performance)

**Challenge:** Cannot call `getMaxDispatchableQtyAtLocation` for every variant in catalog.

**Strategy (tiered):**

1. **Narrow candidate variant IDs** at the selected location using indexed reads:
   - `stock_balance` where `locationId = fromLocationId` and `(onHandQty - reservedQty) > 0` **OR**
   - `stock_lot_balance` join `stock_lot` where `locationId = fromLocationId`, `lot.orgId = requestOrgId`, `onHandQty > 0`, and FEFO calendar eligibility (same rules as FEFO query).
2. **Union** those variant IDs → distinct list.
3. Apply **search** filter on joined `product` / `product_variant` (name, sku, barcode).
4. **Paginate** variant IDs (or product IDs with nested variants) **before** computing expensive aggregates — but max dispatch requires **per variant** call: batch in pages of **limit** (e.g. 20–50), each page:
   - For each variant in page, call **`getMaxDispatchableQtyAtLocation`** + breakdown (3 calls can be merged in a small helper to avoid triple DB round-trips per variant — optional optimization: single raw SQL or batched prisma).

5. **Default filter:** `maxDispatchable > 0` unless `includeZeroStock=true`.

### 4.5 Duplicate logic prevention

- **Forbidden:** reimplementing FEFO math in the picker service.
- **Required:** import and call **`getMaxDispatchableQtyAtLocation`**, **`getNonLotEffectiveAtLocation`**, **`getFefoEligibleLotTotal`** from **`fefoAllocation.service.ts`** (or a thin `stockAvailabilityBreakdown.ts` that only delegates to those functions).

---

## 5. Frontend design

1. **Gate:** Extra picker **disabled** until `fromLocationId` and loaded `request` are present; tooltip/copy: “Select source warehouse to search stock available for dispatch.”
2. **Replace** `loadPicker` URL: call new endpoint with `fromLocationId`, `stockRequestId`, `search`, `page`, `cursor`/`page`.
3. **Table columns:** Product | Variant | Book | Lot (FEFO-eligible) | Max dispatch | Action (or inline qty + Add).
4. **Variant selection:** Prefer **one row per variant** (flatten variants); if product-grouped, expand to show each variant as a row with its own numbers.
5. **Pagination:** “Load more” or numbered pages bound to `pagination` from API.
6. **Toggle:** “Show items with zero dispatchable stock” → sets `includeZeroStock=true`, refetch page 1.
7. **Add flow:** Unchanged — append to `extraLines`; fulfill still posts `extraItems: [{ productId, variantId, fulfillQty }]`. **Validation** remains server-side on PATCH.

---

## 6. API contract (proposed)

**`GET /api/v1/inventory/stock-request-extra-picker`**

| Query param | Required | Description |
|-------------|----------|-------------|
| `stockRequestId` | Yes | Stock request id (resolves `orgId`, branch for auth). |
| `fromLocationId` | Yes | Source `inventory_location.id` (must match request org). |
| `search` | No | Substring on product name, variant sku/title/barcode. |
| `page` | No | Default 1. |
| `limit` | No | Default 20, max 50. |
| `includeZeroStock` | No | Default false. |

**Response:** `{ success, data: { items: ExtraPickerRow[] }, pagination: { page, limit, total, totalPages } }`

**`ExtraPickerRow` (per variant):**

| Field | Type | Source |
|-------|------|--------|
| `productId` | number | Product |
| `productName` | string | Product |
| `variantId` | number | Variant |
| `variantLabel` | string | title / sku |
| `bookQty` | number | `getNonLotEffectiveAtLocation` |
| `lotFefoQty` | number | `getFefoEligibleLotTotal` |
| `maxDispatchable` | number | `getMaxDispatchableQtyAtLocation` |
| `rawLotOnHandQty` | number (optional) | Sum on-hand at location for org-matched lots (display only) |

**Errors:** 400 missing params, 403 org/location mismatch, 404 request not found.

---

## 7. Data fields required per result row

Minimum: **productName, variantId, variantLabel, bookQty, lotFefoQty, maxDispatchable**.
Optional **rawLotOnHandQty** only if product wants parity with “Lot avail (raw)” line — must be documented as **non-authoritative** for dispatch cap.

---

## 8. Search / pagination strategy

- **Server-side pagination** on **filtered variant candidates** (not entire catalog).
- **Search** applied in SQL/Prisma after restricting to candidate variant IDs, or combined: `WHERE variant_id IN (...candidates...) AND (product.name ILIKE ... OR variant.sku ILIKE ...)`.
- **Sort:** default by `maxDispatchable` desc, then product name, then variant id — **tunable**.
- **Large catalogs:** cap in-memory fan-out; rely on **candidate pre-filter** from balance tables.

---

## 9. Validation rules

- **PATCH /fulfill** remains authoritative; picker is **UX** — still enforce max on server.
- **Client:** optional soft cap: `fulfillQty <= maxDispatchable` for extra lines when numbers are present.
- **Reject** picker API if `resolveOrgIdForLocation(fromLocationId) !== stockRequest.orgId`.

---

## 10. Duplicate-item handling

- **UI:** If `extraLines` already contains `(productId, variantId)`, disable Add or show “Already added” (current behavior uses key `extra-${productId}-${vid}` — keep).
- **Server:** Existing fulfill logic creates or merges **EXTRA** `stock_request_item` rows — unchanged.

---

## 11. Empty state behavior

- No candidates at location with stock + search empty: “No stock found at this source for your catalog search.”
- No `fromLocationId`: “Select a source location to add extra items.”
- Search with no matches: “No matching products with stock at this location.”

---

## 12. Error state behavior

- 403/400: toast or inline alert; do not clear `fromLocationId`.
- Network error: retry; show message.
- Partial failure when computing breakdown: fail row or omit optional fields — prefer **fail fast** per request with 500 + log for ops.

---

## 13. Performance notes

- **Avoid** N× full-catalog `getMaxDispatchableQty` — always **pre-filter** variant IDs from `stock_balance` / `stock_lot_balance` at `fromLocationId`.
- **Batch** per page (20–50 variants): acceptable for owner UX.
- **Index use:** ensure queries hit `stock_balances(location_id, variant_id)`, `stock_lot_balances(location_id)`, `stock_lots(org_id, variant_id)` — verify indexes in schema (existing).
- **Optional cache:** short TTL cache keyed `(locationId, variantId)` for breakdown — **post-MVP** only if measured.

---

## 14. Step-by-step implementation plan

1. Add **`getStockRequestExtraPicker`** (name TBD) in **`inventory.service.ts`** using **`fefoAllocation`** helpers; new **controller** + **route**; Prisma access checks.
2. **Auth:** mirror owner stock-request fulfill — owner org + `stockRequestId` ownership.
3. **Frontend:** wire owner detail page to new endpoint; disable picker without `fromLocationId`; new table columns + pagination + zero toggle.
4. **Remove** or **stop calling** `stock-request-products` from this block only (leave create/staff flows untouched).
5. **QA:** scenarios below + regression on stock request **create** page (still uses old endpoint).

---

## 15. Files to change (expected)

| Area | Files |
|------|--------|
| Backend | `inventory.service.ts` (new function), `inventory.controller.ts`, `inventory.routes.ts` |
| Shared logic | `fefoAllocation.service.ts` (no behavior change unless adding a batched helper) |
| Frontend | `app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` |
| Docs | This file |

---

## 16. Regression checklist

- [ ] Stock request **create** (branch) still uses **`/inventory/stock-request-products`** unchanged if Option A.
- [ ] Owner fulfill **requested lines** grid unchanged.
- [ ] **PATCH /fulfill** validation unchanged for `extraItems`.
- [ ] Same-org **`fromLocationId`** enforcement consistent with detail GET.
- [ ] Manual / FEFO toggle behavior unchanged.

---

## 17. Manual QA scenarios

1. Select hub **A** with stock → picker shows only variants with **max > 0** at A; columns match detail **max** for a known SKU.
2. Change source to hub **B** → list changes; no stale rows from A.
3. Search narrows results; pagination works.
4. Add extra item with qty **>** max → server rejects or clamps per existing fulfill rules.
5. Toggle “include zero” → zero-max variants appear; Add still blocked or warned per UX decision.
6. No `fromLocationId` → picker disabled.

---

## 18. Relation to requested vs extra stock sources

| Aspect | Requested lines | Extra lines (today) | Extra lines (target) |
|--------|-----------------|---------------------|------------------------|
| Preview / max | `GET stock-requests/:id?fromLocationId=` | None in picker | Same endpoint family / same **`getMaxDispatchableQtyAtLocation`** |
| Picker data | N/A | Branch + multi-hub catalog API | **Single `fromLocationId`** only |

---

*End of plan.*
