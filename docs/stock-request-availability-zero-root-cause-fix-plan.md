# Stock request fulfillment — zero availability root cause & fix

## 1. Executive summary

The owner fulfillment screen at `/owner/inventory/stock-requests/:id` showed **Lot avail. = 0**, **Aggregate = 0**, and validation **“available 0”** for Central Hub even when stock existed because:

1. **Manual mode capped availability on `StockBalance` only** (`getMaxDispatchableQty` returned aggregate `onHandQty` when `manualMode === true`). Enterprise hubs often hold stock **only in `StockLotBalance`** (lot-tracked GRNs). `StockBalance` can be **0 or missing** while FEFO-eligible lot quantity is **> 0**.
2. **Manual mode dispatch expansion always used non-lot lines** (`lotId: null`), which **`sendTransfer` resolves only against `StockBalance`**. So even if validation were fixed, lot-only stock could not ship via non-lot lines.
3. **Non-manual (FEFO) path already used `Math.max(aggregate, getFefoEligibleLotTotal)`**, so toggling manual mode incorrectly flipped from “can see lot stock” to “cannot.”
4. **`getRequestById` aggregate display** used raw `stock_balances` only; it did not expose the **same “max dispatchable”** figure used for validation, so the UI stayed at 0 for lot-only inventory.
5. **Lot listing for the detail response** did not scope `StockLot` by **`orgId`**, risking inconsistency with FEFO queries (`lot: { orgId, variantId }`).

**Legacy `Inventory` (branch-level, pre–stock-balance)**: not used by this fulfillment path. If any environment only updated `inventory` rows, that would be a separate data/migration gap; this fix aligns code with **`StockBalance` + `StockLotBalance`** as documented sources of truth.

---

## 2. Exact root cause(s)

| # | Cause | Effect |
|---|--------|--------|
| R1 | `getMaxDispatchableQty(..., manualMode)` returned **only** `StockBalance.onHandQty` when `manualMode` | Max available = 0 for lot-only stock; line validation failed with “available 0”. |
| R2 | `expandQtyToDispatchLines` for `manualMode` **always** returned `{ lotId: null }` | Dispatch used aggregate path only; could not consume lot balances. |
| R3 | `getRequestById` set `aggregateStockByVariant` from **`StockBalance` only** | “Aggregate” column showed 0 though lots had quantity. |
| R4 | `availableLotsByVariant` query did not filter `lot.orgId` | Could diverge from FEFO (`getFefoEligibleLotTotal`) in edge cases. |

---

## 3. Frontend issues

- **Labels**: “Aggregate” implied total at location; it reflected **non-lot book row** only.
- **Manual switch**: Copy said “non-lot dispatch from aggregate stock” — correct for **pure aggregate**, but users expect “don’t pick lots myself” while stock may be **lot-held only**.

**Fix (UI):** Surface **`maxDispatchableByVariant`** from API; clarify aggregate vs max dispatch; adjust manual-mode helper text to state that **FEFO allocation is used when aggregate is insufficient**.

---

## 4. API / client issues

- **Endpoints used:** `GET /api/v1/stock-requests/:id?fromLocationId=` — query param name matches controller (`fromLocationId`). No client bug found.
- **Response mapping:** `aggregateStockByVariant` and `availableLotsByVariant` consumed correctly; missing field **`maxDispatchableByVariant`** for display parity with validation.

---

## 5. Backend / service / query issues

- **`getMaxDispatchableQty`:** Unified to **`Math.max(aggregate, getFefoEligibleLotTotal)`** for implicit allocation (no explicit lot list). Removed incorrect manual-only aggregate branch.
- **`expandQtyToDispatchLines` (manual):** If `fulfillQty <= aggregate`, non-lot line(s); else **`allocateVariantFifo`** for full quantity (same as operational “auto FEFO” when user does not pick lots).
- **`getRequestById`:** Scope lots by `request.orgId`; compute and attach **`maxDispatchableByVariant`**.

---

## 6. Data / model issues

- **Expected:** Central Hub stock in **`stock_lots` + `stock_lot_balances`** (+ optional **`stock_balances`**).
- **If stock exists only in legacy `inventory`:** This flow does not read it — requires migration/GRN replay into lot/balance tables (out of scope unless product requires dual read).

---

## 7. Location / variant mapping

- **Inventory locations** list comes from `GET /api/v1/inventory/locations` (owner’s org branches). `fromLocationId` must match **`inventory_locations.id`** where **`stock_lot_balances` / `stock_balances`** rows exist. Wrong location still yields 0 — **by design**.

---

## 8. Manual mode vs lot (FEFO) mode

- **Intended:** Manual = user does not specify lots; **may still ship from lots** via system FEFO when aggregate is insufficient.
- **Previous bug:** Manual = aggregate-only cap + non-lot dispatch only → **broken for lot-only stock**.

---

## 9. Files to change

| File | Change |
|------|--------|
| `src/api/v1/modules/stock_requests/stock_requests.service.ts` | `getMaxDispatchableQty`, `expandQtyToDispatchLines`, `getRequestById` |
| `bpa_web/app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` | Display `maxDispatchableByVariant`, copy |
| `docs/stock-request-availability-zero-root-cause-fix-plan.md` | This document |

---

## 10. Implementation order

1. Service: unified max dispatchable + manual expand FEFO fallback + org-scoped lots + `maxDispatchableByVariant` on detail.
2. UI: show max dispatch + text tweaks.
3. Verify with hub that has lot balances at selected `fromLocationId`.

---

## 11. Verification checklist

- [ ] Detail loads with `fromLocationId` set to Central Hub location that has `stock_lot_balance` rows for request variants.
- [ ] `maxDispatchableByVariant` > 0 when lots exist and aggregate is 0.
- [ ] Lot avail. sums positive when raw lot rows exist (org-scoped).
- [ ] Manual mode: fulfillment succeeds using FEFO when aggregate is 0 and lots exist.
- [ ] FEFO mode (manual off): unchanged behavior for lot allocation.
- [ ] Changing source location changes availability.
- [ ] Genuine zero stock still rejects/clamps correctly.
- [ ] No hardcoded stock; no validation disabled.

---

## 12. Remaining risks

- **Data sync:** If `StockBalance` and sum of lots diverge (bad ledger), `Math.max` can overstate — same as pre-fix non-manual path; operational fix is ledger reconciliation.
- **Mixed aggregate + lots for same physical pool:** Rare; split dispatch not implemented — rely on consistent ledger.
