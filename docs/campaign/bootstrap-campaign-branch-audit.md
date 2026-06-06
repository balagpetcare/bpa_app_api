# Campaign Payment Branch Bootstrap — Audit

**Date:** 2026-06-07  
**Error:** `Campaign payment setup not configured: no ACTIVE branch found for campaign orders`

---

## Phase 1 — Existing branch system

### Branch CRUD — already exists

| API | Path | Purpose |
|-----|------|---------|
| List | `GET /api/v1/admin/branches` | Filter by status, orgId, search |
| Create | `POST /api/v1/admin/branches` | Create branch under organization |
| Read | `GET /api/v1/admin/branches/:id` | Branch detail |
| Update | `PATCH /api/v1/admin/branches/:id` | Status, name, verification |

**Controller:** `src/api/v1/modules/admin_branches/admin_branches.controller.ts`

### Admin panel

Branches can be created via BPA Admin (`bpa_web` admin panel) using existing admin branch APIs. No new public APIs required.

### Existing seed utilities

| Script | npm command | Purpose |
|--------|-------------|---------|
| `scripts/bootstrap-campaign-branch.ts` | `npm run bootstrap:campaign-branch` | **Canonical** idempotent campaign checkout anchor |
| `scripts/seed-campaign-checkout-anchor.ts` | `npm run seed:campaign-checkout-anchor` | Backward-compat wrapper (delegates to bootstrap) |
| `scripts/verify-campaign-checkout-anchor.ts` | `npm run verify:campaign-checkout-anchor` | End-to-end branch gate + checkout session test |

### Why production fails

`resolveCampaignPaymentBranch()` in `payment.service.ts` requires an **ACTIVE** `branches` row:

1. `CAMPAIGN_PAYMENT_BRANCH_ID` env (if set and valid ACTIVE branch)
2. ACTIVE branch under `campaign.organizerId`
3. Any ACTIVE branch globally

Production typically has **zero ACTIVE branches** and **null `campaign.organizerId`** until bootstrap runs. This is a **data/configuration gap**, not missing application code.

---

## Phase 2 — Bootstrap solution

**Script:** `scripts/bootstrap-campaign-branch.ts`

| Requirement | Implementation |
|-------------|----------------|
| Idempotent | Finds org by name; branch by `orgId + code` |
| No duplicates | Unique lookup before create |
| Reuse org | Updates existing BPA org to APPROVED |
| Existing branch | Reactivates to ACTIVE if inactive; skips create |

### Production run

```bash
cd backend-api
npm run bootstrap:campaign-branch
```

Copy printed value:

```env
CAMPAIGN_PAYMENT_BRANCH_ID=<branch_id>
```

Restart API after setting env (optional but recommended for explicit pinning).

---

## Phase 3 — Branch resolution

`resolveCampaignPaymentBranch()` logic (unchanged):

```typescript
// 1. Env override
CAMPAIGN_PAYMENT_BRANCH_ID → ACTIVE branch by id

// 2. Organizer branch
campaign.organizerId → first ACTIVE branch for org

// 3. Global fallback
any ACTIVE branch (orderBy id asc)
```

Bootstrap ensures steps 2 and 3 succeed; env override pins step 1.

---

## Phase 4 — Environment

| Variable | Required | Notes |
|----------|----------|-------|
| `CAMPAIGN_PAYMENT_BRANCH_ID` | Recommended | Explicit pin after bootstrap |
| `CAMPAIGN_ORGANIZER_ORG_NAME` | Optional | Default: `Bangladesh Pet Association` |
| `CAMPAIGN_CHECKOUT_BRANCH_CODE` | Optional | Default: `BPA-CAMPAIGN-CHECKOUT` |

---

## Phase 5 — Validation commands

```bash
npm run bootstrap:campaign-branch
npm run verify:campaign-checkout-anchor
```

**Pass criteria:**

- `resolveCampaignPaymentBranch(): OK`
- `noBranchValidationError: true`
- Gateway errors (EPS/SSLCommerz) are **separate** from branch gate

---

## Related docs

- `docs/debug/campaign-checkout-payment-setup-report.md`
- `docs/campaign-v2/campaign-checkout-anchor-report.md`
- `docs/payment/eps-gateway-setup.md`
