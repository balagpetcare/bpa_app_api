# Canonical enterprise pricing plan (reference)

**Master architecture (layers, resolver contract, POS integration, roadmap, tests):**
See **`BPA_ENTERPRISE_PRICING_ARCHITECTURE_PLAN.md`** in this folder — use it as the implementation-ready canonical narrative. This file remains a short phase checklist pointer.

The original plan file was specified at:

`/mnt/data/enterprise_pricing_governance_919cf4f7.plan.md`

That path is not bundled in this repository on Windows checkouts. Use this checklist (aligned with the recovery audit) as the working phase map:

1. **Governance foundation** — `OrgPricingPolicy`, audit, retail rule lifecycle, POS governance.
2. **Price master** — org SKU pricing, MRP, schedules, bulk, simulate.
3. **Enterprise discount rules** — scoped rules, priority/stacking, engine + POS.
4. **Membership** — tiers, exclusions, branch scopes, card tier link, engine.
5. **Campaigns** — CRUD, scopes, statuses, engine.
6. **Branch overrides** — matrix, requests, owner review, emergency tokens.
7. **Batch pricing** — lot-linked rules, cost signals, shop promo floor.
8. **Analytics + snapshots** — summary KPIs, per-order `PriceResolutionSnapshot`.

Implementation status vs this map is tracked in `ENTERPRISE_PRICING_IMPLEMENTATION_PROGRESS.md` and `ENTERPRISE_PRICING_RECOVERY_AUDIT.md`.
