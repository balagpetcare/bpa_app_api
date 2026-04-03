# Stock request owner fulfillment — Central Hub availability regression (audit & fix plan)

**Status:** Audit only — no implementation in this phase.
**Scope:** `/owner/inventory/stock-requests/[id]` — owner sees **Lot avail. = 0**, **Book (non-lot) = 0**, **Max dispatch = 0**, and repeated **`INSUFFICIENT_STOCK`** / “available 0 at this location” even when hub stock is believed to exist.

**Related prior doc:** `docs/stock-request-availability-zero-root-cause-fix-plan.md` (manual mode vs lot-only stock — **largely implemented** in current `stock_requests.service.ts`).

---

## 1. Problem summary

The owner fulfillment page loads stock-request detail and, when a **source location** is chosen, expects the API to attach **per-variant lot rows**, **non-lot book balances**, and **max dispatchable** figures for validation parity. In the reported regression, **all** requested lines show **zeros** for those fields while the user believes **Central Hub** holds stock — blocking meaningful fulfill quantities and producing **line validation errors** on dispatch.

---

## 2. Observed regression symptom

- **UI grid:** “Lot avail. (raw)” = 0, “Book (non-lot)” = 0, “Max dispatch” = 0 for every line.
- **Errors:** Repeated messages like:
  `INSUFFICIENT_STOCK Requested X, available 0 at this location for variant Y`
  (from `fulfillStockRequestFlexible` when `getMaxDispatchableQty` / explicit-lot caps yield **max ≤ 0**.)
- **Context:** Source = “Central Hub - Main”, destination = branch clinic location — user expectation is non-zero availability when hub inventory exists.

---

## 3. Expected enterprise behavior

1. Stock physically present at the **selected** `inventory_locations` row for the **same org** as the `StockRequest`, with ledger rows in **`stock_balances`** and/or **`stock_lot_balances`** (+ `stock_lots` scoped by **`orgId`**).
2. **GET** ` /api/v1/stock-requests/:id?fromLocationId=` returns enriched payload:
   `availableLotsByVariant`, `aggregateStockByVariant`, `maxDispatchableByVariant`, `maxDispatchableByItemId` (pool-split for duplicate variants).
3. **PATCH** `/api/v1/stock-requests/:id/fulfill` uses the **same** max rules as the GET enrichment (`getMaxDispatchableQty` = max(non-lot effective, **FEFO-eligible lot total**)).
4. Manual mode only changes **how** lines are expanded (non-lot vs FEFO slices), not the **ceiling** (see current `getMaxDispatchableQty` — already unified).

---

## 4. Confirmed vs suspected root causes

### Confirmed in code (behaviour today)

| Item | Finding |
|------|--------|
| **Detail enrichment** | `getRequestById` only adds availability when `options.fromLocationId` is set (`stock_requests.service.ts`). |
| **Max dispatch** | `getMaxDispatchableQty` uses `Math.max(getFefoEligibleLotTotal(...), aggregateStockBalance)` — **not** manual-mode-limited anymore. |
| **FEFO eligibility** | `fefoAllocation.service.ts` excludes **expired** lots (`expDate > new Date()`), **active recall** without release, and **pending QC hold** qty. |
| **Lot listing on GET** | Loads `stockLotBalance` with `lot: { orgId: request.orgId, variantId: { in: variantIds } }` — **hard-scoped to the stock request’s org**, not to the source location’s branch org at query time. |
| **INSUFFICIENT_STOCK** | Emitted when computed `max <= 0` for a line (`stock_requests.service.ts` ~331–343). |

### Suspected primary regression (cross-org / wrong source list)

**`GET /api/v1/inventory/locations` → `getInventoryLocations(userId)`** (`inventory.service.ts`):

- Resolves **one** owner org via `prisma.organization.findFirst({ where: { ownerUserId } })` — **undefined order** if the user owns **multiple** `Organization` rows.
- Loads **all** branches only for **that** org; **other owned orgs’ branches (and their hub locations) never appear** — or the **wrong** org is chosen arbitrarily.
- The owner page defaults `fromLocationId` to **`locations[0]`** with **no `orderBy`** on the API — **non-deterministic default**.

**Failure mode:** User selects a location that belongs to **org A** while `StockRequest.orgId` is **org B**. Availability queries filter lots with **`lot.orgId = request.orgId` (B)** at `fromLocationId`. If that location’s balances are for lots with **org A**, the join returns **no rows** → **0 / 0 / 0** and dispatch validation fails — even though “Central Hub” appears to have stock in another screen or org.

This explains “fixed once, regressed” if **multi-org**, **org switch**, or **`findFirst` ordering** changed (data or DB default order).

### Suspected secondary causes (single-org or after org is correct)

| Cause | Why it yields zeros |
|--------|---------------------|
| **Wrong `fromLocationId`** | Stock lives on a **different** `inventoryLocation.id` (duplicate labels, multiple hubs). |
| **Expired lots only** | FEFO total = 0; aggregate book also 0. |
| **All qty blocked** | `reservedQty` + QC holds + recall consume effective qty to 0. |
| **Variant mismatch** | Request line `variantId` ≠ catalog variant on hand (bad seed / migration). |
| **Legacy `inventory` table only** | Documented: fulfillment reads **`StockBalance` / `StockLotBalance`** only. |
| **Pool split (`maxDispatchableByItemId`)** | Multiple **REQUESTED** lines sharing one variant split a **non-zero** pool — later lines can show 0 **max** while variant has stock (by design); less likely if **all** variants 0. |

---

## 5. Exact files involved

### Frontend (`bpa_web`)

| File | Role |
|------|------|
| `app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` | Loads locations + detail; **`fromLocationId` query** on refresh; renders grid from `availableLotsByVariant`, `aggregateStockByVariant`, `maxDispatchableByItemId`; **manualMode** toggle; **PATCH fulfill**. |
| `app/owner/_lib/ownerApi.ts` | `ownerGet` / `ownerPatch` — same-origin `/api/v1`, `cache: "no-store"`. |

### Backend (`backend-api`)

| File | Role |
|------|------|
| `src/api/v1/modules/stock_requests/stock_requests.controller.ts` | `GET /:id` passes `fromLocationId`; `PATCH /:id/fulfill` body. |
| `src/api/v1/modules/stock_requests/stock_requests.service.ts` | `getRequestById`, `fulfillStockRequestFlexible`, `getMaxDispatchableQty`, `expandQtyToDispatchLines`. |
| `src/api/v1/modules/inventory/fefoAllocation.service.ts` | `getFefoEligibleLotTotal`, `allocateVariantFifo`. |
| `src/api/v1/modules/inventory/stockAvailability.service.ts` | Recall freeze, QC holds (`getPendingQcHoldByLot`). |
| `src/api/v1/modules/inventory/inventory.controller.ts` | `getInventoryLocations`. |
| `src/api/v1/modules/inventory/inventory.service.ts` | **`getInventoryLocations`** (owner org `findFirst` + branches). |
| `src/api/v1/modules/inventory/inventory.routes.ts` | Routes for `/inventory/locations`. |
| `bpa_web/app/api/v1/[[...path]]/route.js` | Proxies to API; **forwards query string** (`url.search`). |

### Reference docs

| File | Role |
|------|------|
| `docs/stock-request-availability-zero-root-cause-fix-plan.md` | Earlier **manual vs lot** analysis; implementation status should be cross-checked against current service. |

---

## 6. Exact APIs involved

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/v1/inventory/locations` | Owner source location dropdown (**no `orgId` / request context** today). |
| GET | `/api/v1/stock-requests/:id` | Base detail (no availability blocks). |
| GET | `/api/v1/stock-requests/:id?fromLocationId=<n>` | Detail + **`availableLotsByVariant`**, aggregates, max dispatch. |
| PATCH | `/api/v1/stock-requests/:id/fulfill` | Body: `fromLocationId`, `toLocationId`, `manualMode`, `items`, `extraItems`. |
| GET | `/api/v1/inventory/stock-request-products?branchId=` | Extra-line product picker (separate). |

---

## 7. Exact params that must flow correctly

| Param | Source | Must match |
|--------|--------|------------|
| `fromLocationId` | Query (GET) / body (PATCH) | Real `inventoryLocation.id` under **same org** as `StockRequest.orgId` where stock is booked. |
| `toLocationId` | Body | Destination branch location (UI uses `branch.inventoryLocations[0]` — confirm branch has active locations). |
| `StockRequest.orgId` | DB | Must equal **`stock_lots.orgId`** for lots counted at hub. |
| `variantId` (lines) | DB | Must match hub `stock_lot_balances` / `stock_balances` variant. |
| `manualMode` | Body | Affects **dispatch line expansion**, not GET preview (GET does not take manualMode — intentional). |

---

## 8. Data model / stock calculation findings

- **Authoritative for this flow:** `StockBalance` (non-lot book), `StockLot`, `StockLotBalance` (lot-tracked), with exclusions in `fefoAllocation.service.ts` and `stockAvailability.service.ts`.
- **Org key:** `getRequestById` filters lots with **`lot.orgId = request.orgId`**. Any hub stock tied to lots with a **different** `orgId` will not count toward this request.
- **Display vs FEFO:** GET builds lot rows from `stockLotBalance` without the same **`expDate > now`** filter as FEFO in the first query — UI may still show **expired** lines with flags; **max** uses FEFO rules → possible **non-zero display / zero max** for edge cases; not the typical “all zeros” case.

---

## 9. Source location scoping findings

- **Backend:** `resolveOrgIdForLocation` exists (`stockAvailability.service.ts`) but is **not** used in `getRequestById` to validate **fromLocationId.org === request.orgId**.
- **Frontend:** Loads locations **before** request org is known in parallel; default **`locations[0]`** is arbitrary.
- **Risk:** Owner can select a location **outside** the request’s org if the API ever returns a mixed list (multi-org bug) or if labels are ambiguous.

---

## 10. Manual mode vs FEFO findings

- **GET detail:** Does not accept `manualMode`; shows both raw lot list and **unified** max — correct for planning.
- **Fulfill:** `manualMode` true → prefer non-lot when `fulfillQty <= aggregate`; else **FEFO** (`expandQtyToDispatchLines`). **Max** already uses lot + aggregate max regardless — aligned with prior fix doc.
- **Regression:** If symptoms persist with **manual on/off**, root cause is **not** the old manual-only cap; look at **org/location/variant** or **eligibility** (expired/recall/QC).

---

## 11. UI / API contract mismatches

| Topic | Mismatch risk |
|--------|----------------|
| Response shape | Page uses `res?.data ?? res` — OK if API returns `{ success, data }`. |
| Numeric keys | `lotsByVariant[variantId]` — JSON keys are strings; JS coerces — low risk. |
| **Locations list vs request org** | **High risk:** UI does not pass **`orgId` from request** into locations API (API does not support it). |
| Default location | **First** location in unordered list may not be Central Hub — user must change selection; if list is wrong org, selection never fixes zeros. |

---

## 12. Regression source analysis

1. **Prior fix** (`stock-request-availability-zero-root-cause-fix-plan.md`): Addressed **manual mode** and **lot-only** stock **within one org** — reflected in current `getMaxDispatchableQty` / `expandQtyToDispatchLines`.
2. **If that fix is present but the bug returned:** Likely **different layer** — **source location list / org scoping**, **data** (org on lots), or **environment** (multi-org owner).
3. **Duplicate logic:** `getFefoEligibleLotTotal` vs `getRequestById` lot query are **aligned** on org + variant + location; **inventory summary** paths elsewhere (`inventory.service.ts`) may differ — recommend **one public “availability at location”** helper long-term to avoid drift.

---

## 13. Step-by-step implementation plan (future — not executed here)

1. **Reproduce with logging (temporary):** Log `request.orgId`, `fromLocationId`, `resolveOrgIdForLocation(fromLocationId)`, `variantIds`, and `getFefoEligibleLotTotal` per variant on a failing request (remove after fix).
2. **Validate hypothesis A (multi-org):** For affected user, count `Organization` where `ownerUserId = U`. If > 1, confirm `findFirst` org vs `StockRequest.orgId`.
3. **Fix locations API:** Add optional `orgId` (or `stockRequestId`) query; **verify** owner may access that org; return only that org’s locations **or** union all owned orgs with **`branch.orgId`** in payload for client filtering.
4. **Fix owner page:** After loading request, call locations with **`orgId=request.orgId`** (or filter client-side); default `fromLocationId` to **preferred hub** for that org if product rules allow (optional); sort locations deterministically (e.g. hub first).
5. **Guardrail:** In `getRequestById` or fulfill, if `resolveOrgIdForLocation(fromLocationId) !== request.orgId`, return **400** with clear code `SOURCE_LOCATION_ORG_MISMATCH` (or attach zeros + **explicit warning** — prefer hard error on fulfill).
6. **Data fixes:** If lots have wrong `orgId`, run targeted correction / GRN replay per ops (out of scope unless confirmed).
7. **Consolidation (optional):** Extract shared “effective qty at location for variant” used by GET + fulfill + FEFO.

---

## 14. Risk notes

- **Breaking change:** Stricter org validation on fulfill may **block** previously “working” but unsafe cross-org dispatches.
- **`Math.max(aggregate, lot)`** can overstate if ledger diverges — pre-existing operational risk.
- **Multiple REQUESTED lines same variant:** Per-line max can be **less** than variant total — support/training, not necessarily bug.

---

## 15. Regression checklist (post-fix)

- [ ] Single-org owner: hub with **lot-only** stock shows **max dispatch > 0**, dispatch succeeds.
- [ ] Single-org: **non-lot only** stock works; manual vs FEFO both.
- [ ] Multi-org owner: locations list only includes **request’s org**; hub selection shows **non-zero** when stock exists.
- [ ] Wrong-org location cannot be used for fulfill (error or empty list).
- [ ] Changing `fromLocationId` refetches detail and updates grid.
- [ ] Expired-only / full QC / full recall still correctly shows **0** dispatchable.

---

## 16. Manual test scenarios

1. **Happy path:** Org with one hub + one clinic; GRN into hub lots; submit stock request; open owner detail; select hub; verify lot sum and max > 0; fulfill.
2. **Multi-org:** Two orgs under same owner; stock request org **Org2**; open detail; confirm dropdown **does not** default to **Org1** hub; select **Org2** hub; availability non-zero.
3. **Expired lots:** Hub only expired lots → expect **0** FEFO max; confirm messaging.
4. **Duplicate variant lines:** Two REQUESTED lines same variant; verify **pool split** on max column.
5. **Reload:** Change source location → grid updates; “Reload availability” matches.

---

## 17. Seed / data validation requirements

- Verify `stock_requests.orgId` = `branches.orgId` for destination branch.
- Verify `inventory_locations.branchId` → `branches.orgId` for source location matches request org.
- Verify `stock_lots.orgId` = request org for hub receipts.
- Spot-check `stock_lot_balances` for `(locationId, variantId)` at Central Hub location id used in UI.

---

## Implementation order (when approved)

1. Confirm root cause with DB checks (org mismatch vs expiry vs wrong `locationId`).
2. Backend: `getInventoryLocations` — support **`orgId`** (or derive from `stockRequestId`); document `findFirst` hazard.
3. Frontend: pass **`orgId`** from loaded request into locations fetch; deterministic sort + smarter default (optional).
4. Backend: optional **org match guard** on fulfill / enrich.
5. Smoke tests and manual scenarios above.

---

## Files to change (provisional — after root-cause confirmation)

| Area | Files |
|------|--------|
| Locations API | `inventory.controller.ts`, `inventory.service.ts`, `inventory.routes.ts` (if query added) |
| Owner page | `bpa_web/app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` |
| Guardrail | `stock_requests.service.ts` (fulfill and/or `getRequestById`) |
| Tests | Jest tests for `getInventoryLocations` with multiple orgs; integration test for GET detail with `fromLocationId` |

---

## Smoke tests to run

- **API:** `GET /api/v1/inventory/locations?orgId=<requestOrg>` (once implemented) vs old behaviour.
- **API:** `GET /api/v1/stock-requests/:id?fromLocationId=<hub>` — body contains non-empty `maxDispatchableByVariant` when DB has balances.
- **E2E:** Owner flow: open request → select hub → grid non-zero → fulfill → transfer created.

---

*End of plan.*
