# Phase B — Enterprise Pricing Completion Plan

## Current state (reconciled with repo)

- **Phase A** is present: `BatchPricingRule.branchId`, `lotId` narrowing, `unifiedPriceResolution` envelope, batch audit, governance audit query params + URL, Price Master batch panel + simulator lot field.
- **POS barcode** (`pos.service.ts#getProductByBarcode`): uses `resolveSellingPrice` after location price miss; **does not** apply enterprise layers unless we change it.
- **POS product list** (`pos.controller.ts#getProducts`): sets `price` only from `locationPriceMap`; no catalog/enterprise resolution.
- **Governance commit** (`assertPosSalePricingGovernance`): already uses `resolveSellingPriceWithEnterprise` — mismatch risk when scan shows catalog-only while governance compares enterprise list.

## Remaining gaps

1. POS scan + browse prices aligned with enterprise list when policy requires it.
2. Rich simulator / API trace (governance preview, batch skip reasons, diagnostics counts).
3. Batch pricing CSV import/export with partial success + audits on import.
4. Single canonical resolution order string (already in `DOCUMENTED_RESOLUTION_ORDER`); extend with diagnostics, not duplicate math.
5. Optional `batchDisplayMrp`: **not adding** — `promoPrice` / `recommendedSellPrice` + catalog `mrp` cover display; separate column only adds drift risk (documented in report).

## Compatibility risks

| Risk | Mitigation |
|------|------------|
| Changing default POS list price for all orgs | Use **`posUseEnterpriseListResolution`** default `false`; auto-use enterprise when **`posPricingGovernanceEnabled`** is true (must match governance validator). |
| N+1 on getProducts | Load policy once; only when enterprise path active, resolve variants **without** location price in **chunks of 8** `Promise.all`. |
| Duplicate pricing math | Only call existing `resolveSellingPrice` / `resolveSellingPriceWithEnterprise`; extend **trace/diagnostics** in `enterpriseResolution` + `unifiedPriceResolution`. |

## Implementation sequence

1. Prisma: `OrgPricingPolicy.posUseEnterpriseListResolution Boolean @default(false)` + migration SQL.
2. `pricingGovernance.service.ts` + controller: wire patch/get for new field.
3. `enterpriseResolution.service.ts`: add `diagnostics` to layer result (counts).
4. `unifiedPriceResolution.service.ts`: `buildRichResolutionTimeline`, integrate diagnostics + batch skip reason.
5. `simulatePriceForVariant` + controller: optional `discountedUnitPrice`; attach `governancePreview` via `validateRetailDiscountLine`.
6. `pos.service.ts` + `pos.controller.ts`: enterprise path per policy.
7. `enterprisePricing.service.ts`: CSV export/import helpers; audit on each upsert.
8. `pricing.routes.ts` + controller: `GET /batch-rules/export`, `POST /batch-rules/import-csv`.
9. Tests: unified timeline (mock-free where possible), POS policy helper, CSV row validation pure function.
10. Frontend: governance toggle, simulator trace + optional discounted price, batch panel CSV buttons, audit filter inputs.

## Blockers

None identified: additive column, behavioral change gated by existing governance flag or new opt-in flag.

## Execution status (post-implementation)

- **batchDisplayMrp:** Not implemented; documented in `PRICING_PHASE_B_COMPLETION_REPORT.md`.
- **POS parity:** Implemented via `shouldPosUseEnterpriseListPriceResolution` (governance on **or** new policy flag).
- **CSV / timeline / governance UI:** Implemented as in the completion report.
