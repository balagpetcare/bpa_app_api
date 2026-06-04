# Pricing Enterprise Platform — Implementation Report

This report summarizes what existed, what was delivered in the **Phase A** safe pass (see `PRICING_ENTERPRISE_IMPLEMENTATION_PLAN.md`), and what remains for follow-up.

---

## 1. What existed before

- **Catalog:** `ProductPricing` (base, markup, min/max, MRP, effective dates).
- **Branch:** `BranchPricing` override; **location:** `LocationPrice`.
- **Batch context:** `BatchPricingRule` tied to `StockLot` (`lotId`), promo/recommended prices, validity; resolution via `findBestBatchPromoPrice` after enterprise list layers.
- **Layers:** Enterprise discount rules, campaigns, membership — applied in `applyEnterpriseListPriceLayers` (see plan for exact order).
- **Governance:** `OrgPricingPolicy`, retail discount validators; POS may use `resolveSellingPrice` on some paths vs `resolveSellingPriceWithEnterprise` on governance path (documented conflict).
- **Audit:** `PricingAuditLog` for several entity types; governance UI listed audits with fixed query.

---

## 2. What was changed (Phase A)

### 2.1 Schema & migration

| Item | Detail |
|------|--------|
| Migration | `prisma/migrations/20260416193000_batch_pricing_rule_branch_scope/migration.sql` |
| `batch_pricing_rules` | Optional `branchId` → `branches(id)`, nullable org-wide rules preserved |
| `PricingAuditEntityType` | New enum value `BATCH_PRICING_RULE` |
| Index | `batch_pricing_rules_orgId_variantId_branchId_idx` |

**Prisma:** `BatchPricingRule.branchId`, `Branch.batchPricingRulesScoped`; enum extended in `schema.prisma`.

**Deploy:** Run `npx prisma migrate deploy` (or your pipeline) and `node scripts/check-migration-integrity.js` per project policy — not executed as part of this report.

### 2.2 Resolution engine (single math, extended context)

- **`enterpriseResolution.service.ts`:** `findBestBatchPromoPrice` accepts optional **`lotId`** (pin to one lot) and filters rules by **`branchId`** (null = all branches; branch-specific wins per `batchPricingBranchScope.util.ts`).
- **`pricingEngine.service.ts`:** `resolveSellingPriceWithEnterprise` passes optional **`lotId`** into batch promo lookup.
- **`pricing.controller.ts`:** `GET /pricing/resolve` with enterprise mode passes **`lotId`** from query when present.

### 2.3 Unified envelope (no duplicate formulas)

- **`unifiedPriceResolution.service.ts`:** `DOCUMENTED_RESOLUTION_ORDER`, `buildUnifiedResolutionEnvelope` — documents canonical pipeline and returns `canonicalMrp`, `coreListPrice`, `finalListAfterLayers`, `batchPromoApplied`.

### 2.4 Enterprise pricing API & audit

- **`enterprisePricing.service.ts`:** `simulatePriceForVariant` resolves branch SHOP `inventoryLocation`, passes `shopLocationId`, optional **`lotId`**; attaches **`resolutionMeta`** via envelope helper; **`upsertBatchPricingRule`** supports **`branchId`**, validates org, **`logPricingAudit`** for create/update with `BATCH_PRICING_RULE`.
- **`listBatchPricingRules`:** Includes `branch` in response shape where applicable.
- **`listStockLotsForVariant`:** New helper — Prisma `stockLot` list for org + variant (Price Master lot picker).

### 2.5 Routes

File: `src/api/v1/modules/pricing/pricing.routes.ts`

| Method | Path | Permission notes |
|--------|------|------------------|
| GET | `/stock-lots` | `pricing.central.write` **or** `pricing.central.read` **or** `org.read` |
| GET | `/batch-rules` | Same read set as above |
| POST | `/batch-rules` | `pricing.central.write` |
| POST | `/simulate` | Unchanged permission bundle (central read/write, audit, org.read, retail rule manage) |

**Governance audit list:** `pricingGovernance.controller.ts` / `pricingGovernance.service.ts` — optional query **`entityType`**, **`entityKeyContains`**.

### 2.6 Tests

- **`batchPricingBranchScope.util.ts`** + **`batchPricingBranchScope.util.test.ts`** — pure branch-matching logic (no Prisma / `DATABASE_URL` required in Jest).

### 2.7 Frontend (bpa_web)

| Area | Files |
|------|--------|
| Price Master | `app/owner/(larkon)/inventory/price-master/_components/PriceMasterBatchPricingPanel.tsx`, `PriceMasterDetailDrawer.tsx`, `PriceMasterWorkspace.tsx`, `PriceMasterSimulationPanel.tsx` |
| Discount rules copy | `app/owner/(larkon)/inventory/enterprise-discount-rules/_components/EnterpriseRulesWorkspace.tsx` |
| Governance | `app/owner/(larkon)/inventory/pricing-governance/page.tsx` — reads **`tab`**, **`entityType`**, **`entityKeyContains`** from URL on load; audit fetch uses those filters |

**Price Master drawer:** “Batch rule audits” links to
`/owner/inventory/pricing-governance?tab=audit&entityType=BATCH_PRICING_RULE`.

---

## 3. Resolution order (engineering canonical)

As implemented and documented in `DOCUMENTED_RESOLUTION_ORDER` inside `unifiedPriceResolution.service.ts`:

1. Core catalog list (branch override → product pricing band → location price).
2. Enterprise discount rules (priority, stackability).
3. Active pricing campaigns (policy-controlled stacking).
4. Membership tier percent (exclusions, branch scopes, caps).
5. Batch promo floor (on-hand lots at branch SHOP location; optional `BatchPricingRule.branchId`).
6. POS governance validation when enabled (does not rewrite stored MRP).

**Note:** This order was **not** reshaped to match an alternate “batch before campaign” diagram — by explicit Phase A decision (avoid silent org-wide price shifts).

---

## 4. New / touched backend files (primary)

- `prisma/schema.prisma`
- `prisma/migrations/20260416193000_batch_pricing_rule_branch_scope/migration.sql`
- `src/api/v1/modules/pricing/enterpriseResolution.service.ts`
- `src/api/v1/modules/pricing/pricingEngine.service.ts`
- `src/api/v1/modules/pricing/pricing.controller.ts`
- `src/api/v1/modules/pricing/enterprisePricing.service.ts`
- `src/api/v1/modules/pricing/enterprisePricing.controller.ts`
- `src/api/v1/modules/pricing/pricing.routes.ts`
- `src/api/v1/modules/pricing/pricingGovernance.service.ts`
- `src/api/v1/modules/pricing/pricingGovernance.controller.ts`
- `src/api/v1/modules/pricing/unifiedPriceResolution.service.ts`
- `src/api/v1/modules/pricing/batchPricingBranchScope.util.ts`
- `src/api/v1/modules/pricing/batchPricingBranchScope.util.test.ts`
- `docs/PRICING_ENTERPRISE_IMPLEMENTATION_PLAN.md`
- `docs/PRICING_ENTERPRISE_IMPLEMENTATION_REPORT.md` (this file)

---

## 5. UI changes summary

- **Price Master:** Batch / lot pricing panel (list rules, upsert with optional branch scope, lots list); drawer explains canonical MRP vs runtime layers; simulator supports optional **lot id** and shows trace / `resolutionMeta`.
- **Enterprise discount rules:** Subtitle clarifies rules do not overwrite catalog MRP.
- **Pricing governance:** Audit API query aligned with URL params; deep link from Price Master for batch rule audits.

---

## 6. Known limitations (Phase B / follow-up)

**Update (Phase B + finishing pass):** POS scan/browse can use enterprise list resolution when org policy enables it; batch CSV import/export exists; governance audit has in-page filters. Items below are still accurate where noted.

1. **Resolution layer reorder** — Not done; requires product sign-off and regression against `PriceResolutionSnapshot` history.
2. **POS list resolution** — Uses shared `posListPriceResolution.service.ts` → canonical `pricingEngine` functions. Enterprise list applies when `posPricingGovernanceEnabled` or `posUseEnterpriseListResolution` is on (see `PRICING_PHASE_B_COMPLETION_REPORT.md`).
3. **Catalog CSV** — Price Master org CSV remains separate from batch-rule CSV.
4. **Dedicated `batchMrp` column** — Still not added; `promoPrice` / `recommendedSellPrice` + catalog MRP suffice.
5. **Governance “block trace” at POS commit** — Commit-time enforcement remains in `retailDiscount.service`; simulator adds read-only governance preview when a discounted unit is supplied.
6. **Performance** — POS product browse with enterprise mode resolves in chunks; very large variant sets may need caching later.

---

## 7. How batch-aware pricing works

1. Org enables batch pricing in policy where applicable; resolution uses **branch SHOP** `inventoryLocation` for on-hand lots.
2. **`BatchPricingRule`** rows target a **`lotId`** (and `variantId`). Optional **`branchId`**: null applies everywhere; set value restricts rule to that branch’s selling context.
3. **`lotId`** on simulate / resolve narrows promo evaluation to that lot when provided.
4. If no applicable batch rule, pricing falls back to catalog + list layers only.

---

## 8. How governance enforcement works (unchanged baseline + audit)

- **Floor / cost / policy** — Still driven by `OrgPricingPolicy` and retail discount governance paths already in the codebase.
- **MRP / catalog edits** — Still audited via existing product pricing audit patterns.
- **Batch rules** — Create/update now emit **`PricingAuditLog`** with `entityType = BATCH_PRICING_RULE`.

---

## 9. Suggested next enhancements

1. POS feature flag: full enterprise resolution on barcode scan with latency safeguards.
2. Batch CSV import/export with row-level validation and partial success report.
3. Resolver-level governance trace array returned on simulate for admin QA.
4. Optional `batchDisplayMrp` column if regulatory labeling must differ from `promoPrice`.
5. Expand Jest coverage: integration tests with test DB for `findBestBatchPromoPrice` precedence (branch vs org-wide).

---

## 10. Manual verification steps

1. **Migrate:** Apply `20260416193000_batch_pricing_rule_branch_scope` on a staging DB; run migration integrity script.
2. **Batch rule:** Create org-wide batch rule; create second rule with same lot + `branchId` for one branch; simulate with/without `lotId` and branch; confirm branch-scoped rule preferred.
3. **Price Master:** Open SKU drawer → Batch / lot pricing → list lots, upsert rule, deactivate.
4. **Simulator:** Run with branch + optional lot id; confirm `resolutionMeta.documentedOrder` and breakdown visible.
5. **Audit:** Open “Batch rule audits” from Price Master; confirm table shows only `BATCH_PRICING_RULE` rows (or empty until rules are edited).
6. **Regression:** POS checkout with governance on/off; catalog pricing save; campaigns/membership pages unchanged in behavior.

---

## 11. Commands run (development)

- `npx prisma generate` (after schema change)
- `npx tsc --noEmit` (backend, exit 0)
- `npx jest src/api/v1/modules/pricing/batchPricingBranchScope.util.test.ts --runInBand` (pass)
