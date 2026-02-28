# Batch CSV Export – Standard & Scalable Design

Production-grade CSV export for the Producer batch system (BPA_WPA). Three export modes; filters and streaming for scalability.

---

## Export modes

| Mode | File | Description |
|------|------|-------------|
| **Summary** | `batches_summary_<orgSlug>_<YYYYMMDD>_<HHmm>.csv` | One row per batch; supports same filters as Batches UI. |
| **Codes** | `batch_codes_<batchNo>_<YYYYMMDD>_<HHmm>.csv` | One row per code; streamed (cursor pagination), scalable for large batches. |
| **Timeline** | `batch_events_<batchNo>_<YYYYMMDD>_<HHmm>.csv` | One row per audit event. |

---

## API endpoints

- `GET /api/v1/producer/batches/export/summary` — Summary CSV. Optional query params: see [Summary filters](#summary-export-filters).
- `GET /api/v1/producer/batches/:batchId/export/codes` — Codes CSV (streamed; marks codes as exported).
- `GET /api/v1/producer/batches/:batchId/export/events` — Timeline/events CSV.

Permissions: `producer.batches.read` for summary and events; `producer.codes.export` for codes.

---

## Timezone policy

- **All timestamps in CSV are in UTC**, in ISO 8601 format with trailing `Z` (e.g. `2026-02-26T10:30:00.000Z`).
- **Date-only fields** (`mfg_date`, `exp_date`) are `YYYY-MM-DD` with no timezone; they represent calendar dates as stored.
- Implementation: `formatIso(d)` uses JavaScript `date.toISOString()`, which is always UTC. Do not change to +06:00 or local time without a product decision and doc update.

---

## Backward compatibility

- **Append-only columns:** New columns may be added only at the end of the header list. Existing column names and order must not change.
- **export_version:** Bump (e.g. 1.0 → 1.1) when adding new columns or changing semantics of an existing column. Do not bump for doc-only or filter-only changes.
- Existing `GET /batches/:batchId/codes/export` (JSON) is unchanged.

---

## Summary export filters

Query params for `GET /api/v1/producer/batches/export/summary` (all optional):

| Param | Type | Description | Example |
|-------|------|-------------|---------|
| status | string or comma-separated | One or more of: DRAFT, APPROVED, REJECTED, GENERATED | `status=GENERATED` or `status=DRAFT,APPROVED` |
| factoryId | number | Filter by product’s factory | `factoryId=5` |
| productId | number | Filter by product | `productId=12` |
| search | string | Batch no / product name / SKU (case-insensitive) | `search=SKU-001` |
| createdFrom | ISO date-time | Batch created at ≥ this (UTC) | `createdFrom=2026-02-01T00:00:00.000Z` |
| createdTo | ISO or YYYY-MM-DD | Batch created at ≤ this; if date-only, end of day | `createdTo=2026-02-26` |
| mfgFrom | YYYY-MM-DD or date | mfg_date ≥ | `mfgFrom=2026-01-01` |
| mfgTo | YYYY-MM-DD or date | mfg_date ≤ (date-only = end of day) | `mfgTo=2026-12-31` |

Invalid param (e.g. non-integer `factoryId`, invalid date) returns **400** with `code: "INVALID_FILTER"` and a clear message.

---

## 1. batches_summary.csv – data dictionary

### Column list (type + example)

| Column | Description | Data type | Example value |
|--------|-------------|-----------|----------------|
| batch_id | Internal batch ID | integer | 42 |
| batch_no | Human-readable batch number | string | BATCH-2026-001 |
| producer_org_id | Producer org ID | integer | 1 |
| producer_org_name | Producer org name | string | Acme Pet Foods |
| factory_id | Factory ID (from product) | integer or empty | 3 |
| factory_name | Factory name | string | Dhaka Plant |
| product_id | Product ID | integer | 10 |
| product_name | Product name | string | Premium Kibble 2kg |
| product_sku | SKU | string | SKU-001 |
| product_brand | Brand | string | Acme |
| product_category | Product type/category | string | PET_FOOD |
| status | Batch status | enum | GENERATED |
| mfg_date | Manufacturing date | date YYYY-MM-DD | 2026-02-01 |
| exp_date | Expiry date | date YYYY-MM-DD | 2027-02-01 |
| production_started_at | (Reserved) | string | (empty) |
| production_completed_at | (Reserved) | string | (empty) |
| created_at | Batch created at (UTC) | ISO 8601 | 2026-02-26T08:15:00.000Z |
| updated_at | Batch updated at (UTC) | ISO 8601 | 2026-02-26T09:00:00.000Z |
| qty_planned | Planned quantity | integer | 10000 |
| qty_produced | Generated quantity | integer | 10000 |
| qty_rejected | (Reserved) | integer | 0 |
| uom | Unit of measure | string | PCS |
| codes_total_generated | Total codes | integer | 10000 |
| codes_active | Active count | integer | 9500 |
| codes_voided | Voided count | integer | 0 |
| codes_last_generated_at | Last code generated (UTC) | ISO 8601 | 2026-02-26T09:00:00.000Z |
| qa_status | (Reserved) | string | (empty) |
| qa_notes | (Reserved) | string | (empty) |
| proofs_required | Proofs required | boolean | true |
| proofs_uploaded_count | Proof count | integer | 2 |
| compliance_ready | (Reserved) | boolean | false |
| export_version | Schema version | string | 1.0 |
| source_system | System identifier | string | BPA_WPA |
| source_env | Environment | enum | PROD |
| batch_url | Web link to batch | string | https://app.example.com/producer/batches/42 |

### Sample (synthetic)

**Header (one line):**
```text
batch_id,batch_no,producer_org_id,producer_org_name,factory_id,factory_name,product_id,product_name,product_sku,product_brand,product_category,status,mfg_date,exp_date,production_started_at,production_completed_at,created_at,updated_at,qty_planned,qty_produced,qty_rejected,uom,codes_total_generated,codes_active,codes_voided,codes_last_generated_at,qa_status,qa_notes,proofs_required,proofs_uploaded_count,compliance_ready,export_version,source_system,source_env,batch_url
```

**One data row:**
```text
42,BATCH-2026-001,1,Acme Pet Foods,3,Dhaka Plant,10,Premium Kibble 2kg,SKU-001,Acme,PET_FOOD,GENERATED,2026-02-01,2027-02-01,,,2026-02-26T08:15:00.000Z,2026-02-26T09:00:00.000Z,10000,10000,0,PCS,10000,9500,0,2026-02-26T09:00:00.000Z,,,true,2,false,1.0,BPA_WPA,PROD,https://app.example.com/producer/batches/42
```

---

## 2. batch_codes.csv – data dictionary

### Column list (type + example)

| Column | Description | Data type | Example value |
|--------|-------------|-----------|----------------|
| batch_id | Batch ID | integer | 42 |
| batch_no | Batch number | string | BATCH-2026-001 |
| product_id | Product ID | integer | 10 |
| product_name | Product name | string | Premium Kibble 2kg |
| factory_id | Factory ID | integer or empty | 3 |
| factory_name | Factory name | string | Dhaka Plant |
| code_id | Code record ID | integer | 1001 |
| code_value | Actual code (QR payload) | string | ABC12XY99Z01 |
| code_format | Format | string | ALPHANUM |
| serial_no | (If separate) | string | (empty) |
| sequence_no | 1..N | integer | 1 |
| code_status | Code status | enum | UNUSED |
| generated_at | Generated at (UTC) | ISO 8601 | 2026-02-26T09:00:00.000Z |
| voided_at | Voided at (UTC) | ISO 8601 or empty | (empty) |
| used_at | First verified at (UTC) | ISO 8601 or empty | (empty) |
| expires_at | (Optional) | string | (empty) |
| checksum | (Optional) | string | (empty) |
| verification_url | Consumer scan URL | string | https://app.example.com/verify?code=ABC12XY99Z01 |
| export_version | Schema version | string | 1.0 |
| source_system | System identifier | string | BPA_WPA |

### Sample (synthetic)

**Header (one line):**
```text
batch_id,batch_no,product_id,product_name,factory_id,factory_name,code_id,code_value,code_format,serial_no,sequence_no,code_status,generated_at,voided_at,used_at,expires_at,checksum,verification_url,export_version,source_system
```

**One data row:**
```text
42,BATCH-2026-001,10,Premium Kibble 2kg,3,Dhaka Plant,1001,ABC12XY99Z01,ALPHANUM,,1,UNUSED,2026-02-26T09:00:00.000Z,,,,"",https://app.example.com/verify?code=ABC12XY99Z01,1.0,BPA_WPA
```

### Streaming behavior

- Response is streamed; no full load of all codes into memory.
- Cursor-based pagination by `id` in chunks (e.g. 5000 rows). Header written once, then rows incrementally.
- `exportedAt` is updated per chunk (by code ids) to avoid N+1 and full-table scan.
- No hard limit; large batches (e.g. >20k codes) are supported. In development, a single log line reports rows exported and duration (ms).

---

## 3. batch_events.csv – data dictionary

### Column list (type + example)

| Column | Description | Data type | Example value |
|--------|-------------|-----------|----------------|
| event_id | Audit log ID | integer | 501 |
| batch_id | Batch ID | integer | 42 |
| batch_no | Batch number | string | BATCH-2026-001 |
| event_type | Action | string | CODES_EXPORTED |
| event_at | Event time (UTC) | ISO 8601 | 2026-02-26T10:30:00.000Z |
| actor_user_id | User ID | integer | 5 |
| actor_name | Display name | string | Jane Doe |
| actor_role | OWNER / STAFF | string | OWNER |
| field | (Reserved) | string | (empty) |
| old_value | (Reserved) | string | (empty) |
| new_value | (Reserved) | string | (empty) |
| note | (Reserved) | string | (empty) |
| export_version | Schema version | string | 1.0 |
| source_system | System identifier | string | BPA_WPA |

### Sample (synthetic)

**Header (one line):**
```text
event_id,batch_id,batch_no,event_type,event_at,actor_user_id,actor_name,actor_role,field,old_value,new_value,note,export_version,source_system
```

**One data row:**
```text
501,42,BATCH-2026-001,CODES_EXPORTED,2026-02-26T10:30:00.000Z,5,Jane Doe,OWNER,,,,"",1.0,BPA_WPA
```

---

## CSV design rules

- **Encoding:** UTF-8 with BOM.
- **Dates:** `YYYY-MM-DD` for date-only; timestamps ISO 8601 in UTC.
- **Numbers:** Plain (no thousands separators).
- **Booleans:** `true` / `false`. **Enums:** Uppercase.
- **Columns:** `snake_case`; stable; append-only for new columns.

---

## Implementation touch points

- **Backend:** `src/api/v1/utils/csvExportHelper.js`, `producer.service.ts` (parseSummaryExportFilters, getBatchesSummaryForCsv, getBatchCodesForCsv, streamBatchCodesCsvToResponse, getBatchEventsForCsv), `producer.controller.ts`, `producer.routes.ts`.
- **Frontend:** `producerApi.js` (producerDownloadCsv, producerBatchExportSummaryCsv with filters), `batches/page.jsx` (Export dropdowns; summary uses current UI filters).
