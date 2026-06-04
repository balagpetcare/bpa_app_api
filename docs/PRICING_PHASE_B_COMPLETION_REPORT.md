# Phase B — Enterprise Pricing Completion Report

## Summary

Phase B completes POS enterprise list parity (policy-gated), richer simulator governance + timeline output, enterprise layer diagnostics, batch pricing CSV import/export with partial success, governance UI filters, and documentation of why **batch display MRP** was not added as a separate column.

---

## Migrations

| Folder | Purpose |
|--------|---------|
| `prisma/migrations/20260416204500_org_policy_pos_enterprise_list_resolution/migration.sql` | Adds `org_pricing_policies.posUseEnterpriseListResolution` (default `false`). |

Run `npx prisma migrate deploy` and `node scripts/check-migration-integrity.js` per project policy on each environment.

---

## Schema

- **`OrgPricingPolicy`**: `posUseEnterpriseListResolution Boolean @default(false)` — opt-in for enterprise list on POS scan/browse when governance is off; implied when `posPricingGovernanceEnabled` is on (same resolver as `assertPosSalePricingGovernance`).

**Not added:** `batchDisplayMrp` on `BatchPricingRule`. Existing `promoPrice` / `recommendedSellPrice` plus catalog `ProductPricing.mrp` cover regulatory list and contextual sell; a third MRP field would increase drift risk without changing resolution math.

---

## Backend — files touched / added

| Area | Files |
|------|--------|
| Policy | `prisma/schema.prisma`, migration above, `pricingGovernance.service.ts`, `pricingGovernance.controller.ts` |
| POS | `pos.service.ts` (`getProductByBarcode`), `pos.controller.ts` (`getProducts`), **`posListPriceResolution.service.ts`** (single list-price entry for POS) |
| Resolution | `enterpriseResolution.service.ts` (`EnterpriseLayerDiagnostics`), `pricingEngine.service.ts` (`enterpriseDiagnostics` on `ResolvedPrice`), `unifiedPriceResolution.service.ts` (`buildRichResolutionTimeline`), `posPricingPolicy.util.ts` (+ test) |
| Simulate / CSV | `enterprisePricing.service.ts`, `enterprisePricing.controller.ts`, `pricing.routes.ts` |
| Tests | `posPricingPolicy.util.test.ts`, `unifiedPriceResolution.richTimeline.test.ts` |
| Docs | `docs/PRICING_PHASE_B_COMPLETION_PLAN.md`, this report |

---

## API endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/v1/pricing/batch-rules/export?orgId=&variantId=` | central read/write or `org.read` | Returns JSON `{ data: { csv, filename } }`. |
| POST | `/api/v1/pricing/batch-rules/import-csv` | `pricing.central.write` | Body `{ orgId, csv }` → `{ created, updated, failed, results[] }` per row. |
| POST | `/api/v1/pricing/simulate` | (unchanged bundle) | Optional body `discountedUnitPrice` → `resolutionTimeline` + governance preview step. |
| PATCH | `/api/v1/pricing/governance/policy` | `pricing.central.write` | Accepts `posUseEnterpriseListResolution`. |

---

## Resolution order (unchanged)

Same canonical order as Phase A (`DOCUMENTED_RESOLUTION_ORDER` in `unifiedPriceResolution.service.ts`): catalog → enterprise rules → campaigns → membership → batch promo floor → POS governance at commit (and simulated governance in admin simulator when discounted unit provided).

---

## Frontend

| Page / component | Changes |
|------------------|---------|
| `pricing-governance/page.tsx` | Toggle **POS enterprise list resolution**; audit tab **Apply filters** for entity type / key (URL params still honored on load). |
| `price-master/_components/PriceMasterSimulationPanel.tsx` | Optional discounted unit; **timeline table** + **diagnostics**; engine trace retained. |
| `price-master/_components/PriceMasterWorkspace.tsx` | Wires `discountedUnitPrice` into simulate POST. |
| `price-master/_components/PriceMasterBatchPricingPanel.tsx` | **Export CSV (this SKU)** + **Import CSV** with summary line. |

---

## Tests added / updated

- `posPricingPolicy.util.test.ts`
- `unifiedPriceResolution.richTimeline.test.ts`
- Existing `batchPricingBranchScope.util.test.ts` (unchanged behavior)

---

## Known risks

1. **POS getProducts**: When enterprise mode is on, variants without location price trigger batched `resolveSellingPriceWithEnterprise` (chunk size 8). Large catalogs add latency; mitigate with caching in a future iteration.
2. **CSV import**: Rows are processed sequentially; very large files may time out at the HTTP layer.
3. **Retail governance simulator**: Uses `validateRetailDiscountLine` — if no retail rule exists, a discounted price below list may fail with `NO_RETAIL_RULE` (expected when rules are mandatory).

---

## Manual QA

1. Apply migration; `prisma generate`; restart API.
2. **Governance**: Enable **POS governance** OR **POS enterprise list**; scan barcode / open POS product list — price should match enterprise list (campaigns/membership/batch when enabled).
3. **Governance off + enterprise list off**: Confirm legacy catalog-only behavior for scan/browse.
4. **Simulator**: Run with optional discounted unit; confirm timeline + governance row.
5. **Batch CSV**: Export from Price Master batch panel; edit one row; import; verify audit log and grid refresh.
6. **Governance audit**: Use filters + Apply; open deep link from Price Master batch audits.

---

## Commands run (development)

- `npx prisma generate`
- `npx tsc --noEmit` (backend)
- `npx jest` on the three pricing test files above (pass)

---

## Finishing pass (repair + regression hardening)

### Fixes applied

| Area | Change |
|------|--------|
| **Single POS orchestration** | Added `src/api/v1/modules/pricing/posListPriceResolution.service.ts` — `resolvePosBranchVariantListPrice` / `resolvePosBranchVariantListPricesBulk` call only `resolveSellingPrice` / `resolveSellingPriceWithEnterprise` (no duplicate math). `pos.service` barcode path and `pos.controller` browse path use this module; bulk path passes cached `OrgPricingPolicy` to avoid N policy reads per chunk. |
| **Barcode security** | `getProductByBarcode` resolves branch first; variant query requires `product.orgId = branch.orgId` and active product (prevents cross-org barcode hits). |
| **Simulator guards** | `simulatePriceForVariant` validates branch, variant, optional membership tier, and optional lot belong to `orgId` / variant before resolving. |
| **CSV import** | Max size guard (1.5M chars); lot must exist in org and **variantId must match lot**; `status` restricted to `ACTIVE` / `INACTIVE`; optional `branchId` must belong to org. |
| **CSV export** | When `variantId` is passed, verifies variant exists for org before export. |
| **API validation** | `simulate`: rejects non-finite `orgId` / `branchId` / `variantId`; safe `locationId` parse. `import-csv`: rejects empty `csv`; accepts string-like `csv` body. |
| **Frontend CSV** | Export handler treats `ownerGet` null / `success: false` / empty `csv` with clear errors. |
| **Governance UI** | Clicking **Audit log** tab re-runs `loadAll` so current filter inputs apply without relying only on first paint. |
| **Docs** | `PRICING_ENTERPRISE_IMPLEMENTATION_REPORT.md` §6 updated so it no longer claims POS/CSV/audit limitations that Phase B superseded. |

### Final file list (backend, finishing-inclusive)

- `src/api/v1/modules/pricing/posListPriceResolution.service.ts` **(new)**
- `src/api/v1/modules/pos/pos.service.ts`
- `src/api/v1/modules/pos/pos.controller.ts`
- `src/api/v1/modules/pricing/enterprisePricing.service.ts`
- `src/api/v1/modules/pricing/enterprisePricing.controller.ts`
- `docs/PRICING_ENTERPRISE_IMPLEMENTATION_REPORT.md`
- `docs/PRICING_PHASE_B_COMPLETION_REPORT.md` (this file)
- `bpa_web`: `app/owner/(larkon)/inventory/price-master/_components/PriceMasterBatchPricingPanel.tsx`, `app/owner/(larkon)/inventory/pricing-governance/page.tsx`

### Tests

- Unchanged targeted suite: `posPricingPolicy.util.test.ts`, `unifiedPriceResolution.richTimeline.test.ts`, `batchPricingBranchScope.util.test.ts` (all pass after pass).

### Remaining limitations

- `priceResolutionSnapshot` and other non-POS callers still invoke `pricingEngine` directly where appropriate; POS list display is unified via `posListPriceResolution`.
- Full-repo **bpa_web `tsc`** may still report unrelated errors; touched components pass IDE lint.
- Very large batch CSV files may hit HTTP timeouts (mitigated by size cap).

### Manual QA checklist (exact)

1. **Migrate** `20260416204500_org_policy_pos_enterprise_list_resolution` (if not already); `npx prisma generate`; restart API.
2. **Cross-org barcode:** On branch A (org 1), scan a barcode that exists only in org 2’s catalog — expect **no match** (null / not found).
3. **POS parity:** Enable `posUseEnterpriseListResolution` or POS governance; barcode + product browse prices match `POST /pricing/simulate` for same branch/variant (no location override).
4. **Simulator:** Invalid `branchId` / `variantId` / `lotId` for org → **400** with clear message.
5. **Batch CSV import:** Row with lot for wrong variant → row error; `status=FOO` → row error; oversized file → row 0 error; valid file → partial success JSON.
6. **Batch CSV export:** Wrong `variantId` for org → **500** message “not found”.
7. **Price Master:** Export with no rules → download still contains header row only (not treated as error).
8. **Governance:** Set audit filters, switch away and back to **Audit log** tab → list refreshes with current filter state.
9. **Regression:** Location price still overrides catalog/enterprise for POS when an effective `LocationPrice` row exists.
