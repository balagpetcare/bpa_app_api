# BPA Enterprise Pricing Architecture — Master Plan

**Status:** Implementation-ready reference
**Audience:** Engineering, product, operations
**Scope:** Multi-tenant org, multi-branch clinic / pharmacy / shop / warehouse / POS, owner governance, campaigns, membership, batch-level pricing, auditability

**Related repo docs:** `ENTERPRISE_PRICING_RECOVERY_AUDIT.md`, `ENTERPRISE_PRICING_IMPLEMENTATION_PROGRESS.md`, `CANONICAL_ENTERPRISE_PRICING_PLAN.md` (phase checklist; this document is the **canonical architecture** narrative).

---

## SECTION A — CURRENT STATE ANALYSIS (CODEBASE-TRUTH)

### A.1 Backend pricing surface (modules / routes)

| Area | Location | Role |
|------|----------|------|
| **Catalog list resolution** | `pricingEngine.service.ts` | `resolveSellingPrice` (branch override → product pricing markup+min/max/MRP → location price) |
| **Enterprise list layers** | `enterpriseResolution.service.ts` | `applyEnterpriseListPriceLayers`: enterprise rules → campaigns → membership tier % → batch diagnostics |
| **Batch promo floor** | `enterpriseResolution.service.ts` | `findBestBatchPromoPrice` (lot-linked `BatchPricingRule`, org `batchPricingEnabled`, shop location) |
| **Unified entry** | `pricingEngine.service.ts` | `resolveSellingPriceWithEnterprise` = core catalog + layers + optional batch floor |
| **POS list price** | `posListPriceResolution.service.ts` | `resolvePosBranchVariantListPrice` / bulk — **delegates only** to engine; no duplicate formulas |
| **POS governance** | `retailDiscount.service.ts` | `assertPosSalePricingGovernance`: when `posPricingGovernanceEnabled`, resolves list via `resolveSellingPriceWithEnterprise`, then `validateRetailDiscountLine` vs discounted unit |
| **Policy toggles** | `posPricingPolicy.util.ts` | `shouldPosUseEnterpriseListPriceResolution` — aligns scan/browse list with governance path |
| **Retail discount (POS line)** | `retailDiscount.service.ts` + `retailDiscount.controller.ts` | Per-variant caps, approval workflow — **different** from enterprise list rules |
| **Owner / admin APIs** | `pricing.routes.ts` | Org/branch pricing, governance policy, retail rules, enterprise rules, campaigns, membership, batch rules, simulate, analytics, snapshots |
| **Simulation / analytics** | `enterprisePricing.service.ts`, `enterprisePricing.controller.ts` | Uses `resolveSellingPrice` + `resolveSellingPriceWithEnterprise` for previews |
| **Order snapshots** | `priceResolutionSnapshot.service.ts` | Persists core list, full trace, sold unit, margin vs reference list |
| **Timeline / docs** | `unifiedPriceResolution.service.ts` | `DOCUMENTED_RESOLUTION_ORDER`, `buildRichResolutionTimeline` — **no duplicate math** |

**Important naming distinction:**
- **`EnterpriseDiscountRule`** = catalog **list-price automation** (before POS line discount).
- **`RetailDiscountRule`** = **POS selling** discount caps / approval thresholds vs **resolved list**.

### A.2 Frontend (bpa_web) — owner pricing UX

- **Navigation hub:** `src/lib/ownerPricingNav.ts` — governance, price master, enterprise discount rules, campaigns, membership, analytics.
- **Pages (representative):**
  - `app/owner/(larkon)/inventory/pricing-governance/page.tsx`
  - `app/owner/(larkon)/inventory/price-master/_components/*`
  - `app/owner/(larkon)/inventory/enterprise-discount-rules/*` (list + full-page create)
  - `app/owner/(larkon)/inventory/pricing-campaigns/*`, `membership-pricing/*`, `pricing-analytics/*`
- **Patterns:** Owner API via `ownerApi.ts`; permission-gated screens; simulation panels calling `/api/v1/pricing/simulate` where applicable.

### A.3 Rule types and application

| Rule type | Storage | Applied in engine |
|-----------|---------|-------------------|
| Branch override | `BranchPricing` | First in `resolveSellingPrice` if effective |
| Org product pricing | `ProductPricing` | Base × markup, clamped to min/max/MRP |
| Location price | `LocationPrice` | Fallback when branch/location context |
| Enterprise discount | `EnterpriseDiscountRule` | After core list; priority asc; stackable chain stops at non-stackable |
| Campaign | `PricingCampaign` + scopes | After enterprise rules; stacking via `OrgPricingPolicy.allowCampaignStacking` |
| Membership tier | `MembershipTier` + exclusions + branch scopes | Percent off list after campaigns; per-item cap |
| Batch promo | `BatchPricingRule` | Min promo among on-hand lots at shop (when enabled) |
| Retail discount (POS) | `RetailDiscountRule` + approvals | **After** list known; validates sale unit vs list + caps |

### A.4 Data flow (variant → list → POS)

1. **Catalog list:** `resolveSellingPrice(orgId, variantId, branchId, locationId, at)`.
2. **List + layers:** `resolveSellingPriceWithEnterprise(...)` adds enterprise + campaign + membership + batch floor.
3. **POS display:** `resolvePosBranchVariantListPrice` chooses enterprise vs core-only based on `OrgPricingPolicy`.
4. **POS commit (governance on):** `assertPosSalePricingGovernance` recomputes list and runs retail discount validation per line.
5. **Post-order:** `writePriceResolutionSnapshotsForOrder` stores core vs layered trace vs actual sold price.

### A.5 Preview / simulation

- **Enterprise discount rules** workspace: simulation panel posts to `/api/v1/pricing/simulate` (controller permissions include retail rule manage / audit / read).
- **Unified timeline:** `buildRichResolutionTimeline` builds UI-oriented steps from engine outputs (no second math).

### A.6 Governance / approval / audit

- **Org policy:** `OrgPricingPolicy` — POS governance, floor, cost floor, campaign stacking, batch pricing, default max discount %.
- **Retail approvals:** `RetailDiscountApprovalRequest` — POS discount below threshold; consumed on order.
- **Price change / branch override:** `PriceChangeApprovalRequest`, `BranchOverrideRequest`, `PricingEmergencyOverride`.
- **Audit:** `PricingAuditLog` for policy and rule mutations (via governance service patterns).

### A.7 Conflicts, duplication, risks

| Finding | Severity | Notes |
|---------|----------|------|
| **Two “discount” languages** | Medium | Enterprise list rules vs retail POS rules — must stay documented in UX and training. |
| **Dynamic `require()` of engine** | Low | `retailDiscount.service.ts` uses `require("./pricingEngine.service")` — works but obscures static graph; prefer typed import in a later refactor. |
| **Membership tier `stackWithPromo` / `stackWithBrandDiscount`** | Medium | Fields exist on `MembershipTier` / upsert; **list-layer engine does not yet branch on these flags** — document as future parity with `OrgPricingPolicy.allowMembershipStacking`. |
| **Cost layer in resolver** | Low | `blockSaleBelowCost` uses GRN/cost signals in validation paths — full “cost layer” reporting is not unified in one DTO. |
| **Doctor / service billing** | N/A | Overlaps pricing interfaces; not consolidated in pricing module — treat as **adjacent domain** with shared “resolution trace” pattern. |

### A.8 Unsafe UX patterns (to avoid)

- Raw variant IDs as primary selectors — **being phased out** on owner flows (e.g. enterprise discount create page uses SKU/name search + `variantId` hydration API).
- Inconsistent route naming — mitigated by `OWNER_PRICING_NAV` on the frontend.

---

## SECTION B — CANONICAL PRICING ARCHITECTURE (LAYERS)

### B.1 Cost layer

- **Purpose:** Truth for margin, stock valuation, and **floor vs cost** guards.
- **Inputs:** GRN / ledger costs, batch/lot cost if modeled, optional weighted average.
- **Outputs:** Reference unit cost, cost provenance for a line.
- **Control:** Finance / owner; branch visibility read-only or scoped.
- **Runtime:** Used in **governance validation** (`blockSaleBelowCost`), not as the customer “list price.”
- **Mutates list price?** No — **constrains** sell when policy enabled.

### B.2 Catalog / base list layer

- **Purpose:** Canonical **selling list** before promotional automation.
- **Sources (order in code):** `BranchPricing.overridePrice` → `ProductPricing` (base + markup, min/max, **MRP cap**) → `LocationPrice`.
- **Outputs:** `ResolvedPrice` with `source` + breakdown.
- **Control:** Owner (central), branch override where permitted.
- **Mutates:** Yes — this is the **base** for all downstream list layers.

### B.3 Governance layer (policy)

- **Purpose:** Org-wide switches: POS enforcement, floors, max discount hints, stacking, batch enablement.
- **Outputs:** Pass/fail / approval requirement for **POS line** discounts; **not** a separate price multiplier in the list engine.
- **Control:** Owner / HQ.
- **Mutates list?** No — **constrains** final sale and approval flow.

### B.4 Enterprise discount rule layer

- **Purpose:** Automate **list price** by SKU/category/brand/all-products, scoped org or branch.
- **Outputs:** Reduced list; `ResolutionTraceStep` ENTERPRISE_RULE.
- **Stacking:** Non-stackable rule **ends** enterprise chain early.
- **Control:** Owner pricing / retail rule manage permission.

### B.5 Campaign layer

- **Purpose:** Time-bound list adjustments with scopes (variant, brand, category, branch).
- **Stacking:** Controlled by `allowCampaignStacking` + per-campaign `stackable`.
- **Control:** Campaign managers.

### B.6 Membership layer

- **Purpose:** Tier % off **list after** campaigns (with exclusions and branch scopes).
- **Outputs:** MEMBERSHIP_TIER trace step; optional per-item cap.
- **Control:** Membership admins.
- **Note:** Tier stacking flags on the model should eventually align with `allowMembershipStacking` policy.

### B.7 Batch promo / batch adjustment layer

- **Purpose:** Lot-linked promo or recommended price; **floor** among qualifying on-hand lots at the branch shop.
- **Precedence:** Applied **after** enterprise list; can **lower** final list if below layered list and batch pricing enabled.
- **Control:** Central pricing + inventory-aware rules.

### B.8 POS finalization layer

- **Purpose:** Cashier unit price, quantity, membership card context, manual discount attempts.
- **Validates** against resolved list + retail rules + approvals.
- **Produces:** Receipt line + optional snapshot.

---

## SECTION C — SINGLE SOURCE OF TRUTH (RULES ENGINE)

### C.1 Canonical resolver contract (conceptual)

| Function | Responsibility |
|----------|------------------|
| `resolveSellingPrice` | Catalog list only (backward compatible). |
| `applyEnterpriseListPriceLayers` | Enterprise + campaign + membership on a known core list. |
| `resolveSellingPriceWithEnterprise` | **Primary** full list path including batch floor. |
| `resolvePosBranchVariantListPrice` | POS adapter — policy-aware, **no duplicate math**. |
| `assertPosSalePricingGovernance` | Final POS validation vs list + retail rules. |
| `buildRichResolutionTimeline` | Human-readable steps from engine outputs. |
| `writePriceResolutionSnapshotsForOrder` | Persist trace + sold unit for audit/analytics. |

**Hard requirement:** POS, preview, and order snapshots must call **`resolveSellingPrice` / `resolveSellingPriceWithEnterprise`** (or `resolvePosBranchVariantListPrice` which wraps them). **No parallel formula files.**

### C.2 Future consolidation (optional)

- Introduce a single exported type `PriceResolutionContext` (orgId, branchId, shopLocationId, variantId, lotId?, membershipTierId?, at).
- Optional facade `resolvePrice(context)` that delegates to existing functions — **only** when regression tests cover all flows.

---

## SECTION D — RESOLUTION ORDER (EXACT, CODE-ALIGNED)

Documented in `DOCUMENTED_RESOLUTION_ORDER` in `unifiedPriceResolution.service.ts`:

1. **Core catalog list** — branch override → product pricing (markup + MRP clamp) → location.
2. **Enterprise discount rules** — ACTIVE, priority asc; non-stackable stops chain.
3. **Campaigns** — scoped; stacking per policy + campaign.stackable.
4. **Membership tier** — exclusions + branch scopes + per-item cap.
5. **Batch promo floor** — `batchPricingEnabled` + shop location + on-hand lots; min qualifying promo.
6. **POS governance** — validates discounted sell vs **resolved list**; does not rewrite MRP.

**Per step:**
- **Stops chain:** Non-stackable enterprise rule; non-stackable campaign when stacking off; governance **throws** on bad line.
- **Logged:** `enterpriseTrace` JSON in snapshots; audit logs for policy/rule changes.
- **Preview UI:** Should mirror `buildRichResolutionTimeline` steps.

---

## SECTION E — TARGETING MODEL

| Target | Enterprise rules | Campaigns | Retail rules | Batch rules |
|--------|-------------------|-----------|--------------|---------------|
| All products | ✓ | via scopes | per variant | variant + lot |
| Category | ✓ | ✓ | via variant | — |
| Brand | ✓ | ✓ | via variant | — |
| Variant | ✓ | ✓ | ✓ | ✓ |
| Variant + batch (lot) | — | — | — | ✓ |
| Org-wide | ✓ default | ✓ | ✓ | ✓ |
| Branch | ✓ scope | ✓ scope | ✓ optional | optional branchId |
| Membership | tier id on resolve | — | — | — |
| Channel (POS / online) | **Future** — add `channel` to policy or rule scope | | | |

**Immediate:** variant, category, brand, branch, org, membership tier, lot.
**Later:** wholesale channel, partner price list, franchise regional matrix, explicit **online** channel.

---

## SECTION F — DATA MODEL / SCHEMA DIRECTION

Existing Prisma models (abbreviated responsibilities):

| Entity | Purpose |
|--------|---------|
| `ProductPricing` | Org catalog row per variant: base, markup, min/max, MRP, effective window |
| `BranchPricing` | Branch override overridePrice |
| `LocationPrice` | Location-specific list |
| `OrgPricingPolicy` | Governance toggles + stacking + batch + default max discount |
| `EnterpriseDiscountRule` | List automation rules |
| `PricingCampaign` / `PricingCampaignScope` | Campaigns |
| `MembershipTier` + exclusions + branch scopes | Membership list % |
| `BatchPricingRule` | Lot-level promo/recommended |
| `RetailDiscountRule` | POS discount caps |
| `RetailDiscountApprovalRequest` | POS approval workflow |
| `PriceResolutionSnapshot` | Order line audit |
| `PricingAuditLog` | Mutations |
| `PriceSchedule`, `PriceChangeApprovalRequest` | Scheduled / approval for base price changes |
| `BranchOverrideRequest`, `PricingEmergencyOverride` | Exception paths |

**Migration stance:**
- **Implement now (no migration):** Documentation, tests, UI contracts.
- **Later migration:** Channel dimension, explicit `PriceResolutionTrace` normalized table (if JSON snapshots insufficient).
- **Optional:** `MembershipTier.stackWith*` wired into engine when policy requires.

---

## SECTION G — BACKEND MODULE ARCHITECTURE (TARGET)

Logical modules (current code is mostly under `src/api/v1/modules/pricing/`):

| Module | Responsibility | Public API |
|--------|----------------|------------|
| **pricing-engine** (core) | `pricingEngine.service.ts` | `resolveSellingPrice`, `resolveSellingPriceWithEnterprise` |
| **enterprise-resolution** | `enterpriseResolution.service.ts` | `applyEnterpriseListPriceLayers`, `findBestBatchPromoPrice`, `traceToJson` |
| **pos-adapter** | `posListPriceResolution.service.ts` | `resolvePosBranchVariantListPrice` |
| **governance** | `pricingGovernance.service.ts`, `retailDiscount.service.ts` | Policy, POS assert, retail validate |
| **owner-admin** | `enterprisePricing.service.ts`, controllers | CRUD, simulate, analytics |
| **snapshots** | `priceResolutionSnapshot.service.ts` | Order persistence |
| **unified-docs** | `unifiedPriceResolution.service.ts` | Timeline, documented order |

**Forbidden coupling:** POS UI must not import Prisma or duplicate formulas — only call APIs that use the engine above.

---

## SECTION H — FRONTEND / UX ARCHITECTURE

| Page | Primary goal | Roles | Enterprise patterns |
|------|--------------|-------|------------------------|
| Pricing governance | Policy toggles, audit awareness | Owner | Clear flags, warnings |
| Price master | Catalog MRP/base/floor | Owner | Tables, bulk, schedules |
| Discount rules | Enterprise **list** rules | Owner | Full-page create, SKU search, badges |
| Campaigns | Time-bound promos | Owner | Status, windows, scopes |
| Membership | Tiers, exclusions | Owner | Scope + exclusions |
| Analytics | KPIs / snapshots | Owner | Read-only |
| Simulator | Match POS resolution | Owner / auditor | Timeline trace |

**UX rules:** Searchable selectors, human summaries, **no raw IDs as primary**, list vs edit/create page split for large forms.

---

## SECTION I — POS / CHECKOUT INTEGRATION

- **Barcode / browse:** `resolvePosBranchVariantListPrice` for displayed list when policy says enterprise resolution.
- **Cart / commit:** `assertPosSalePricingGovernance` if enabled — **no silent fallback**; throws `NO_LIST_PRICE` or validation codes.
- **Membership:** Tier id passed into engine where POS provides it (simulate path supports tier % or tier id).
- **Batch:** Engine picks best batch promo from on-hand lots; optional `lotId` narrow for support/simulation.
- **Failure modes:** No price → error; branch mismatch → validation; floor violation → block or approval; stale campaign → excluded by date window in queries.

---

## SECTION J — GOVERNANCE / SECURITY

- **RBAC:** `pricing.routes.ts` permission middleware per route.
- **Org isolation:** All queries scoped by `orgId` from org membership / owner.
- **Dual control:** Approval matrix + retail approvals + emergency overrides (time-bounded).
- **Audit:** `PricingAuditLog` + snapshots on paid orders.

---

## SECTION K — TRACEABILITY

- **Structured:** `ResolutionTraceStep[]` + `enterpriseDiagnostics`.
- **Persisted:** `PriceResolutionSnapshot.appliedRulesJson`, `decisionTrace`, `marginSnapshot`.
- **Human:** `buildRichResolutionTimeline` + governance line preview.

---

## SECTION L — IMPLEMENTATION ROADMAP

| Phase | Goals | Risk |
|-------|-------|------|
| **1 — Stabilize** | Document order, tests for engine vs POS, align policy flags | Low |
| **2 — Single resolver** | Enforce all entry points through engine; remove stray duplicates | Medium |
| **3 — UX** | Owner pages: selectors, traces, dedicated create/edit | Low–medium |
| **4 — Batch + governance** | Deeper batch/lot UX; cost floor reporting | Medium |
| **5 — Analytics** | Snapshot dashboards, optimization | Medium |

---

## SECTION M — TEST STRATEGY

- Unit: `applyDiscountMethod`, campaign stacking, enterprise rule order, batch floor selection.
- Integration: `/pricing/resolve`, POS checkout with governance on/off.
- Regression: **snapshot list price** = **simulate** for same inputs.
- Property: org A cannot resolve org B variant.

---

## SECTION N — IMMEDIATE SAFE IMPROVEMENTS (THIS PASS)

- [x] Add this **master architecture document** under `docs/pricing/`.
- [x] Cross-link from `CANONICAL_ENTERPRISE_PRICING_PLAN.md` to this file.
- [x] Add `@see` reference in `pricingEngine.service.ts` header to this doc (navigation only; **no behavior change**).

**Deferred (risky without tests):** Replacing `require()` with static imports in `retailDiscount.service.ts`; wiring `MembershipTier.stackWith*` to engine.

---

## SECTION O — SUMMARY

### Canonical architecture summary

- **One list-price engine** (`resolveSellingPriceWithEnterprise`) with **documented layer order**.
- **POS retail discount** is a **separate validation layer** against resolved list.
- **Batch** is a **lot-level floor** after list layers when enabled.
- **Traceability** is first-class via trace steps + snapshots.

### Risks deferred

- Membership stacking flags vs engine parity.
- Channel-specific pricing.
- Full cost-layer DTO in one resolver response.

### Recommended next commands

1. `node scripts/check-migration-integrity.js` before any schema work.
2. Add targeted Jest tests: `enterpriseResolution` stacking + `posListPriceResolution` mock policy.
3. Owner UI: align all pricing simulators to `/pricing/simulate` response shape with timeline component.

---

*Document generated from inspection of `backend-api` pricing modules and Prisma schema; frontend references via `bpa_web` owner inventory routes. Revise when major engine refactors land.*
