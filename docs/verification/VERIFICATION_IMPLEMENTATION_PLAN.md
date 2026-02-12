# Verification & Onboarding Implementation Plan

**Goal:** Implement a complete, unified, policy-driven verification system per [10-platform-policy-requirements.md](./10-platform-policy-requirements.md).

---

## Touch Points Summary

| Area | Files | Change |
|------|-------|--------|
| Policy | `docs/verification/10-platform-policy-requirements.md` | **Created** — canonical policy |
| Middleware | `src/middlewares/ensureOwnerKyc.ts` | Apply to owner org/branch creation routes |
| Middleware | `src/middlewares/requireOwnerKycVerified.ts` | Fix prisma import; apply to all gated routes |
| Middleware | `src/middlewares/requireVerificationVerified.ts` | **New** — unified VerificationCase-based guard (optional) |
| Owner routes | `src/api/v1/modules/owner/owner.routes.ts` | Apply ensureOwnerKyc to onboarding, create org/branch |
| Owner routes | `src/api/v1/modules/owner/owner.routes.ts` | Apply requireOwnerKycVerified to: branch submit, staff invite, product publish, imports publish, wallet |
| Products | `src/api/v1/modules/products/products.controller.ts` | Already has inline KYC check; ensure consistent |
| Orders / POS | `src/api/v1/modules/orders/*`, `pos/*` | Add verification gate for branch access |
| Auth | `src/api/v1/services/authUnified.service.ts` | Producer redirect OK; Owner uses OwnerKyc — no change for now |
| Admin | `src/api/v1/modules/admin_verifications/*` | Add VerificationCase list/filter; align approve/reject |
| Frontend | `bpa_web/app/owner/*`, `producer/*` | Verification checklist, status, disable gated features |
| Docs | `docs/verification/00-canonical-system-requirements.md` | Update if behavior changed |

---

## Part 1 — Verification Canonicalization

- **Status:** Producer already uses VerificationCase (PRODUCER_ORG). Owner/Org/Branch have legacy tables + VerificationCase (owner.verification.controller).
- **Action:** Ensure at most one ACTIVE case per entity. Document uploads via VerificationDocument + Media. No code change for Part 1 (already compliant).

---

## Part 2 — Producer KYC Unification

- **Status:** Implemented. Producer uses VerificationCase + VerificationDocument + ProducerOrgDocument. docsJson deprecated.
- **Action:** Add deprecation comment to legacy submitKyc; ensure requestChangesProducerOrg syncs VerificationCase to REJECTED/DRAFT for resubmit.

---

## Part 3 — Owner/Org/Branch Enforcement

1. Apply **ensureOwnerKyc** to: `POST /owner/onboarding/start`, `POST /owner/organizations`, `POST /owner/organizations/:orgId/branches`.
2. Apply **requireOwnerKycVerified** to: `POST /owner/branches/:id/submit`, `POST /owner/branches/:id/members/invite`, product publish, import publish, wallet-related.
3. Fix **requireOwnerKycVerified** prisma import (uses `.default` which may be wrong).
4. Extend to orders/POS if branch-level verification is required.

---

## Part 4 — Frontend UX

- Owner: verification checklist on KYC page; disable gated features with tooltip.
- Producer: already has status; ensure APPROVED → dashboard redirect.
- Consistent status badges: UNSUBMITTED / PENDING / VERIFIED / REJECTED.

---

## Part 5 — Admin Review

- Add `GET /admin/verification-cases` — list VerificationCases, filter by entityType.
- Admin approve/reject already updates VerificationCase for Producer. Extend for Owner/Org/Branch if using VerificationCase.

---

## Part 6 — Validation

- Producer upload: already enforces MIME (images + PDF), max size.
- Owner/Verification upload: add MIME allowlist if missing.
- Never auto-approve. Never infer verification from partial data.

---

## Part 7 — Documentation

- Update 00-canonical-system-requirements.md with final behavior.
- GAP report for any deferred items.

---

## Risks & Gaps

1. **OwnerKyc vs VerificationCase (OWNER):** Auth redirect uses OwnerKyc. Full migration to VerificationCase as single source for Owner would require auth + admin flow changes. Deferred as GAP; ensure guards use OwnerKyc for now.
2. **Branch/Org verification:** Admin uses OrganizationLegalProfile, BranchProfileDetails. VerificationCase for ORG/BRANCH exists in owner.verification but admin does not list VerificationCases. Admin flow unchanged for now; document as GAP.
3. **POS/Orders:** May need branch-level verification gate; confirm with product.
