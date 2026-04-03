# Inventory Batch + Pricing — Master Plan (Audit, Architecture, Migration, UI)

**Status:** Planning only — no implementation in this document.
**Aligned with:** `docs/WINDSURF_GLOBAL_RULE.md` (ANALYZE → PLAN → IMPLEMENT), `docs/INVENTORY_MASTER_PLAN.md` (baseline inventory architecture).
**Scope:** Multi-tenant (org), warehouse-centric truth, batch/lot control, pricing decoupled from batch, auditability.

---

## Executive summary

The backend already has a **solid core**: `StockLot` + `StockLotBalance` (cached quantities), `StockLedger` (immutable movements with optional `lotId` and `unitCost`), GRN receive creating lots, transfers moving the same `lotId`, and FEFO helpers. Gaps cluster around **API/UI contract mismatch** (owner batches page), **pricing model shape** (location-scoped vs org rules), **explicit batch lifecycle status**, and **operational visibility** (filters, summaries, cost visibility rules). This document captures audit findings, target architecture, queries, migration steps, and UI plan.

---

## Phase 1 — Full system audit

### 1.1 Inventory / batch — how `StockLot` is created

| Path | Behavior |
|------|----------|
| **GRN receive** (`grn.service.ts` → `receiveGrn`) | For each line: resolve or create `StockLot` by `(orgId, variantId, lotCode)`; default `mfgDate`/`expDate` if missing; link `grnLine.lotId`; write `StockLedger` with `type: GRN_IN`, `quantityDelta > 0`, optional `unitCost`. |
| **Manual / opening** (`inventory.controller` receive-style flows) | Create or pick lot, then ledger entry. |
| **Transfers** | Same physical lot: `StockTransferItem.lotId` preserved; `TRANSFER_OUT` at source, `TRANSFER_IN` at destination (ledger updates both `StockLotBalance` rows for same `lotId`). |

**Schema today (`StockLot`):** `id`, `orgId`, `variantId` (required), `lotCode`, `mfgDate`, `expDate`, `createdByUserId`, timestamps. **No** `productId` on lot (product is via `variant.productId`). **No** `locationId` on lot (correct: `StockLotBalance` is `(locationId, lotId)`). **No** `unitCost` on lot — cost is captured on **ledger lines** (`StockLedger.unitCost`), which is appropriate for FIFO/WAC reporting.

### 1.2 “Missing” fields vs your target model

| Target field | Current state | Notes |
|--------------|---------------|--------|
| `variantId` | **Present and required** | FK to `ProductVariant`. |
| `productId` | On variant, not on lot | Denormalize only if query performance/UI needs it; otherwise join via variant. |
| `expiryDate` / `mfgDate` | `expDate` / `mfgDate` on `StockLot` | Naming differs from spec; semantically present. |
| `unitCost` | On `StockLedger`, not lot | Aligns with “cost tracked” via movements; lot-level “average cost” is derived. |
| `initialQty` | Not stored | First inbound quantity is sum of positive ledger deltas for that lot at first location (or GRN line qty). Optional materialized column for reporting only. |
| `status` (ACTIVE, NEAR_EXPIRY, …) | **Not on lot** | Must be **computed** from `expDate` + `StockLotBalance` + business rules (or materialized job for scale). |

### 1.3 Orphan / low-signal lots

**Possible definitions:**

1. **`StockLot` with no `stock_lot_balances` rows** — never received at any location (e.g. GRN draft cancelled after lot create is rare; more often failed partial migrations).
2. **All balances `onHandQty = 0`** — “depleted” but lot row still exists (expected for audit).
3. **`lotId` set on lines but variant deleted** — should be blocked by FK; if seen, data corruption.
4. **GRN defaults** — if `mfgDate`/`expDate` defaulted to synthetic values, lots look “valid” but **missing real expiry** (operational “missing data” rather than DB null).

### 1.4 Quantity logic

- **Authoritative cache:** `stock_lot_balances.on_hand_qty`, `reserved_qty` per `(locationId, lotId)`.
- **Ledger:** `stock_ledgers` with `quantity_delta`; types include `GRN_IN`, `TRANSFER_OUT`, `TRANSFER_IN`, `SALE_*`, `ADJUSTMENT`, `EXPIRED`, `LOSS`, `DAMAGE`, etc. (`StockLedgerType` enum in schema).
- **Reconciliation:** Balances should match sum of ledger deltas per location/lot (periodic job recommended for enterprise).

### 1.5 Org / location consistency

- `StockLot.orgId` scopes the lot definition; transfers reuse `lotId` across locations **within the same org** (same product variant identity).
- Risk: creating a lot with wrong `orgId` vs variant’s product org — mitigated if creation always uses `branch.orgId` from `InventoryLocation` (GRN path does).

### 1.6 Pricing — where selling price comes from today

- **`ProductVariant`** has **no** list/base price field in schema.
- **`LocationPrice`** (`location_prices`): `(locationId, variantId)` → `price`, `effectiveFrom`, `effectiveTo` — **primary** retail/POS path (`pos.service.ts` / `pos.controller.ts` resolve price per location).
- Selling price is **not** stored on `StockLot` — correct separation from batch.
- **Gap vs desired “org-level ProductPricing”:** Rules like `basePrice`, `markupPercent`, `minPrice`, `maxPrice` at **org + variant** are **not** first-class; today you effectively have **per-location** price rows. Branch “override” can be modeled as another `LocationPrice` row for that branch’s shop location rather than a separate `BranchPricing` table (optional normalization).

### 1.7 API — batches endpoint naming and payloads

- There is **no** `GET /api/v1/inventory/batches` in current inventory routes. Lot-wise listing is **`GET /api/v1/inventory/lots`** (`inventory.controller.getInventoryLots` → `inventory.service.getInventoryLots`).
- **`GET /api/v1/inventory/expiring`** → `getExpiringItemsV2`: filters `stock_lot_balance` with `onHandQty > 0`, `lot.expDate` between now and `now + daysAhead`, optional `locationId` / `branchId` / `orgId`.

### 1.8 Expiring query logic (backend)

- `getExpiringItemsV2` uses `lot.expDate` between `now` and `futureDate`, and **`onHandQty > 0`** — matches “available stock at risk” intent.
- Default `daysAhead` in controller: `parseInt(req.query.daysAhead) || 30` — callers passing `90` get 90 days.
- **Improvement:** Also expose **`availableQty`** (onHand − reserved) for risk views; align naming with UI.

### 1.9 Frontend — `/owner/inventory/batches` (root causes)

**File:** `bpa_web/app/owner/(larkon)/inventory/batches/page.tsx`

| Symptom | Root cause |
|---------|------------|
| Variant shows `—` | API returns each row as `{ lotId, lot: { …, variant: { sku, title } }, onHandQty, reservedQty, availableQty }`. UI reads `row.variant` — **always undefined**. Should use `row.lot?.variant` or API should flatten. |
| Quantity always `0` | UI uses `row.quantity`; API exposes **`onHandQty`** / **`availableQty`**, not `quantity`. |
| Expiry / mfg “missing” | UI uses `row.mfgDate` / `row.expDate`; API nests dates under **`row.lot.mfgDate` / `row.lot.expDate`**. |
| Lot column shows numeric id | UI prefers `row.lotCode`; API has **`row.lot.lotCode`**. |

**Conclusion:** This is primarily a **response-shape mismatch** between `getInventoryLots` and the owner page types/fields — not necessarily missing DB data.

**Expiring table:** `getExpiringItemsV2` returns `quantity`, `variant`, `lot`, `expDate` as `expiryDate` on nested `lot` — check flat mapping: top-level `lot.lotCode` exists; UI uses `row.lotCode` (often undefined) and `row.expDate` vs `expiryDate` — **another field-name mismatch**.

### 1.10 Ledger type coverage vs your spec

Your spec lists: RECEIVE, TRANSFER_OUT, TRANSFER_IN, SALE, ADJUSTMENT, WRITE_OFF. **Current enum** uses `GRN_IN` / `PURCHASE_IN`, `SALE_POS`, `SALE_CLINIC`, `SALE_ONLINE`, `TRANSFER_*`, `ADJUSTMENT`, `EXPIRED`, `LOSS`, `DAMAGE`, etc. — **finer granularity**. Mapping layer for reports/UI labels is enough; renaming enums is high-risk.

---

## Phase 2 — Enterprise architecture design

### 2.1 Product layer

- **Product** (`products`): org-scoped catalog identity.
- **ProductVariant** (`product_variants`): sellable SKU, `requiresLot` / `requiresExpiry` / `requiresMfg` flags.

### 2.2 Batch layer (`StockLot`) — target fields

Align naming with product language; Prisma can keep `expDate` or migrate to `expiryDate` in a controlled migration.

| Field | Purpose |
|-------|---------|
| `id` | PK |
| `orgId` | Tenant |
| `variantId` | Required FK (product via relation) |
| `batchNo` / `lotCode` | Business batch identifier (unique per org+variant today) |
| `mfgDate`, `expiryDate` | Lot dates (warehouse source of truth for expiry policy) |
| `unitCost` | **Optional on lot** only if you want snapshot at receive; otherwise **ledger-only** (recommended: keep cost on `StockLedger` GRN lines). |
| `initialQty` | Optional denormalized first receipt qty |
| `status` | **Computed** enum: ACTIVE, NEAR_EXPIRY, EXPIRED, DEPLETED, MISSING_METADATA — or store DEPLETED only |

**Rules:**

- **Immutable after creation** for `lotCode`, dates, variant — enforce in service layer; only balances move.
- **Expiry policy:** “Only set at warehouse” = **process rule** on GRN/receive UI for warehouse locations, not necessarily a schema constraint (branch receive from transfer inherits same lot).

### 2.3 Inventory ledger

- **Single table:** `stock_ledgers` (already exists).
- **Balance tables:** `stock_balances` (variant × location), `stock_lot_balances` (lot × location).
- **Quantity:** Cached on balances; **computed check** = sum(ledgers) per scope.

### 2.4 Pricing layer (decoupled from batch)

**Current:** `LocationPrice` per `(locationId, variantId)`.

**Target (conceptual):**

| Layer | Purpose |
|-------|---------|
| **OrgProductPricing** (new or evolve catalog) | `orgId`, `variantId`, `basePrice`, optional `markupPercent`, `minPrice`, `maxPrice`, effective dating |
| **LocationPrice** (existing) | Shop/clinic shelf price; can copy from org default or branch override |
| **BranchPricingOverride** (optional) | Only if you need explicit branch-level rule separate from location rows |

**POS/clinic** should resolve: org defaults → branch/location override → channel rules — **never** from `StockLot`.

### 2.5 Operational rules

- **FEFO:** Implemented via `getAvailableLotsFEFO` / `fefoAllocation.service.ts` (expiry ordering, recall/QC exclusions).
- **Cost visibility:** Branch UI shows **no unit cost**; owner/warehouse sees cost from ledger or GRN (policy via API field omission + role).

---

## Phase 3 — Data flow design

| Event | System behavior |
|-------|-----------------|
| **GRN** | Create/resolve `StockLot`; `GRN_IN` ledger; update `StockLotBalance` + `StockBalance`; optional QC inspection. |
| **Transfer send/receive** | `TRANSFER_OUT` / `TRANSFER_IN` with same `lotId`; quantities on transfer items. |
| **Sale** | FEFO or explicit lot; `SALE_*` negative delta on `StockLotBalance`. |
| **Expiry write-off** | `EXPIRED` or `LOSS` type with policy in `ExpiryWriteOffLog` (existing module). |

---

## Phase 4 — Query design

### 4.1 Batches / lots page (canonical response)

For **`GET /inventory/lots`** (or future alias `GET /inventory/batches`):

**Must return (per row):**

- `lotId`, `lotCode`, `mfgDate`, `expiryDate`
- `product`: `{ id, name }` (from `lot.variant.product`)
- `variant`: `{ id, sku, title }`
- `onHandQty`, `reservedQty`, `availableQty`
- `unitCost` (optional, **owner-only**): weighted from recent GRN or nullable
- `status`: computed (ACTIVE | NEAR_EXPIRY | EXPIRED | DEPLETED | MISSING_DATA)
- `locationId`, `location` name / branch (for multi-location views)

**Filters (query params):**

- `locationId` (required or default all accessible)
- `variantId`, `productId`
- `hideZeroQty` (default true for branch)
- `expiryBefore`, `expiryAfter`
- `status`

### 4.2 Expiring report

```text
WHERE stock_lot_balance.on_hand_qty > 0  -- or available > 0
  AND lot.expiry_date <= NOW() + INTERVAL '90 days'
  AND lot.expiry_date >= NOW()            -- exclude already expired if "expiring" only
```

**Near-expiry window** (90 days) vs **already expired** should be **separate toggles** or endpoints for clarity.

---

## Phase 5 — Frontend design (`/owner/inventory/batches`)

- **Fix contract first:** Map API fields or adjust API to stable DTO (same names as UI).
- **Toggle:** Hide zero-qty lots (default on).
- **Badges:** Active / Near expiry / Expired / Missing data (no mfg when required, placeholder expiry).
- **Filters:** Location, product search, expiry range.
- **Summary cards:** Total lots (with stock), active, near expiry (e.g. ≤90d), expired still on hand (write-off CTA).

**Cost:** Omit at branch; show in owner warehouse context only.

---

## Phase 6 — Migration plan (non-destructive policy)

Per `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`:

1. **Inventory integrity script**
   - Find `stock_lot_balances` where sums don’t match ledger (per location/lot).
   - Find `stock_lots` with zero balances everywhere vs ledger history.

2. **variantId**
   - Already NOT NULL; verify no orphan variants; fix bad rows via support scripts if any.

3. **Orphan lots**
   - Lots with no balances and no ledger references — quarantine or delete per policy (likely rare).

4. **Backfill metadata**
   - Rows with default/sentinel dates — flag as MISSING_DATA for UI.

5. **Recompute balances**
   - Only from controlled replay of ledgers in a maintenance window if drift detected.

6. **Pricing**
   - If introducing `OrgProductPricing`, migrate from `LocationPrice` by taking “primary warehouse” or median price per variant — **business decision**.

7. **API versioning**
   - Add DTO version or `?format=v2` if mobile/clients depend on old shape.

---

## Prisma-ready sketch (incremental — not a drop-in replace)

```prisma
// Illustrative — evolve existing models; avoid breaking renames without migration.

model OrgVariantPricing {
  id            Int       @id @default(autoincrement())
  orgId         Int
  variantId     Int
  basePrice     Decimal?  @db.Decimal(12, 2)
  markupPercent Decimal?  @db.Decimal(6, 3)
  minPrice      Decimal?  @db.Decimal(12, 2)
  maxPrice      Decimal?  @db.Decimal(12, 2)
  effectiveFrom DateTime  @default(now())
  effectiveTo   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  org     Organization   @relation(fields: [orgId], references: [id])
  variant ProductVariant @relation(fields: [variantId], references: [id])

  @@index([orgId, variantId])
  @@index([effectiveFrom, effectiveTo])
}
```

`StockLot` may gain optional `statusDeprecated` only if you must persist DEPLETED; prefer computed.

---

## API structure (target)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/inventory/lots` | List lots with balances + product/variant + computed status (or alias `/batches`) |
| GET | `/api/v1/inventory/expiring` | Expiring in window; `availableQty`, flat `lotCode`, `variant`, `product` |
| GET | `/api/v1/inventory/ledger` | Audit trail (existing) |
| GET | `/api/v1/pricing/...` | Org + location resolution (consolidate with existing `pricing` module) |

**Authorization:** Owner vs branch staff — strip `unitCost` for branch roles.

---

## Related documentation

- `docs/INVENTORY_MASTER_PLAN.md` — route map and historical gaps.
- `docs/inventory-stock-request-product-picker-audit-and-fix-plan.md` — picker rules.
- `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md` — migration discipline.

---

## Implementation sequencing (when approved)

1. **DTO alignment** — Unify `/inventory/lots` and `/inventory/expiring` response shapes; update owner batches page (minimal UI change).
2. **Computed status** — Server-side helper shared by list + expiring.
3. **Filters & summary cards** — Query params + aggregation endpoints.
4. **Pricing** — Optional `OrgVariantPricing` + migration from `LocationPrice`.
5. **Integrity jobs** — Balance reconciliation reports.

---

**Document path:** `D:/BPA_Data/backend-api/docs/inventory-batch-pricing-master-plan.md`
