# Stock request fulfilledQty — data repair and verification

**Date:** 2026-03-29
**Related:** `docs/stock-request-line-mapping-corruption-fix.md` (code fix), `scripts/repair-stock-request-fulfilled-qty.js` (data repair)

---

## 1. Purpose

After fixing fulfillment **code** (increment per line, legacy apportion, required `stockRequestItemId`), historical `stock_request_items.fulfilledQty` values may still not match **what was actually transferred** (`stock_transfer_items.quantitySent`). This document:

1. Defines how to **audit** affected requests.
2. Describes the **repair** script (dry-run + apply).
3. Records **verification** results for this environment.

**Safety rules:** no deletes, no DB reset, only `UPDATE` on clearly scoped `stock_request_items` rows, with dry-run first.

---

## 2. Source of truth

For a given `stock_request_id`:

- **Truth for “how much shipped”** per variant:
  `SUM(stock_transfer_items.quantitySent)` joined to `stock_transfers` where `stockRequestId = :id`, grouped by `variantId`.
- **Truth for “how to split across lines”** (when transfer rows do not carry `stockRequestItemId`):
  Stable **`id` order** among `stock_request_items` for that variant:
  1. **REQUESTED** lines first (`lineKind != 'EXTRA'`): apportion like legacy fix — fill each line up to `requestedQty - cancelledQty` except the **last** REQUESTED line for that variant, which receives any **remainder** (over-fulfillment allowed on that line).
  2. If **EXTRA** lines exist for the same variant, they receive quantity **after** REQUESTED lines are capped as above; remainder is split across multiple EXTRA lines evenly (integer split).

This matches the intent of `apportionLegacyDispatchQtyByLine` + EXTRA remainder handling in `scripts/repair-stock-request-fulfilled-qty.js`.

---

## 3. Audit — find potentially corrupted requests

### 3.1 Requests with linked transfers

```sql
SELECT DISTINCT sr.id, sr.status
FROM stock_requests sr
INNER JOIN stock_transfers st ON st."stockRequestId" = sr.id
ORDER BY sr.id;
```

### 3.2 Per-request: compare line fulfilled vs transfer-derived apportion

Run the repair script in **dry-run** (default):

```bash
cd backend-api
node scripts/repair-stock-request-fulfilled-qty.js --dry-run
```

For a single request:

```bash
node scripts/repair-stock-request-fulfilled-qty.js --dry-run --request-id=2
```

**Interpretation:**

- If the script prints **no line updates** for a request, current `fulfilledQty` already matches transfer-derived apportion (or there are no transfers).
- If it prints `item X: before -> after`, those lines are **candidates** for repair.

### 3.3 Legacy bug signature (manual SQL)

**Duplicate variant on multiple REQUESTED lines with identical `fulfilledQty`** (and equal to variant total) often indicated the old “mirror variant total to every line” bug:

```sql
WITH r AS (
  SELECT "stockRequestId", "variantId", "fulfilledQty", id,
         COUNT(*) OVER (PARTITION BY "stockRequestId", "variantId") AS nlines
  FROM stock_request_items
  WHERE "lineKind" <> 'EXTRA'
)
SELECT * FROM r WHERE nlines > 1;
-- Then inspect whether fulfilledQty matches implausible patterns.
```

### 3.4 Classification

| Situation | Repair method | Risk |
|-----------|---------------|------|
| `fulfilledQty` ≠ proposed from transfers | Run script `--apply` after dry-run review | Low if transfers are correct; wrong if transfers are wrong |
| No transfers but `fulfilledQty` > 0 | **Not** handled by script; investigate manually | May need business decision |
| Over-fulfillment (e.g. fulfilled 230, requested 50) with transfer sum 230 | Script keeps 230 on the only REQUESTED line for that variant | Correct if transfer is correct |

---

## 4. Repair script

**File:** `scripts/repair-stock-request-fulfilled-qty.js`

| Mode | Command |
|------|---------|
| Dry-run (default) | `node scripts/repair-stock-request-fulfilled-qty.js --dry-run` |
| Single request | `node scripts/repair-stock-request-fulfilled-qty.js --dry-run --request-id=2` |
| Per-line proof (db vs proposed) | Add `--verbose` (prints every line even when no UPDATE needed) |
| Apply updates | `node scripts/repair-stock-request-fulfilled-qty.js --apply --request-id=2` |

**Behavior:**

- Selects stock requests that have **at least one** `stock_transfers` row with `stockRequestId` set.
- Computes variant totals from `stock_transfer_items`.
- Computes proposed `fulfilledQty` per item (see §2).
- **Dry-run:** prints differences only; **no writes**.
- **Apply:** runs `UPDATE stock_request_items SET "fulfilledQty" = $1, "updatedAt" = NOW()` per changed line in a **transaction** per request.

**Not in scope:**

- Deleting or inserting rows.
- Requests with **no** linked transfers (nothing to reconcile from).
- Rewriting `stock_transfers` / `stock_transfer_items`.

---

## 5. Phase 3 verification — this environment (2026-03-29)

### 5.1 Dry-run (all linked requests)

- **Requests with transfers:** 2 (`#1`, `#2`).
- **Line updates proposed:** **0** (DB already matches transfer-derived apportion).

### 5.2 Request #2 — sample DB vs transfers

| Item id | lineKind | variant | requested | fulfilled | Notes |
|---------|----------|---------|-----------|-----------|--------|
| 15 | REQUESTED | 277 | 150 | 50 | Transfer sum variant 277 = 50 |
| 16 | REQUESTED | 194 | 300 | 50 | Transfer sum variant 194 = 50 |
| 17 | REQUESTED | 340 | 50 | 230 | Transfer sum variant 340 = 230 (**over-fulfillment** vs requested 50) |
| 18–19 | EXTRA | 203, 287 | 0 | 0 | No transfer rows for these variants |
| 20 | EXTRA | 320 | 0 | 10 | Transfer sum variant 320 = 10 |

**Conclusion:** Request **#2** is **consistent** with inventory transfers. The “230 vs 50” line is **intentional over-fulfillment** relative to requested quantity, not a line-mapping split error, given current transfer totals.

### 5.3 End-to-end checks (manual)

1. Owner stock request detail for **#2** with **Central Hub** as source: availability reflects seeded stock (non-zero where stock exists).
2. **Partial / second dispatch:** new code uses **increment**; confirm in UI after a second partial wave.
3. **Duplicate variant lines:** distinct `stockRequestItemId` in payload; per-line `maxDispatchableByItemId` where applicable.
4. **EXTRA** lines: separate `lineKind`; repair script allocates variant remainder after REQUESTED caps.

---

## 6. Files

| File | Role |
|------|------|
| `scripts/repair-stock-request-fulfilled-qty.js` | Dry-run / apply repair |
| `docs/stock-request-data-repair-and-verification.md` | This document |
| `docs/stock-request-line-mapping-corruption-fix.md` | Code-level fix reference |

---

## 7. When to run `--apply`

1. Dry-run shows non-zero line updates for a request.
2. Stakeholders confirm **transfer rows** are the business truth.
3. Apply for a **single** request first (`--request-id=`), re-check UI, then batch if needed.

If dry-run shows **0** changes, **do not** apply — data already matches the reconciliation model.
