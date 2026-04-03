# Universal Product Import – User Guide

**Related:** For the **global admin** medicine reference import (country-scoped national catalog, staging → preview → apply; not org storefront products), see [ADMIN_MEDICINE_CATALOG_IMPORT_SYSTEM.md](./ADMIN_MEDICINE_CATALOG_IMPORT_SYSTEM.md).

## Overview

The Product Import flow lets you bring products from CSV, Excel, or (later) API sources into your organization safely. Categories, subcategories, and brands are **fixed**: they must map to existing values. Products that fail mapping or validation stay in a staging state and do not appear on the storefront until you fix issues and publish.

## Flow

1. **Upload** – Choose a CSV or Excel file. The system creates a batch and processes rows (parse → normalize → map → validate → upsert).
2. **Mapping** – External category/brand/unit values are matched to internal IDs. Use saved mappings so the next import is one-click.
3. **Fix Center** – Rows with status `NEEDS_FIX` are listed with issue codes. Use one-click mapping (e.g. "Map brand") or revalidate after saving a mapping.
4. **Review & Publish** – Rows with status `READY` can be published. Published products get `publishStatus=PUBLISHED` and become visible on the storefront (if approvalStatus is also PUBLISHED).

## Visibility rule

A product is visible on the storefront only if:

- `approvalStatus = PUBLISHED` (existing flow), and
- `publishStatus` is null (legacy) or `PUBLISHED`, and
- `validationIssues` is null or empty.

Import-created products start with `publishStatus=DRAFT`. After you click **Publish** on a batch, their `publishStatus` is set to `PUBLISHED` and `validationIssues` is cleared.

## Sample CSV template

Use these column names (or common aliases). Headers are auto-detected (case-insensitive, underscores optional).

| Column          | Required | Description                    |
|-----------------|----------|--------------------------------|
| name            | Yes      | Product name (or product_name, title) |
| sku             | Yes*     | Variant SKU (* or barcode)     |
| barcode         | Yes*     | Barcode / EAN / UPC            |
| price           | Yes      | Unit price (number)            |
| category        | Yes      | Category name (must exist)      |
| subcategory     | No       | Subcategory name (must exist)   |
| brand           | Yes      | Brand name (must exist)        |
| unit            | No       | Unit code (e.g. kg, g, pcs)     |
| description     | No       | Product description            |
| variant_name    | No       | Variant title                  |

Example `product_import_template.csv`:

```csv
name,sku,barcode,price,category,subcategory,brand,unit,description
Royal Canin Kitten 2kg,RC-KIT-2,8901234567890,2300,Food,Dry Food,Royal Canin,kg,Premium kitten food
Whiskas Temptations 60g,WH-TEMP-60,,350,Cat Treats,Training Treats,Whiskas,g,Crunchy treats
```

## Issue codes

| Code                   | Meaning |
|------------------------|--------|
| MISSING_NAME           | Product name is required |
| MISSING_PRICE          | Valid price is required |
| MISSING_SKU_OR_BARCODE | SKU or barcode is required |
| UNMAPPED_CATEGORY      | Category not found – map to existing or add mapping |
| UNMAPPED_SUBCATEGORY   | Subcategory not found |
| UNMAPPED_BRAND         | Brand not found – map to existing or add mapping |
| UNMAPPED_UNIT          | Unit not found |
| DUPLICATE_BARCODE      | Same barcode appears twice in file |
| DUPLICATE_SKU          | Same SKU appears twice in file |
| INVALID_PRICE          | Price out of range or not a number |

## Owner panel UI

- **List & upload:** `/owner/integrations/product-import` – upload CSV/Excel, list recent batches.
- **Batch detail:** `/owner/integrations/product-import/[batchId]` – Fix Center, Ready to publish, Saved mappings; Revalidate and Publish actions.

Add a sidebar link under Products (e.g. "Product Import") pointing to `/owner/integrations/product-import` if your layout has a Products section.

## API endpoints (Owner panel)

- `POST /api/v1/owner/imports/products/upload` – multipart file → batchId
- `GET /api/v1/owner/imports/products` – list batches
- `GET /api/v1/owner/imports/products/:batchId` – batch summary + totals
- `GET /api/v1/owner/imports/products/:batchId/rows?status=NEEDS_FIX` – paginated rows
- `POST /api/v1/owner/imports/products/:batchId/revalidate` – rerun mapping/validation
- `POST /api/v1/owner/imports/mappings` – create/update mapping (provider, type, externalValue, internalId)
- `GET /api/v1/owner/imports/mappings?type=BRAND&provider=csv` – list mappings
- `POST /api/v1/owner/imports/products/:batchId/publish` – publish READY rows
- `POST /api/v1/owner/imports/products/rows/:rowId/fix` – apply fix (mapping or setFields) and revalidate row
- `GET /api/v1/owner/imports/products/:batchId/unmapped?type=BRAND|CATEGORY|SUBCATEGORY` – unmapped values with counts
- `POST /api/v1/owner/imports/products/:batchId/bulk-fix` – bulk mapping + setFields
- `POST /api/v1/owner/imports/products/unpublish` – set product publishStatus to DRAFT

## Queue, progress, and limits

- With **Redis** enabled, uploads are enqueued (BullMQ `product_import`). Run worker: `node -r ts-node/register src/common/jobs/productImportWorker.ts`.
- Batch **progress** (`processedRows`, `totalRows`, `progressPercent`, `startedAt`, `finishedAt`, `errorMessage`) is in `GET :batchId`. Poll every 2–5s while PENDING/PROCESSING.
- **Rate limit:** upload 20 per 15 min (config: `RL_IMPORT_UPLOAD_*`). **Max rows** and **max file size** (env: `PRODUCT_IMPORT_MAX_ROWS`, `PRODUCT_IMPORT_MAX_FILE_BYTES`).

## Issue shape

Issues use `{ code, field?, severity, message?, meta? }`. Severity: `blocking` | `warning` | `info`. Codes include AMBIGUOUS_BARCODE when barcode matches multiple products.

## Testing and backfill

- **Unit tests:** Add Jest (or your test runner) and unit tests for Normalizer, Mapper, Validator, and UpsertEngine; exclude `*.test.ts` from main `tsconfig` or use a separate test config.
- **Integration:** Run a full import against a test DB (upload → process → fix → publish) to validate end-to-end.
- **Legacy publishStatus:** One-time backfill for products with `approvalStatus=PUBLISHED` and `publishStatus=null`: run `npx ts-node -r ts-node/register scripts/backfill-publish-status-legacy.ts` (use `DRY_RUN=1` to only count).

## Idempotency

Re-importing the same file does not duplicate products. Upsert order: **barcode** → **sku** → **(name + brand)**. If multiple rows resolve to the same product, they update that product and variants.

## Extensibility

The same pipeline (Normalizer → Mapper → Validator → UpsertEngine) is used for CSV, Excel, and future API providers.

### Adding a new API provider adapter

For POS or other API connectors:

1. **Implement the adapter** in `src/api/v1/services/product-import/providers/`:
   - Implement `ProviderAdapter` from `providers/ProviderAdapter.ts`:
     - `providerName`: string (e.g. `"my-pos"`).
     - `fetchProducts({ cursor?, limit? })`: return `{ items: unknown[], nextCursor?: string | null }` (cursor-based pagination).
     - `normalize(item)`: map one API item to `NormalizedProductRow` (canonical keys: name, sku, barcode, price, category, subcategory, brand, unit, description, variantTitle).
2. **Use the base runner** `runApiBatch` from `runApiBatch.ts`:
   - Pass `{ prisma, orgId, createdByUserId, adapter }`.
   - It creates a batch with `sourceType=API` and `provider=adapter.providerName`, then iterates `fetchProducts`, normalizes each item, and feeds rows into the same Mapper/Validator/Upsert pipeline in chunks.
3. **Wire an endpoint** (e.g. POST `/api/v1/owner/imports/products/sync-api`) that resolves org/user, instantiates your adapter, and calls `runApiBatch`. Enforce org/branch scope and rate limits as for file upload.
4. **Example stub:** `providers/DemoAdapter.ts` shows a minimal adapter with hardcoded sample items and cursor pagination.
