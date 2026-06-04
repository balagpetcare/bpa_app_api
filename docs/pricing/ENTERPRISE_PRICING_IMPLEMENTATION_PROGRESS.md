# Enterprise pricing governance — implementation progress

**Last updated:** 2026-04-14

## Completed (this pass)

### Rollback repair

- Removed empty migration directories `20260415120000_enterprise_pricing_phase1_governance` and `20260415121000_enterprise_pricing_phases_2_8` (they had no `migration.sql`).
- Added **additive** migration `20260416140000_enterprise_pricing_recovery_ddl` with:
  - `org_pricing_policies` extension columns
  - `product_pricings.mrp`
  - `retail_discount_rules.updatedByUserId` + FK
  - `owner_discount_cards.membershipTierId` + FK
  - New enums and tables: `price_schedules`, `price_change_approval_requests`, `enterprise_discount_rules`, `membership_tiers` (+ exclusions, branch scopes), `pricing_campaigns` (+ scopes), `price_approval_matrix_rows`, `branch_override_requests`, `pricing_emergency_overrides`, `batch_pricing_rules`, `price_resolution_snapshots`

### Backend

- **`pricingGovernance.service.ts` / controller:** Full `OrgPricingPolicy` PATCH surface (block sale flags, stacking, scheduled/batch toggles, default max discount).
- **`validateCentralPricingBand` / `assertBranchOverrideWithinPolicy`:** MRP-aware upper cap (`min(maxPrice, mrp)`).
- **`pricingEngine.service.ts`:** MRP in product-pricing clamp; new **`resolveSellingPriceWithEnterprise`** (enterprise rules, campaigns, membership %, batch promo min).
- **`enterpriseResolution.service.ts`:** Layered list-price application + batch promo lookup.
- **`enterprisePricing.service.ts` + `enterprisePricing.controller.ts`:** CRUD-style APIs for enterprise rules, membership tiers (+ exclusions/scopes, card tier link), campaigns, approval matrix, branch override requests (+ approve → `BranchPricing` upsert), emergency overrides, price schedules, batch rules, cost signal, analytics summary, simulate.
- **`priceResolutionSnapshot.service.ts`:** Writes snapshots inside POS transaction (non-fatal on failure until DB migrated).
- **`pos.service.ts`:** Calls snapshot writer after order confirmation.
- **`retailDiscount.service.ts`:** POS governance uses `resolveSellingPriceWithEnterprise`; retail rule upsert sets `updatedByUserId`; **`patchRetailRuleStatus`**.
- **`pricing.service.ts` / `pricing.controller.ts`:** Org list **search** (`q`), **`mrp`** on upsert, **`POST /pricing/org/bulk`**, resolve query **`enterprise=1`** returns trace.
- **`pricing.routes.ts`:** All new routes registered; **`PATCH /retail-discount/rules/:id`** for deactivate.

### Frontend (`bpa_web`)

- **`pricing-governance/page.tsx`:** Extended policy toggles, retail rule **Deactivate**, quick links to other pricing pages.
- **New owner pages:** `price-master`, `enterprise-discount-rules`, `membership-pricing`, `pricing-campaigns`, `pricing-analytics` (under `app/owner/(larkon)/inventory/...`).
- **`price-override-request/page.jsx`:** Staff branch request + list (this branch).

### Documentation

- This file; recovery audit remains at `docs/pricing/ENTERPRISE_PRICING_RECOVERY_AUDIT.md`.

## Files touched (summary)

**Backend:** `prisma/migrations/20260416140000_enterprise_pricing_recovery_ddl/migration.sql`, `pricingGovernance.*`, `pricingEngine.service.ts`, `enterpriseResolution.service.ts`, `enterprisePricing.service.ts`, `enterprisePricing.controller.ts`, `priceResolutionSnapshot.service.ts`, `pricing.routes.ts`, `pricing.service.ts`, `pricing.controller.ts`, `retailDiscount.service.ts`, `retailDiscount.controller.ts`, `pos.service.ts`.

**Frontend:** `pricing-governance/page.tsx`, new `price-master`, `enterprise-discount-rules`, `membership-pricing`, `pricing-campaigns`, `pricing-analytics` pages, `staff/.../price-override-request/page.jsx`.

## Migrations added

| Folder | Purpose |
|--------|---------|
| `prisma/migrations/20260416140000_enterprise_pricing_recovery_ddl/` | Additive DDL for enterprise pricing phases 1–8 |

## Pending / follow-ups (low risk)

- **Owner UI** for approval matrix editing, branch override **owner review** queue, emergency override consumption on POS line item, price schedule **worker** to apply `PENDING` rows at `effectiveAt`.
- **Retail validate** endpoint: optionally recompute list server-side using enterprise resolution (currently callers may pass list).
- **`check-migration-integrity.js`:** Repo-wide checksum drift is pre-existing; run org repair process separately.
- **Canonical plan file** `/mnt/data/enterprise_pricing_governance_919cf4f7.plan.md` not in workspace — attach to `docs/pricing/` if available.

## Verification notes

- Run `node scripts/check-migration-files.js` after pull.
- Run `npm run prisma:generate` and **`prisma migrate deploy`** on a non-production-like target first; confirm tables exist before relying on POS snapshots (snapshots are non-fatal until then).
- Smoke: `GET /api/v1/pricing/governance/policy?orgId=`, `GET /api/v1/pricing/enterprise-discount/rules?orgId=`, `POST /api/v1/pricing/simulate`, owner pages load without 404.
