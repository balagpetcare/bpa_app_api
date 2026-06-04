# Enterprise pricing governance — final status

This document captures **production readiness**, **verification performed** in the stabilization pass, and **deploy/QA checklists**. It complements `ENTERPRISE_PRICING_IMPLEMENTATION_PROGRESS.md` and `ENTERPRISE_PRICING_RECOVERY_AUDIT.md`.

---

## 1. Current status by phase

| Phase | Scope | Status |
|-------|--------|--------|
| 1 | Org policy, governance APIs, audit hooks | **Shipped** — `pricingGovernance.*`, `OrgPricingPolicy` |
| 2 | Price Master (central catalog band) | **Shipped** — owner UI + `/pricing/org` search/bulk |
| 3 | Enterprise discount rules | **Shipped** — resolution in `enterpriseResolution.service.ts` |
| 4 | Membership tiers | **Shipped** — tier CRUD; **tier id resolution** applies exclusions + branch scopes in engine when `membershipTierId` is passed |
| 5 | Campaigns | **Shipped** — date window + scopes; stacking aligned with `allowCampaignStacking` |
| 6 | Branch override requests + approval | **Shipped** — API + staff request UI; **list/create hardened** (branch membership, scoped list for request-only role) |
| 7 | Batch-aware promos | **Shipped** when `batchPricingEnabled` + shop lot context (`findBestBatchPromoPrice`) |
| 8 | Analytics + `PriceResolutionSnapshot` | **Shipped** — snapshots on order completion (non-fatal if write fails); owner analytics summary |

---

## 2. Production readiness notes

- **Additive schema:** Enterprise pricing DDL is delivered via additive migrations (see recovery migration in repo history). Do not reset production DB; use `prisma migrate deploy` only.
- **POS governance:** When `posPricingGovernanceEnabled` is on, POS uses `resolveSellingPriceWithEnterprise` without `membershipTierId` (list price = rules + campaigns; membership % only when explicitly passed). **Tier-linked POS** can opt in later by passing `membershipTierId` from checkout context.
- **Permissions:** Owner sidebar **Pricing** group visibility includes `pricing.branch.override.approve` and `pricing.branch.override.request` (`OWNER_PRICING_SECTION_PERMISSIONS`). Child routes remain gated per item.
- **Branch override listing:** `GET /pricing/branch-override-requests` no longer accepts bare `org.read`; controller requires approve **or** audit **or** request, with **request-only** users forced to `branchId` + active `BranchMember` for that org branch.

---

## 3. Known limitations

- **Owner UI for branch override queue:** Full org-wide review remains API-first; staff submit from branch; owners with approve permission should use API or future dedicated owner screen.
- **POS snapshots:** `writePriceResolutionSnapshotsForOrder` does not yet attach `membershipTierId` from the order/customer card; traces reflect list layers without tier unless callers pass tier into resolve (future enhancement).
- **Membership UI:** Owner membership page is tier-focused; exclusions/scopes are primarily API-driven (`setMembershipTierExclusions`, `setMembershipTierBranchScopes`).
- **Campaign + membership stacking beyond list price:** Policy flags exist; POS retail discount validation is separate (`retailDiscount.service.ts`).

---

## 4. Verification performed (stabilization pass)

- **Navigation / IA:** Owner pricing routes aligned with `OWNER_PRICING_NAV`; page titles normalized (Pricing Governance, Price Master, Discount Rules, Membership Pricing, Campaigns, Pricing Analytics). Governance supports `?tab=policy|audit|rules|approvals` on load.
- **Permissions:** Sidebar section keys extended for branch override perms; route middleware for list overrides aligned (removed `org.read` shortcut).
- **API guards:** `createOverrideRequest` verifies active branch membership and org match. `listOverrideRequests` scopes request-only users to their branch.
- **Engine:** Campaign loop simplified: if `allowCampaignStacking` is false, stop after first campaign; if true, continue only while campaigns are stackable; non-stackable campaign ends chain. Membership tier by id applies **exclusions** and **branch scopes** before discount percent.
- **Resolve API:** `GET /pricing/resolve?enterprise=1` accepts optional `membershipTierId` for layered simulation at list price.

---

## 5. Deployment checklist

1. **Migration integrity:** `node scripts/check-migration-integrity.js` (and `node scripts/check-migration-files.js` if used in your pipeline).
2. **Apply migrations:** `npx prisma migrate deploy` (against the target environment).
3. **Permission seed/sync:** Run your org role/permission seed or admin sync so pricing keys exist (`pricing.*` as registered in `permissionsRegistry.service.ts`).
4. **API smoke:** `GET /api/v1/pricing/governance/policy?orgId=…`, `GET /api/v1/pricing/resolve?…&enterprise=1`, `POST /api/v1/pricing/simulate` (auth), `GET /api/v1/pricing/branch-override-requests?orgId=…&branchId=…` as requester.
5. **Owner UI smoke:** Open each pricing page under `/owner/inventory/*` with a user that has the matching permission subset.
6. **POS repricing:** Complete a sale with governance on; confirm no `NO_LIST_PRICE` / approval errors for in-catalog lines.
7. **Analytics:** Owner **Pricing Analytics** with `pricing.analytics.view`; optional `GET /pricing/orders/:orderId/snapshots`.

---

## 6. Post-deploy QA checklist

- [ ] Org policy toggles persist and reflect on next POS checkout.
- [ ] Price Master search and row save (floor/MRP) still succeed.
- [ ] Active enterprise rule reduces resolved list for a known variant (trace non-empty).
- [ ] Active campaign in window applies; turning `allowCampaignStacking` off limits to one campaign layer.
- [ ] Membership tier with exclusion: resolved price **unchanged** by tier when `membershipTierId` + excluded variant.
- [ ] Branch override: staff request → list filtered by branch; approver review PATCH succeeds.
- [ ] Paid order creates snapshot rows when table exists (check DB or analytics API).

---

## Short deploy checklist (copy/paste)

```
node scripts/check-migration-integrity.js
npx prisma migrate deploy
# permission seed / role sync (project-specific)
# pricing route smoke tests (API)
# owner UI smoke (governance, price master, rules, membership, campaigns, analytics)
# POS repricing smoke (governance on)
# analytics visibility (pricing.analytics.view)
```

---

*Last updated: stabilization pass (engine + permissions + owner IA + documentation).*
