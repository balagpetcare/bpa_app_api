# Stock Request Zero-Availability Forensic Fix

**Date:** 2026-03-29
**Target:** Owner stock request detail page — `http://localhost:3104/owner/inventory/stock-requests/[id]`
**Status:** RESOLVED

---

## Executive Summary

The owner stock request detail page showed `available 0` for all three variants in request #2 (variant 277, 194, 340). This was diagnosed as a **data issue, not a code bug**. The backend availability pipeline is correct but there was literally zero stock in the database for these variants.

---

## Root Cause

**No stock existed in the database for the requested variants.**

| Table | Variant 277 | Variant 194 | Variant 340 |
|---|---|---|---|
| `stock_balances` | 0 rows | 0 rows | 0 rows |
| `stock_lot_balances` | 0 rows | 0 rows | 0 rows |
| `stock_lots` | 0 rows | 0 rows | 0 rows |

The stock request items reference products (Acana Dog Training Treats, Advantage Cat Treats, Acana Senior Dog Food) that **were never received into inventory via GRN**. The system had 16 stocked variants at the Central Hub, totaling 57,051 units, but none belonged to these three products.

### Why this appeared as a "bug"

The test stock requests were created (likely via the staff stock-request-create flow) pointing to valid catalog products. However, no goods receipt (GRN) was ever processed for those products at the Central Hub, so no `stock_balance` or `stock_lot_balance` rows were created.

The backend correctly returned `maxDispatchable = 0` because that is the truth.

---

## Audit Trail

### 1. Frontend behavior — CORRECT

- Page calls `GET /api/v1/stock-requests/2?fromLocationId=2` on load
- Frontend correctly reads `aggregateStockByVariant`, `maxDispatchableByVariant`, `availableLotsByVariant` from response
- `fromLocationId` defaults to the first location from `GET /api/v1/inventory/locations` (Location #2, Central Hub)
- No key type mismatch (JS auto-coerces number keys)
- No stale location ID issue

### 2. Backend service — CORRECT

- `getRequestById()` fetches `stockBalance.findMany` for the variant IDs at the given location
- `getMaxDispatchableQty()` computes `max(FEFO lot total, aggregate balance)` — returns 0 when both are 0
- `getFefoEligibleLotTotal()` queries `stockLotBalance` with expiry/recall/QC exclusions — returns 0 when no lots exist
- All queries use the correct `locationId` and `variantId` parameters

### 3. Database truth — CONFIRMED EMPTY

```
Variant 277: NO stock_balance rows, NO lot rows
Variant 194: NO stock_balance rows, NO lot rows
Variant 340: NO stock_balance rows, NO lot rows
```

### 4. Location mapping — CORRECT

- Central Hub = Location #2 = `"Bala G Limited, Central Hub - Main"` (type: CENTRAL_WAREHOUSE, branch: 2, org: 1)
- Branch shop = Location #4 = `"Bala G Pet Clinic, Rampura - Main"` (type: SHOP, branch: 1, org: 1)
- Frontend defaults to Location #2 as `fromLocationId` — correct for owner fulfillment

---

## Fix Applied

Seeded stock data for all 16 variant lines across requests #1 and #2 at the Central Hub (Location #2):

| Variant | Product | Stock Seeded | Lot Created |
|---|---|---|---|
| 38 | Acana Grain-Free Adult Dog Food (4kg) | 500 | Yes |
| 86 | Blue Buffalo Dental Chews (28 pieces) | 500 | Yes |
| 194 | Advantage Cat Treats (50g) | 900 | Yes |
| 198 | Frontline Cat Treats (200g) | 500 | Yes |
| 208 | Acana Cat Treats (50g) | 500 | Yes |
| 209 | Acana Cat Treats (120g) | 500 | Yes |
| 210 | Acana Cat Treats (200g) | 500 | Yes |
| 277 | Acana Dog Training Treats (100g) | 500 | Yes |
| 278 | Acana Dog Training Treats (250g) | 500 | Yes |
| 315 | Advantage Senior Dog Food (8kg) | 500 | Yes |
| 320 | Frontline Senior Dog Food (4kg) | 14000 (existing) | Skipped |
| 322 | Wellness Senior Dog Food (1.5kg) | 500 | Yes |
| 323 | Wellness Senior Dog Food (4kg) | 500 | Yes |
| 324 | Wellness Senior Dog Food (8kg) | 500 | Yes |
| 340 | Acana Senior Dog Food (1.5kg) | 500 | Yes |
| 341 | Acana Senior Dog Food (4kg) | 500 | Yes |

Each seeded variant has:
- A `stock_balance` row at Location #2 with the specified `onHandQty`
- A `stock_lot` with 12-month expiry, 2-month-old mfg date
- A `stock_lot_balance` at Location #2 matching the aggregate

---

## Post-Fix Verification

For request #2 with `fromLocationId = 2`:

| Variant | Requested | Aggregate | Lot Total | Max Dispatch | Status |
|---|---|---|---|---|---|
| 277 | 150 | 500 | 500 | 500 | SUFFICIENT |
| 194 | 300 | 900 | 900 | 900 | SUFFICIENT |
| 340 | 50 | 500 | 500 | 500 | SUFFICIENT |

---

## Classification

- **Issue type:** Data (missing stock), not code
- **Frontend code:** No changes needed
- **Backend code:** No changes needed
- **Database:** Stock data seeded via `scripts/seed-test-stock.js`
- **Schema:** No changes needed

---

## Files Changed

- `scripts/seed-test-stock.js` — Idempotent stock seeding script (new)
- `scripts/forensic-stock-audit.js` — Diagnostic script (new, can be deleted)
- `scripts/forensic-stock-wider.js` — Diagnostic script (new, can be deleted)
- `scripts/forensic-request1.js` — Diagnostic script (new, can be deleted)
- `scripts/verify-api-response.js` — Verification script (new, can be deleted)
- `scripts/check-schema.js` — Schema check script (new, can be deleted)
- `docs/stock-request-zero-availability-forensic-fix.md` — This document (new)

---

## Manual QA Checklist

1. [ ] Open http://localhost:3104/owner/inventory/stock-requests/2
2. [ ] Verify "From location" dropdown defaults to "Bala G Limited, Central Hub - Main"
3. [ ] Verify Lot avail, Book stock, and Max dispatch columns show non-zero values
4. [ ] Verify variant 277 shows 500 available
5. [ ] Verify variant 194 shows 900 available
6. [ ] Verify variant 340 shows 500 available
7. [ ] Click "Reload availability" — values should persist
8. [ ] Toggle Manual mode — should not change availability numbers
9. [ ] Click "Auto-fill FEFO" — should populate fulfill qty from lot availability
10. [ ] Click "Fulfill & Dispatch" — should succeed without zero-stock errors
