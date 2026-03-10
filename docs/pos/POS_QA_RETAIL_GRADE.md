# POS Retail-Grade — QA (P3–P6)

Step-by-step manual tests for retail-grade upgrades. Core POS flows remain covered by [POS_QA_MANUAL_SCRIPT.md](./POS_QA_MANUAL_SCRIPT.md).

**Prerequisites:** Same as core (migrations, branch with SHOP location, products/variants/stock/prices, BranchMember with POS permissions). For P3 shift tests, user needs `cashdrawer.open` and `cashdrawer.close` (e.g. BRANCH_MANAGER).

---

## P3 — Cash Drawer + Shift Management

### P3.1 Open shift

1. As a user with `cashdrawer.open` (e.g. BRANCH_MANAGER), call **POST** `/api/v1/pos/shift/open` with `branchId` and optional `startingCash` in body (e.g. `{ "branchId": 1, "startingCash": 100 }`). Use the same auth token as for POS.
2. **Pass:** Response 201 with `data` containing shift `id`, `status: "OPEN"`, `openedAt`, `startingCash`.
3. Call again with same branchId.
4. **Pass:** Response 400 with message like "already open" and code `SHIFT_ALREADY_OPEN`.

### P3.2 Get current shift

1. **GET** `/api/v1/pos/shift/current?branchId=1`.
2. **Pass:** Response 200 with `data.shift` set to the open shift (or `data.shift: null` if none).

### P3.3 Sale links to shift

1. With a shift open, complete a sale via POS (New Sale → add item → Complete sale) with the same branchId.
2. **Pass:** Sale succeeds; in DB, `orders.posShiftId` equals the open shift id for that order.

### P3.4 Close shift and variance

1. With a shift open and at least one CASH sale (e.g. total 50), call **POST** `/api/v1/pos/shift/close/:id` with body `{ "closingCash": 150 }` (starting 100 + 50 = 150 expected).
2. **Pass:** Response 200; `data.closingCash` 150, `data.variance` 0 (or with optional managerOverrideReason).
3. **Pass:** GET `/api/v1/pos/shift/:id/z-report` returns salesCount, salesTotal, taxTotal, discountTotal, refundsCount, refundsTotal, startingCash, closingCash, variance.

### P3.5 Shift required (optional branch config)

1. Set branch `featuresJson` to `{ "posRequireShift": true }` for the test branch.
2. With **no** open shift, attempt a sale (POST /pos/sale).
3. **Pass:** Response 400 with message containing "Open a shift" and code `NO_OPEN_SHIFT`.
4. Open a shift, then complete sale.
5. **Pass:** Sale succeeds.
6. (Optional) Revert `posRequireShift` to false or remove for other tests.

### P3.6 Audit trail

1. After opening and closing a shift, check `audit_logs` (or equivalent) for actions `POS_SHIFT_OPENED` and `POS_SHIFT_CLOSED` with entityType `POS_SHIFT` and correct entityId (shift id).

---

## P4 — Accounting Posting (when implemented)

- Verify one journal entry per sale (idempotency key ORDER-{orderId}); no duplicate on retry.
- Verify one journal entry per return (idempotency key RETURN-{returnRequestId}).
- GET /pos/postings: list by branchId/status; POST /pos/postings/retry/:id for failed only.

---

## P5 — Reporting (when implemented)

- GET /pos/reports/daily and /pos/reports/summary: correct aggregates for branch and date range.
- GET /pos/reports/export: CSV for date range.
- Rate limit: barcode/product search returns 429 when exceeded.

---

## P6 — UI (when implemented)

- All tabs work; keyboard flow (barcode → add → checkout); reprint invoice from History; Cash Drawer tab shows Open/Close shift and current shift status; Z-report view.

---

## Automated tests (minimal)

When added:

- **Shift enforcement:** With `posRequireShift: true`, POST /pos/sale without open shift returns 400/NO_OPEN_SHIFT.
- **Journal idempotency:** Create sale twice with same idempotency key (if exposed) or same order; only one POSTED entry.
- **Shift close variance:** Close shift with known startingCash and one CASH sale; assert variance = closingCash - (startingCash + sale total).
