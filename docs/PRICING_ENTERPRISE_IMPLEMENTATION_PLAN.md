# Pricing Enterprise Platform — Compatibility & Conflict Report + Implementation Plan

## 1. Executive summary

The codebase already contains a **non-trivial enterprise pricing stack**: org `ProductPricing`, `BranchPricing`, `LocationPrice`, `OrgPricingPolicy`, `RetailDiscountRule` + approvals, `EnterpriseDiscountRule`, `PricingCampaign`, `MembershipTier`, `BatchPricingRule` (lot-scoped), `PriceResolutionSnapshot`, and `PricingAuditLog`. Resolution is split between **`pricingEngine.service.ts`** (catalog path) and **`enterpriseResolution.service.ts`** (list-price layers + batch promo lookup).

This plan documents **conflicts with a “greenfield” layered model**, the **safest evolution path**, and what this program increment delivers **without** breaking POS, inventory, governance, or checkout.

---

## 2. What exists today (ground truth)

### 2.1 Data layers (Prisma)

| Layer | Model | Notes |
|-------|--------|------|
| Catalog base / band / MRP | `ProductPricing` | `basePrice`, `markupPercent`, `minPrice`, `maxPrice`, `mrp`, effective dates. No `referenceCost` column; cost signals come from **ledger** (`getVariantCostSignal`). |
| Branch override | `BranchPricing` | Single `overridePrice`; **wins entire catalog path** when effective. |
| Location price | `LocationPrice` | Used when set; POS barcode path checks location price first. |
| Batch contextual price | `BatchPricingRule` | Tied to **`StockLot`** (`lotId`), `promoPrice` / `recommendedSellPrice`, validity window, `status`. |
| Enterprise rules | `EnterpriseDiscountRule` | Applied in list layer; does **not** write `ProductPricing`. |
| Campaigns | `PricingCampaign` + scopes | Applied in list layer. |
| Membership | `MembershipTier` + exclusions / branch scopes | Percent off list in layer pass. |
| Governance | `OrgPricingPolicy` + retail validators | POS path uses `resolveSellingPriceWithEnterprise` when **`posPricingGovernanceEnabled`**. |

### 2.2 Runtime resolution (actual order in code)

1. **`resolveSellingPrice`**: `BranchPricing` → else `ProductPricing` (base + markup, clamp min / min(max,MRP)) → else `LocationPrice`.
2. **`applyEnterpriseListPriceLayers`** (on top of core list): **Enterprise discount rules** → **Campaigns** → **Membership tier %** (with caps / exclusions).
3. **`resolveSellingPriceWithEnterprise`**: then **`findBestBatchPromoPrice`**: if `batchPricingEnabled` and `shopLocationId` set, pick **lowest** applicable batch promo among on-hand lots at that location.

So the **documented “campaign before membership” vs “membership before campaign”** question is moot: the **implemented** order is **rules → campaigns → membership → batch promo floor**.

### 2.3 POS integration (important conflict)

- **Barcode / quick product lookup** (`pos.service.ts`) uses **`resolveSellingPrice` only** (catalog path), not the enterprise stack, unless location price exists.
- **Governance enforcement** (`assertPosSalePricingGovernance` in `retailDiscount.service.ts`) uses **`resolveSellingPriceWithEnterprise`** with `shopLocationId` when policy requires it.

So POS is **not a single uniform entry** today; changing barcode lookup to full enterprise resolution **without performance and product review** would be a **behavioral and load risk**.

**Safer path:** keep current split; document; optionally feature-flag “full list resolution on scan” per org later.

---

## 3. Compatibility & conflict report

### C1 — Target resolution order vs stakeholder diagram

**Conflict:** Requirements suggested: base → branch → **batch** → campaign → membership → enterprise rules → governance. **Code** applies enterprise rules and campaigns **before** batch promo, and batch promo is a **floor/min** style adjustment after list layers.

**Risk of blind reorder:** Every org’s realized shelf prices, campaign ROI, and membership stacking could change; A/B with historical snapshots would be needed.

**Decision:** **No layer reorder in this phase.** Document actual order as canonical for engineering; product can approve a v2 migration with snapshot regression tests.

### C2 — “Canonical MRP” vs batch MRP

**Conflict:** Requirement asks for batch-level MRP. `BatchPricingRule` has **`promoPrice` / `recommendedSellPrice`**, not a separate `mrp` column.

**Safer path:** Treat **batch promo price** as a **contextual sell/list adjustment** that does **not** overwrite `ProductPricing.mrp`. If a dedicated `batchMrpDisplay` is needed for labeling, add a nullable column in a follow-up migration without changing resolution semantics.

### C3 — Branch-specific batch rules

**Gap:** `BatchPricingRule` had **no `branchId`**; lots are global per org, but sell context is branch + shop location.

**Decision:** Add optional **`branchId`** on `BatchPricingRule` (null = all branches). Resolution prefers rules scoped to the selling branch, then generic.

### C4 — Simulator vs POS parity

**Partial gap:** Simulator uses `simulatePriceForVariant` → `resolveSellingPriceWithEnterprise`. POS scan path may not.

**Decision:** Extend simulator with optional **`lotId`** (narrow batch promo to one lot) for **support / admin** troubleshooting; do not change POS scan defaults in this pass.

### C5 — Duplicate resolution math

**Observation:** `resolveSellingPrice` and `applyEnterpriseListPriceLayers` are the **central** implementations; controllers should not re-implement bands.

**Decision:** Introduce a thin **`unifiedPriceResolution`** facade that **only composes** existing functions and returns a structured envelope (`canonicalMrp`, `trace`, `core`, `full`) for API/simulator consumers—**no second price formula**.

### C6 — CSV import/export for batch + catalog

**Status:** Org pricing bulk and CSV patterns exist on Price Master; full **batch CSV** import/export is a larger validation + partial-success project.

**Decision (this phase):** **Defer** batch CSV to a follow-up ticket; catalog CSV remains as today. Report lists this as partial.

### C7 — Migrations

All schema changes go through **new** Prisma migrations per `PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`; never edit applied migrations.

---

## 4. Implementation plan (phased)

### Phase A (this delivery — safe, backward compatible)

1. Prisma: optional `branchId` on `BatchPricingRule`; enum `PricingAuditEntityType.BATCH_PRICING_RULE`.
2. `findBestBatchPromoPrice`: branch scoping + optional `lotId` filter.
3. `resolveSellingPriceWithEnterprise` + `simulatePriceForVariant`: pass optional `lotId`.
4. `upsertBatchPricingRule`: accept `branchId`; **`logPricingAudit`** on create/update.
5. New read API: **list stock lots** for variant (org-scoped) for Price Master batch UI.
6. **`unifiedPriceResolution.service.ts`**: structured response + documented layer order string.
7. Governance: optional **`entityType`** filter on audit list.
8. Tests: branch filter helper / resolution facade smoke.
9. UI: Price Master — **Batch pricing** modal (list rules, create/edit, branch optional, link to governance audit).
10. UI: Simulator — optional **lot id** field wired to API.
11. UI: Enterprise discount rules — short banner: rules do not mutate catalog MRP.

### Phase B (follow-up, needs product + perf sign-off)

- Optional POS scan path using full enterprise resolution (flagged).
- Explicit governance “block vs warn” trace steps inside resolution (not only at POS commit).
- Batch CSV import/export with row-level validation report.
- Optional `ProductPricing.referenceCost` cache vs always-on ledger read (avoid drift).

---

## 5. Blockers (none for Phase A)

No destructive ambiguity requiring a stop: additive nullable `branchId`, optional `lotId` on simulate, and audit logging are backward compatible.

---

## 6. References (code)

- `src/api/v1/modules/pricing/pricingEngine.service.ts`
- `src/api/v1/modules/pricing/enterpriseResolution.service.ts`
- `src/api/v1/modules/pricing/retailDiscount.service.ts` (`assertPosSalePricingGovernance`)
- `src/api/v1/modules/pos/pos.service.ts` (barcode path)
- `prisma/schema.prisma` — `ProductPricing`, `BatchPricingRule`, `OrgPricingPolicy`, `PricingAuditLog`
