# Canonical Verification System Requirements

This document is the single source of truth for verification/KYC flows. See also [business-requirements.md](./business-requirements.md) for full audit. Policy: [10-platform-policy-requirements.md](./10-platform-policy-requirements.md).

---

## Entity types and document models

| Entity | Verification case | Document model | Legacy / deprecated |
|--------|-------------------|----------------|---------------------|
| **Owner** | VerificationCase (OWNER) | OwnerKycDocument + VerificationDocument | — |
| **Organization** | VerificationCase (ORGANIZATION) | OrganizationDocument + VerificationDocument | — |
| **Branch** | VerificationCase (BRANCH) | BranchDocument + VerificationDocument | — |
| **ProducerOrg** | VerificationCase (PRODUCER_ORG) | VerificationDocument + ProducerOrgDocument | **docsJson** on ProducerOrg is deprecated; use upload + VerificationCase. |

---

## ProducerOrg KYC (canonical)

- **VerificationCase** with `entityType = PRODUCER_ORG`, `entityId = producerOrgId`.
- **Documents**: Upload via `POST /api/v1/producer/kyc/documents` → creates **VerificationDocument** (case) and **ProducerOrgDocument** (reporting).
- **Submit**: `POST /api/v1/producer/kyc/submit` (no body for new flow) → sets case status SUBMITTED.
- **Auth redirect**: Producer owner context status is derived from latest VerificationCase (DRAFT/SUBMITTED/REJECTED → PENDING → `/producer/kyc`; APPROVED → `/producer`).
- **Admin**: Approve/reject ProducerOrg updates both VerificationCase and ProducerOrg.status.
- **Legacy**: `ProducerOrg.docsJson` and `ProducerOrg.legacyDocsJson` are deprecated; do not rely on file refs. Legacy `POST /kyc/submit` with body `{ name, countryCode, docsJson }` still works but is deprecated.

---

## References

- [business-requirements.md](./business-requirements.md) — Full audit, mandatory fields, gaps.
- [business/producer.md](./business/producer.md) — Producer KYC checklist and DocumentType mapping.
- [PRODUCER_KYC_IMPLEMENTATION_PLAN.md](./PRODUCER_KYC_IMPLEMENTATION_PLAN.md) — Implementation plan and touched files.
