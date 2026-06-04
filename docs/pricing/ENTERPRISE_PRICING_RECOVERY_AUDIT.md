# Enterprise Pricing Governance — Recovery Audit & Implementation Plan

**Audit date:** 2026-04-14  
**Repos:** `backend-api`, `bpa_web`  
**Method:** Read-only inspection of Prisma schema, `prisma/migrations/**/*.sql`, `src/api/v1/modules/pricing/*`, `routes.ts`, POS integration, seeders, frontend routes and nav.

---

## 0. Canonical plan source

The path given in the task (`/mnt/data/enterprise_pricing_governance_919cf4f7.plan.md`) is **not available** in this Windows workspace. This report treats the **eight phases named in the task** as the phase checklist and uses **`prisma/schema.prisma`** as the strongest signal of **intended** enterprise architecture (models and enums already defined). Any line item not backed by migrations or runtime code is called out explicitly.

---

## 1. Executive summary

| Area | State |
|------|--------|
| **Prisma schema** | Rich enterprise surface: extended `OrgPricingPolicy`, `ProductPricing.mrp`, schedules, enterprise discount rules, membership, campaigns, branch overrides, approval matrix, emergency overrides, batch rules, `PriceResolutionSnapshot`. |
| **Applied migrations (SQL on disk)** | **Only** retail governance + POS hardening (`20260407120000_*`, `20260408120000_*`) plus older `product_pricings` / `branch_pricings`. **No** `migration.sql` found anywhere under `prisma/migrations` for `enterprise_discount_rules`, `price_schedules`, `membership_tiers`, campaigns, snapshots, etc. |
| **Enterprise migration folders** | `20260415120000_enterprise_pricing_phase1_governance` and `20260415121000_enterprise_pricing_phases_2_8` **exist as directories but are empty** (no `migration.sql`). |
| **Backend runtime** | **`src/api/v1/modules/pricing/` contains exactly 9 files** — classic pricing + governance **subset** + retail discount. **No** controllers/services for enterprise discount rules, price master workspace, campaigns, membership, branch override workflow, batch pricing, or analytics/snapshots. |
| **`pricing.routes.ts`** | Mounted at `/api/v1/pricing` in `routes.ts`; routes cover org/branch/resolve, governance policy + audit, retail discount rules/validate/approvals only. |
| **POS** | `pos.service.ts` uses `assertPosSalePricingGovernance`, `consumeRetailDiscountApprovalsForPaidOrder` from `retailDiscount.service.ts` and `resolveSellingPrice` from **`pricingEngine.service.ts`** (classic stack). **No** references to `PriceResolutionSnapshot` or enterprise rule models in `src/`. |
| **Permissions** | `seedRolesPermissions.ts` and `permissionsRegistry.service.ts` already define **enterprise-oriented** keys (`pricing.campaign.manage`, `pricing.membership.manage`, `pricing.branch.override.request`, `pricing.approval.matrix.manage`, `pricing.emergency.override`, `pricing.analytics.view`, `pricing.bulk.import`). **Most have no matching HTTP handlers.** |
| **Frontend** | `pricing-governance/page.tsx` **exists** and calls the narrow governance + retail APIs. **`ownerPricingNav.ts`** and **`permissionMenu.ts`** link to Price Master, Discount Rules, Membership, Campaigns, Analytics — **target directories exist under `app/owner/(larkon)/inventory/` but contain no `page.tsx` (empty trees)** → **Next.js 404** for those routes. Staff **`price-override-request`** folder exists but is **empty** (no page). |
| **Tooling** | `node scripts/check-migration-integrity.js` reports **broad checksum drift** across many migrations (pre-existing workspace issue); pricing-specific finding remains **empty enterprise migration folders** and **schema vs migration SQL gap** for enterprise tables. |

---

## 2. Implementation status by phase

Legend: **Full** = migrations (or verified DB parity) + API + intended UI/wiring coherent. **Partial** = some layers only. **Missing** = no durable migration SQL in repo and/or no runtime code.

| Phase | Name | Status | Evidence |
|-------|------|--------|----------|
| **1** | Harden governance foundation | **Partial** | **DB (from SQL):** `org_pricing_policies` created with 3 columns in `20260407120000_pricing_governance_retail_discount/migration.sql`; `posPricingGovernanceEnabled` in `20260408120000_pos_pricing_governance_hardening/migration.sql`. **Schema:** `OrgPricingPolicy` has many more fields (`blockSaleBelowCost`, `blockSaleBelowFloor`, `allowCampaignStacking`, `allowMembershipStacking`, `scheduledPricingEnabled`, `batchPricingEnabled`, `defaultMaxDiscountPercent`, …) at `schema.prisma` ~4774–4794 — **no matching `ALTER TABLE` in tracked migrations** (grep). **API/UI:** `pricingGovernance.controller.ts` / `pricingGovernance.service.ts` **only** read/update the **three** legacy toggles; Owner `pricing-governance/page.tsx` `OrgPolicy` type matches that narrow surface. |
| **2** | Product price master | **Partial** | **Schema:** `ProductPricing` includes `mrp`, `PriceSchedule`, `PriceChangeApprovalRequest` (~4732–4921). **Migrations:** base `product_pricings` table **without** `mrp` in `20260401130000_product_pricing_branch_pricing/migration.sql`. **API:** `pricing.routes.ts` `GET/POST /org`, branch, resolve — **no** schedule or price-change approval routes. **UI:** menu + `OWNER_PRICING_NAV.priceMaster` → **empty** `app/owner/(larkon)/inventory/price-master/`. |
| **3** | Discount rule engine (enterprise) | **Missing** (enterprise) / **Partial** (retail) | **Schema:** `EnterpriseDiscountRule` (~4924–4952). **Backend:** **no** `prisma.*enterpriseDiscountRule*` usage under `src/`. **Retail path:** `RetailDiscountRule` + `retailDiscount.controller.ts` / `retailDiscount.service.ts` + routes — **working stack** for per-SKU caps and approvals. **UI:** “Discount Rules” → `enterprise-discount-rules` folder **empty**. |
| **4** | Membership pricing engine | **Missing** | **Schema:** `MembershipTier`, exclusions, branch scopes (~4955–4997). **Backend/Frontend:** no modules or pages located. |
| **5** | Campaign and special pricing | **Missing** | **Schema:** `PricingCampaign`, `PricingCampaignScope` (~5000–5038). **Backend:** no campaign services/routes; **no** `grep` hits for campaign activation/cron in `src/` for this feature set. **UI:** `pricing-campaigns` directory **empty**. |
| **6** | Branch override request + approval matrix | **Missing** | **Schema:** `BranchOverrideRequest`, `PriceApprovalMatrixRow`, `PricingEmergencyOverride` (~5041–5101). **Backend:** no dedicated routes (branch pricing **direct** `POST /pricing/branch` remains). **UI:** empty staff `price-override-request`; no owner workflow pages found. |
| **7** | Batch-aware pricing | **Missing** | **Schema:** `BatchPricingRule` (~5104–5123). **Backend:** no services/routes under `pricing/`. |
| **8** | Analytics + `PriceResolutionSnapshot` | **Missing** | **Schema:** `PriceResolutionSnapshot` (~5126–5140). **Backend:** **zero** `PriceResolutionSnapshot` / `priceResolutionSnapshot` references in `src/`. **POS:** no snapshot writes observed. **UI:** `pricing-analytics` directory **empty**. |

---

## 3. File-by-file evidence (high signal)

### 3.1 Backend — Prisma

| Artifact | Finding |
|----------|---------|
| `prisma/schema.prisma` | Full enterprise model block for phases 2–8 (see §2). |
| `prisma/migrations/20260407120000_pricing_governance_retail_discount/migration.sql` | Org policy (narrow), audit log, retail rules & approvals; `PricingAuditEntityType` **5** values only. |
| `prisma/migrations/20260408120000_pos_pricing_governance_hardening/migration.sql` | `posPricingGovernanceEnabled`, approval consumption FKs. |
| `prisma/migrations/20260415120000_enterprise_pricing_phase1_governance/` | **Empty** (no `migration.sql`). |
| `prisma/migrations/20260415121000_enterprise_pricing_phases_2_8/` | **Empty** (no `migration.sql`). |
| Grep `enterprise_discount`, `price_schedules`, `membership_tiers`, `price_resolution_snapshots` under `prisma/migrations/**/*.sql` | **No matches** — enterprise tables **not** created by any committed migration SQL in this checkout. |

**Implication:** Either enterprise tables were never migrated in this branch, or DDL lived only in deleted/uncommitted `migration.sql` files. **`prisma generate`** can succeed while **`migrate deploy`** on a DB that lacks those tables would fail at runtime when Prisma touches missing tables — **treat DB state as unknown** until `\d` / introspection is run in your environment.

### 3.2 Backend — Runtime modules

| File | Role | Notes |
|------|------|------|
| `src/api/v1/modules/pricing/pricing.routes.ts` | Route table | Endpoints: `/`, `/resolve`, `/org`, `/branch`, `/governance/policy`, `/governance/audit`, `/retail-discount/*` only. |
| `src/api/v1/modules/pricing/pricing.controller.ts` | CRUD + resolve | Classic org/branch/location pricing; uses `assertBranchOverrideWithinPolicy`. |
| `src/api/v1/modules/pricing/pricingEngine.service.ts` | Price resolution | **Branch → ProductPricing (min/max, not `mrp`) → LocationPrice**; no campaigns/membership/enterprise rules. |
| `src/api/v1/modules/pricing/pricingGovernance.*` | Policy + audit | **Three** policy fields in API; band validation helpers exist in service. |
| `src/api/v1/modules/pricing/retailDiscount.*` | Retail caps & approvals | Integrated with routes + POS. |
| `src/api/v1/routes.ts` | Mount | `router.use("/pricing", … pricing.routes)` ~line 424. |
| **Absent (reverted or never landed)** | — | No `pricemaster`, `enterprisePricing`, `enterpriseDiscountRule`, `membershipTier`, `pricingCampaign`, `branchOverride`, `batchPricing`, `pricingAnalytics`, `priceResolutionSnapshot` modules under `src/` (grep). |

### 3.3 POS

| File | Finding |
|------|---------|
| `src/api/v1/modules/pos/pos.service.ts` | Imports `assertPosSalePricingGovernance`, `consumeRetailDiscountApprovalsForPaidOrder` from `retailDiscount.service`; uses `resolveSellingPrice` from `pricingEngine.service`. |

### 3.4 Permissions

| File | Finding |
|------|---------|
| `prisma/seeders/seedRolesPermissions.ts` | Lines ~14–27: full enterprise permission **keys** seeded; owner role bundle includes campaign, membership, override request/approve, matrix, emergency, analytics, bulk import. |
| `src/api/v1/services/permissionsRegistry.service.ts` | Same keys documented for RBAC registry. |

### 3.5 Frontend (`bpa_web`)

| Artifact | Finding |
|----------|---------|
| `src/lib/ownerPricingNav.ts` | Defines hub URLs under `/owner/inventory/…`. |
| `src/lib/permissionMenu.ts` | Owner **Pricing** group with children pointing at those URLs; permissions gate each item. |
| `app/owner/(larkon)/inventory/pricing-governance/page.tsx` | **Implemented**; uses `/api/v1/pricing/governance/*` and `/api/v1/pricing/retail-discount/*`. |
| `app/owner/(larkon)/inventory/price-master/` | **Directory exists, no files** → 404. |
| `…/enterprise-discount-rules/`, `membership-pricing/`, `pricing-campaigns/`, `pricing-analytics/` | Same. |
| `app/staff/(larkon)/branch/[branchId]/inventory/price-override-request/` | **Empty** → 404. |

---

## 4. Schema / API / UI gaps (consolidated)

| Gap | Detail |
|-----|--------|
| **Schema vs migrations** | Many models in `schema.prisma` have **no** `CREATE TABLE` in any `migration.sql` in this repo. |
| **Schema vs API** | Enterprise models exist in Prisma client surface but **no** HTTP layer or services. |
| **Org policy fields** | Extended flags exist in schema; **governance PATCH** cannot set them; DB columns may be absent. |
| **`ProductPricing.mrp`** | In schema; **not** in base `product_pricings` migration; **not** used in `pricingEngine.service` clamp (uses `maxPrice` only). |
| **`PricingAuditEntityType`** | Still 5 enum values; enterprise entities would need enum + migration if audit is required per plan. |
| **Menu vs pages** | Sidebar shows **Pricing** items that **404** for users with those permissions. |
| **Permissions vs routes** | Keys suggest features; **no** matching routes → confusing RBAC surface. |

---

## 5. Rollback / reversion findings

1. **Empty migration directories** (`20260415120000_*`, `20260415121000_*`) — strong sign of **incomplete or reverted** migration authoring; Prisma history may be broken for anyone adding new migrations until resolved.  
2. **Git status (conversation snapshot)** previously listed many `src/api/v1/modules/pricing/*.ts` files as **untracked** enterprise modules; **current tree** shows **only 9 files** — those modules are **not present** in the working tree (removed or never committed).  
3. **Frontend** owner enterprise route folders **exist as placeholders** without pages — consistent with **partial scaffold + removed pages**.  
4. **Integrity script** reports **70** migrations with checksum mismatch vs DB — **not pricing-specific** but blocks trusting “migrate deploy” without org process (`docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`).

---

## 6. Exact recovery sequence (recommended)

1. **Freeze scope** — Re-import or attach the canonical `enterprise_pricing_governance_919cf4f7.plan.md` into `docs/pricing/` for diffable requirements (optional doc; user did not mandate plan file in repo).  
2. **Establish DB truth** — On a staging DB, introspect whether enterprise tables/columns exist. Compare to `schema.prisma`. **Do not** `migrate reset` or `db push` on production-like DB per project policy.  
3. **Repair migration chain (org process)** — Resolve checksum drift; populate **new** additive migrations (or restore lost `migration.sql` from VCS history if recoverable) so `CREATE TABLE` / `ALTER TABLE` match **intended** schema. **Never edit already-applied migrations**; add forward-fix migrations if DB already partial.  
4. **Phase 1 completion** — Extend `pricingGovernance.service` / controller + Owner governance page for **all** `OrgPricingPolicy` fields that exist in DB; extend `PricingAuditEntityType` only with a migration if new audit types are required.  
5. **Phase 2** — Add `mrp` to DB if missing; extend `pricingEngine` and org pricing APIs for schedules and price-change approvals; implement `price-master` page calling new/extended endpoints.  
6. **Phase 3** — New `enterpriseDiscountRule` service + routes; wire engine order **after** base price; build `enterprise-discount-rules` UI.  
7. **Phase 4–5** — Membership + campaign APIs, activation rules, optional worker/cron for schedule/campaign state.  
8. **Phase 6** — Branch override request + matrix + emergency override APIs; staff + owner UIs.  
9. **Phase 7** — Batch pricing evaluation hooks (likely GRN/expiry signals).  
10. **Phase 8** — Write `PriceResolutionSnapshot` on order commit path; read APIs + `pricing-analytics` UI.  

---

## 7. Risks and dependencies

| Risk | Mitigation |
|------|------------|
| **DB missing enterprise tables** while schema defines them | Introspect before coding; additive migrations only. |
| **Checksum drift** | Follow internal migration repair playbook; avoid rewriting old files. |
| **POS regression** | Keep `retailDiscount` + `assertPosSalePricingGovernance` as regression baseline; add enterprise resolution **behind** feature flags or policy toggles. |
| **Menu 404s** | Either hide menu items until pages exist, or ship minimal “Coming soon” pages (product decision; not done in this audit). |
| **Engine complexity** | Define deterministic stacking (campaign vs membership vs enterprise rule) in a single resolver module to avoid double-discount bugs. |

---

## 8. Recommended implementation order

1. Migration / schema **parity** (empty folders + missing DDL) — **blocker** for safe use of Prisma models.  
2. **Phase 1** API + UI parity with schema columns.  
3. **Phase 2** price master + MRP + schedules (depends on 1).  
4. **Phase 3** enterprise discount + engine integration.  
5. **Phases 4–5** membership + campaigns.  
6. **Phase 6** branch override workflow (depends on policy + matrix).  
7. **Phase 7** batch rules (depends on lot/cost data quality).  
8. **Phase 8** snapshots + analytics (depends on stable resolution order).  

---

## 9. “Do next” checklist (implementation)

- [ ] Locate canonical plan markdown in VCS or attach to `docs/pricing/` for traceability.  
- [ ] Run DB introspection / `\dt` equivalent: confirm which of `enterprise_discount_rules`, `price_schedules`, `membership_tiers`, `pricing_campaigns`, `branch_override_requests`, `batch_pricing_rules`, `price_resolution_snapshots`, extra `org_pricing_policies` columns **exist**.  
- [ ] Fix migration authoring: **either** add `migration.sql` into the empty enterprise folders **only if** they are not yet applied anywhere, **or** delete empty dirs and replace with **new** timestamped migrations (follow team policy).  
- [ ] Reconcile `check-migration-integrity.js` drift per `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`.  
- [ ] Extend `pricingGovernance` PATCH + Owner UI for full org policy surface **that exists in DB**.  
- [ ] Add `GET/PATCH/DELETE` (or documented upsert) for retail rules if plan requires rule lifecycle beyond POST upsert.  
- [ ] Implement Phase 2 API + `app/owner/.../price-master/page.tsx` (minimum: list org pricing + edit + MRP).  
- [ ] Scaffold enterprise discount REST + page (Phase 3).  
- [ ] Remove or hide Owner menu links to routes with no `page.tsx` until pages ship (optional quick UX fix).  
- [ ] Add `PriceResolutionSnapshot` writes in order finalization path + idempotent keys (Phase 8).  

---

## 10. Concise summary (for handoff)

**What exists:** Classic org/branch/location pricing APIs; **retail** discount rules, validation, approvals; narrow governance **GET/PATCH** + audit listing; POS governance + approval consumption; Prisma **schema** and permission **seeds** for a **full** enterprise pricing vision; Owner **pricing governance** page; nav entries for all pricing sub-areas.

**What is missing:** **`migration.sql`** for enterprise phases (folders empty); **almost all** runtime code for phases 2–8; **Owner pages** for price master, enterprise discounts, membership, campaigns, analytics (directories **empty**); **staff** branch override UI; **engine** and **POS** integration for enterprise rules, campaigns, membership, batch pricing, and **price resolution snapshots**.

**Implement next (modules / files):**

1. `prisma/migrations/<new>_enterprise_pricing_*` — additive DDL to match `schema.prisma` (after DB diff).  
2. `src/api/v1/modules/pricing/pricingGovernance.service.ts` + `pricingGovernance.controller.ts` — full `OrgPricingPolicy` surface.  
3. New services + route registrations: e.g. `enterpriseDiscountRule.service.ts`, `priceSchedule.service.ts`, `branchOverrideRequest.service.ts`, `membershipTier.service.ts`, `pricingCampaign.service.ts`, `batchPricingRule.service.ts`, `priceResolutionSnapshot.service.ts` — **exact filenames TBD**; wire in `pricing.routes.ts` or sub-routers.  
4. `src/api/v1/modules/pricing/pricingEngine.service.ts` — unified resolution pipeline (MRP, layers, stacking).  
5. `src/api/v1/modules/pos/pos.service.ts` — snapshot persistence at sale time.  
6. `bpa_web/app/owner/(larkon)/inventory/price-master/page.tsx` (and siblings) + API client calls.  
7. `bpa_web/app/staff/(larkon)/branch/[branchId]/inventory/price-override-request/page.*` — wired to branch override APIs.

---

*End of audit. No application code was changed for this document beyond adding this file.*
