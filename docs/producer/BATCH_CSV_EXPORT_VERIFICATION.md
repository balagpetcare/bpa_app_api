# Batch CSV Export – Manual Verification

Use this checklist to verify summary filters, codes streaming (large batches), and CSV format (BOM, header order).

---

## Prerequisites

- Producer org with batches in mixed statuses (DRAFT, APPROVED, GENERATED).
- At least one batch with >20k codes for streaming test (or use a smaller batch and confirm no timeout/memory spike).
- Authenticated producer session (cookie or token) for API calls.

---

## 1. Summary export – filters

**Goal:** Export only the batches that match current UI filters (e.g. COMPLETED this month).

### 1.1 UI-driven export (recommended)

1. Open Producer → Batches.
2. Apply filters, e.g.:
   - Status: **GENERATED**
   - Date range: **dateFrom** = first day of current month, **dateTo** = today.
3. Click **Export** → **Export Summary (CSV)**.
4. **Pass:** Downloaded CSV contains only batches that match the current filters (same as the filtered list on the page). Filename follows `batches_summary_<orgSlug>_<YYYYMMDD>_<HHmm>.csv`.

### 1.2 API with query params

Call `GET /api/v1/producer/batches/export/summary` with query params (same as doc):

- `status=GENERATED` → only GENERATED batches.
- `status=DRAFT,APPROVED` → batches in either status.
- `productId=<id>` → only batches for that product.
- `factoryId=<id>` → only batches whose product has that factory.
- `search=SKU-001` → batches where batch no, product name, or SKU contains the term (case-insensitive).
- `createdFrom=2026-02-01T00:00:00.000Z` and `createdTo=2026-02-26` → batches created in that range (createdTo as date-only = end of day).

**Pass:** CSV row count and batch_ids match the intended filter. **Fail:** 400 with `code: "INVALID_FILTER"` for invalid params (e.g. `factoryId=abc`, bad date).

### 1.3 Invalid params return 400

- `GET .../export/summary?status=INVALID` → 400, body includes `code: "INVALID_FILTER"` and message listing allowed statuses.
- `GET .../export/summary?factoryId=xyz` → 400, `code: "INVALID_FILTER"`.
- `GET .../export/summary?createdTo=not-a-date` → 400, `code: "INVALID_FILTER"`.

**Pass:** Each returns 400 and no CSV; response is JSON with clear message.

---

## 2. Codes export – large batch (streaming, no timeout / memory spike)

**Goal:** Export a batch with a large number of codes (e.g. >20k) and confirm the request completes without timeout and without a visible memory spike on the server.

### 2.1 Prepare

- Use a batch that has at least 20,000 codes (or the largest available).
- Optionally run API server under a process monitor or task manager to observe memory.

### 2.2 Export

1. Producer → Batches → open the batch (or use API directly).
2. **Export** → **Export Codes (CSV)** (or `GET /api/v1/producer/batches/<batchId>/export/codes`).
3. Wait for the download to finish.

**Pass:**

- Download completes successfully; file opens in Excel or a text editor and row count equals the batch’s code count (plus header).
- No 504/timeout from the server.
- Server memory does not spike to “load all codes at once” levels (streaming keeps working memory bounded by chunk size, e.g. 5000 rows).

### 2.3 Dev-only log (optional)

If running in development, check server logs for a line like:

`[batch-codes-export] batchId=<id> rows=<N> ms=<ms>`

**Pass:** Log appears with correct `batchId`, total `rows`, and a reasonable `ms` for the size of the export.

---

## 3. BOM and header order stability

**Goal:** Confirm UTF-8 BOM is present and header column order is stable and matches the data dictionary.

### 3.1 BOM

1. Export any of the three CSV types (summary, codes, events).
2. Open the file in a hex editor or a tool that shows the first bytes.

**Pass:** First three bytes are `EF BB BF` (UTF-8 BOM). In Excel, Bengali/special characters (if present) display correctly.

### 3.2 Header order

1. For **batches_summary**: Open the CSV; first row must match the column order in `docs/producer/BATCH_CSV_EXPORT.md` (e.g. `batch_id`, `batch_no`, `producer_org_id`, …).
2. For **batch_codes**: First row must match the codes data dictionary header order (e.g. `batch_id`, `batch_no`, `product_id`, …).
3. For **batch_events**: First row must match the events data dictionary header order.

**Pass:** No columns reordered or renamed compared to the doc. New columns (if any) appear only at the end (append-only).

### 3.3 Timestamps are UTC

1. Open summary or codes CSV; check `created_at`, `updated_at`, `generated_at` (or similar).
2. Values must be ISO 8601 with trailing `Z` (e.g. `2026-02-26T10:30:00.000Z`).

**Pass:** All timestamp columns use `Z` (UTC); no local or +06:00 in the file unless explicitly documented.

---

## Quick reference

| Check | Pass criteria |
|-------|----------------|
| Summary + UI filters | Export Summary uses current filters; CSV matches filtered list. |
| Summary API filters | Query params filter correctly; invalid params → 400 with INVALID_FILTER. |
| Codes large batch | >20k codes export completes; no timeout; no large memory spike. |
| BOM | First bytes `EF BB BF`. |
| Header order | Matches data dictionary; append-only for new columns. |
| Timestamps | ISO 8601 with `Z` (UTC). |
