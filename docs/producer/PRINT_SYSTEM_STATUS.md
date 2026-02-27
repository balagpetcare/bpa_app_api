# Producer Print System — Status & QA

## STEP 0 — Inventory (DONE vs MISSING)

### A) Frontend

| Item | Status |
|------|--------|
| Route `/producer/print/batches` (list) | DONE |
| Route `/producer/print/batches/[id]` (detail: Overview / Allocations / Export-Email) | DONE |
| Sidebar shows **Print → Batches** | **MISSING** → fixed by adding menu item |
| `producerPrintBatchesList` | DONE |
| `producerPrintBatchDetail` | DONE |
| `producerPrintBatchAllocate` | DONE |
| `producerPrintEmailRecipientsList` | N/A (not implemented) |
| `producerPrintEmailRecipientCreate` | N/A (not implemented) |
| `producerPrintAllocationRevoke` | DONE |
| CSV download (Content-Type detection, `triggerBlobDownload`) | DONE |
| Email export (API responds; SMTP required for delivery) | DONE |
| `remainingCount === 0` disables allocation | DONE |
| Quick buttons (Next 100/500 Download, Next 1000 Email) | DONE |

### B) Backend

| Item | Status |
|------|--------|
| `GET /api/v1/producer/print/batches` | DONE |
| `GET /api/v1/producer/print/batches/:id` | DONE |
| `POST /api/v1/producer/print/batches/:id/allocate` | DONE |
| `POST /api/v1/producer/print/batches/:batchId/allocations/:allocationId/revoke` | DONE |
| List/detail use `producer.batches.read` | DONE |
| Allocate uses `producer.batches.read` + `producer.codes.export` | DONE |
| Revoke uses owner + `producer.codes.revoke` | DONE |
| CSV columns: serial, code, batchNo, productName | DONE |
| Filename pattern: `producer-batch-{batchNo}-{start}-{end}.csv` | DONE |
| Email validation (400 `INVALID_EMAIL`) | DONE |
| Rate limit (429 `RATE_LIMIT`) | DONE |
| Error responses include `code` where applicable | DONE |

---

## What Is Implemented

- **List:** Batches for the producer org with total/issued/remaining and next serial; fallback to regular batches list when print API empty/fails.
- **Detail:** Batch overview, allocation history (with status/revoke when `?revoke=1` and owner), and Export/Email tab with quantity, action type (Print / Download / Email), and quick buttons.
- **Allocate:** Atomic serial range allocation; optional CSV download or email export; NO_SERIALS_REMAINING, INVALID_EMAIL, RATE_LIMIT errors with `code`.
- **Revoke:** Owner + `producer.codes.revoke` to revoke an ISSUED allocation.

## Endpoints

| Method | Path | Auth | Permission |
|--------|------|------|------------|
| GET | `/api/v1/producer/print/health` | none | — |
| GET | `/api/v1/producer/print/batches` | auth | producer.batches.read |
| GET | `/api/v1/producer/print/batches/:id` | auth | producer.batches.read |
| POST | `/api/v1/producer/print/batches/:id/allocate` | auth | producer.batches.read, producer.codes.export |
| POST | `/api/v1/producer/print/batches/:batchId/allocations/:allocationId/revoke` | auth | owner + producer.codes.revoke |

## UI Routes (bpa_web)

- `/producer/print/batches` — Print Batches list.
- `/producer/print/batches/[id]` — Print Batch detail (Overview, Allocations, Export/Email).

Frontend may call these via Next.js proxy `/api/proxy/producer-print/*` when same-origin rewrite is used.

## Error Handling Rules

- **API errors:** Modal only via `useApiErrorPopup` + `normalizeApiError`; no duplicate toast+modal.
- **Validations (e.g. quantity, email):** Toast only.
- **404 on list:** Inline banner + no modal (to avoid double message).

## QA Checklist

1. Sidebar **Print → Batches** visible for users with `producer.batches.read`.
2. List loads; empty state shows message + link to Batches.
3. Detail loads; Overview / Allocations / Export tabs render.
4. Allocate: Print, Download CSV, Email CSV work (email requires SMTP).
5. Allocation logs show new entries; revoke appears when `?revoke=1` and owner.
6. No duplicate toast + modal for the same error.
7. Other producer pages (Products, Batches, Staff, etc.) unaffected.
