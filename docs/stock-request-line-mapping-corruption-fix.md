# Stock request line mapping / fulfilledQty corruption — forensic fix

**Date:** 2026-03-29
**Target:** Owner fulfillment `PATCH /api/v1/stock-requests/:id/fulfill` and legacy `POST .../dispatch`

## 1. Exact root cause (mixed: backend primary, legacy path severe)

### A. `fulfillStockRequestFlexible` — `fulfilledQty` overwrite

After a successful transfer, the service aggregates dispatched quantities per `stockRequestItemId` and runs:

```typescript
data: { fulfilledQty: qty }
```

`qty` is only the **current transfer’s** sum for that item. This **replaces** the column instead of **adding** to prior `fulfilledQty`.

**Effects:**

- Multi-wave dispatch: later waves **overwrite** earlier fulfillment counts instead of accumulating.
- Any scenario where the UI or API sends cumulative-looking quantities can produce nonsense totals.

### B. `fulfillAndDispatch` (legacy) — variant-wide write to every line

```typescript
const qtyByVariant = new Map<number, number>();
// ... sum quantities per variantId from transfer items

for (const line of request.items) {
  if (lk === "EXTRA") continue;
  const sent = qtyByVariant.get(line.variantId) ?? 0;
  await prisma.stockRequestItem.update({
    where: { id: line.id },
    data: { fulfilledQty: sent },
  });
}
```

For every **REQUESTED** line with the same `variantId`, `sent` is the **full** quantity shipped for that variant on the transfer. Each line gets the **same** `fulfilledQty`.

**Example:** Two lines: variant 287, requested 50 and 100. One transfer ships 180 units of 287. **Both** lines get `fulfilledQty = 180`. One line then shows OVER_FULFILLED (180 > 50); the other is wrong too.

This matches symptoms like “Item #17 dispatching 230 exceeds requestedQty 50” with `fulfilledQty = 230` on a single line when totals were applied from **variant** aggregation.

### C. VariantId fallback in `fulfillStockRequestFlexible`

If `stockRequestItemId` is missing, the code resolves the row with:

```typescript
workingItems.find((i) => i.variantId === fi.variantId && (i.lineKind === "REQUESTED" || i.lineKind == null))
```

`find` returns the **first** matching line. All fulfillment for that variant can be attributed to the wrong `stockRequestItemId`, corrupting `byItemId` aggregates.

### D. Frontend key stability

`fulfillByItemId` uses `row.id` as object keys. If `id` is ever a string from JSON, lookups can miss (`17` vs `"17"`). Normalizing with `Number(row.id)` avoids subtle mismatches.

### E. Availability warnings vs duplicate variants

`maxDispatchableByVariant` is shared across all lines with the same variant. `lineWarnings` still use per-variant max for each line, so with **duplicate variants** every line shows the same “available” pool — misleading but separate from fulfilledQty corruption. A follow-up can add per-line pool consumption (see Phase 2 optional).

## 2. Corrupted write path

| Path | Mechanism |
|------|-----------|
| Flexible fulfill | `stockRequestItem.update({ fulfilledQty: qty })` replacement |
| Legacy dispatch | Same `fulfilledQty: sent` for every line sharing `variantId` |
| Flexible fulfill | Wrong item when `stockRequestItemId` omitted + duplicate variants |

## 3. Classification

- **Backend:** Primary (overwrite + legacy variant fan-out + optional wrong row).
- **Frontend:** Minor (numeric id normalization).
- **Data:** Existing rows may already be wrong; repair by apportioning from `stock_transfers` + `stock_transfer_items` or manual reset (documented below).

## 4. Files changed

- `src/api/v1/modules/stock_requests/stock_requests.service.ts` — increment `fulfilledQty`, require `stockRequestItemId` for flexible items, legacy apportion + increment, optional `maxDispatchableByItemId` for detail.
- `app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` — `Number(row.id)` for item keys and payload.

## 5. Safe data repair (request #2 or any affected request)

Transfer lines do **not** store `stockRequestItemId`, only `variantId` and `quantitySent`. Exact reconstruction per line is ambiguous if multiple lines share a variant.

**Option A — reset and re-dispatch (safest if business allows)**

```sql
UPDATE stock_request_items
SET "fulfilledQty" = 0
WHERE "stockRequestId" = <id>;
```

Then re-run fulfillments after code fix (only if transfers can be reversed or are acceptable as historical only).

**Option B — apportion by variant total (heuristic)**

For each `stockRequestId`, sum `quantitySent` per `variantId` across linked `stock_transfers` in chronological order, then walk `stock_request_items` for that variant ordered by `id`, allocating `min(remaining_requested - fulfilled_snapshot, left_to_allocate)` and writing apportioned `fulfilledQty`. Use a one-off script; validate totals match sum of transfer lines per variant.

## 6. Verification checklist

1. Two REQUESTED lines, same variant: dispatch line A only → only A’s `fulfilledQty` increases.
2. Same, second wave on line B → B increments; A unchanged.
3. Extra lines: `fulfilledQty` on EXTRA rows increments; REQUESTED lines unchanged unless explicitly fulfilled.
4. Owner payload always includes `stockRequestItemId` for requested lines.
5. Legacy dispatch: apportions variant qty across lines in `id` order with increment.

---

## 7. Phase 2 — Implemented (2026-03-29)

| Change | Detail |
|--------|--------|
| `fulfillStockRequestFlexible` | `fulfilledQty` uses **`increment`** from per-line `byItemId` sums (multi-wave safe). |
| | **Require `stockRequestItemId`** on every fulfill `items[]` entry; removed variant-only `find()` fallback. |
| | Request status / summary use **cumulative** fulfilled totals (`prior + this wave`). |
| | **Over-fulfillment** warning uses `priorFulfilledQty + applied` vs `requestedQty`. |
| `fulfillAndDispatch` | Uses **`apportionLegacyDispatchQtyByLine`** + **`increment`** per item (no duplicate-variant mirror writes). |
| `getRequestById` | Adds **`maxDispatchableByItemId`** (shared pool split in stable `id` order); line warnings use **remaining** need; summary `totalMaxDispatchable` uses per-item caps. |
| Owner UI | **`Number(row.id)`** for `fulfillByItemId` and payload; **`maxDispatchableByItemId`** for “Max dispatch”; delta vs **remaining**; **`FULFILLED_PARTIAL`** allows further dispatch; decline only pre-partial. |

**Data repair:** If rows are already wrong, reset or apportion per section 5, then re-test dispatch with the new build.
