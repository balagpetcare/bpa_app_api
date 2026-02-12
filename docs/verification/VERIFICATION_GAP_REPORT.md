# Verification Implementation — GAP Report

**Date:** 2025-02-10  
**Policy reference:** [10-platform-policy-requirements.md](./10-platform-policy-requirements.md)

---

## Implemented

1. **Policy document** — `10-platform-policy-requirements.md` created as canonical policy.
2. **ensureOwnerKyc** — Applied to: `POST /owner/onboarding/start`, `POST /owner/organizations`, `POST /owner/organizations/:orgId/branches`. Requires at least SUBMITTED KYC with one document before creating org/branch.
3. **requireOwnerKycVerified** — Applied to: branch submit, branch member invite, product import publish, product publish, wallet withdraw. Fixed prisma import.
4. **Producer requestChanges** — Admin `requestChangesProducerOrg` now syncs VerificationCase to REJECTED so producer can create new DRAFT and resubmit.
5. **Admin VerificationCase sync** — `admin_verification_cases.decideCase` now syncs entity status on APPROVAL (ProducerOrg, OwnerKyc, OrganizationLegalProfile, BranchProfileDetails).
6. **Owner verification upload** — MIME allowlist (images + PDF) and max size validation added.
7. **Producer staff invite** — `requireProducerVerified` middleware blocks staff invite until ProducerOrg is VERIFIED.

---

## Gaps (Deferred)

1. **Owner auth redirect source** — Auth redirect uses `OwnerKyc.verificationStatus`, not VerificationCase (OWNER). Full migration to VerificationCase as single source for Owner would require auth + admin flow changes.
2. **Admin VerificationCase UI** — Admin has `GET /admin/verification-cases` with filter by entityType; legacy admin_verifications (OwnerKyc, Org, Branch, Producer) uses separate list endpoints. Consider consolidating admin UX.
3. **Organization/Branch entityId mapping** — VerificationCase for ORGANIZATION uses `entityId = orgId`; for BRANCH uses `entityId = branchId`. Owner verification-case API uses OrganizationLegalProfile / BranchProfileDetails in some flows. Ensure consistent mapping.
4. **Producer wallet/payout** — Wallet withdraw has requireOwnerKycVerified (OwnerKyc); Producer withdraw is not separately gated by ProducerOrg.status. Add if producers can withdraw.
5. **POS/Orders branch-level gate** — Policy says "use POS/orders" is gated. Orders/POS may need verification check at branch level; confirm with product.
6. ~~**Owner KYC upload MIME**~~ — FIXED: Owner KYC document upload now enforces MIME allowlist (images + PDF) and max size.

---

## Test Examples

### Producer KYC
```bash
# Status
curl -s -H "Cookie: access_token=TOKEN" "http://localhost:3000/api/v1/producer/kyc/status"

# Submit
curl -s -X POST -H "Cookie: access_token=TOKEN" -H "Content-Type: application/json" -d "{}" "http://localhost:3000/api/v1/producer/kyc/submit"

# Upload
curl -s -X POST -H "Cookie: access_token=TOKEN" -F "file=@doc.pdf" -F "docType=TRADE_LICENSE" "http://localhost:3000/api/v1/producer/kyc/documents"
```

### Owner verification gates (403 when not VERIFIED)
```bash
# Branch submit — expect 403 KYC_VERIFIED_REQUIRED if not verified
curl -s -X POST -H "Cookie: access_token=TOKEN" "http://localhost:3000/api/v1/owner/branches/1/submit"

# Staff invite — expect 403
curl -s -X POST -H "Cookie: access_token=TOKEN" -H "Content-Type: application/json" -d '{}' "http://localhost:3000/api/v1/owner/branches/1/members/invite"
```

### Admin VerificationCase
```bash
# List (filter by entityType)
curl -s -H "Cookie: access_token=ADMIN_TOKEN" "http://localhost:3000/api/v1/admin/verification-cases?entityType=PRODUCER_ORG"

# Approve case
curl -s -X POST -H "Cookie: access_token=ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"status":"APPROVED","reviewSummary":"Approved"}' "http://localhost:3000/api/v1/admin/verification-cases/1/decision"
```
