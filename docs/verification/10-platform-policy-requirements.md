# Platform Verification & Onboarding Policy (FINAL)

This document is the **canonical policy** for verification and onboarding. All implementation MUST align with it. If code conflicts with this policy, the system must move TOWARDS the policy.

---

## 1. Core Principle

**No business can access public, financial, or staff features unless VERIFIED.**

- Owner, Organization, Branch, and ProducerOrg follow **ONE** verification logic.
- Verification is trust-driven, fake-resistant, and policy-consistent.

---

## 2. Verification Mechanism (Single Source)

| Entity | VerificationCase entityType | Document Model | Legacy (Deprecated) |
|--------|-----------------------------|----------------|---------------------|
| Owner | OWNER | OwnerKycDocument + VerificationDocument | — |
| Organization | ORGANIZATION | OrganizationDocument + VerificationDocument | — |
| Branch | BRANCH | BranchDocument + VerificationDocument | — |
| ProducerOrg | PRODUCER_ORG | VerificationDocument + ProducerOrgDocument | docsJson on ProducerOrg |

### 2.1 Workflow (All Entities)

- **DRAFT** → upload docs, edit → **SUBMITTED** → admin review → **APPROVED** \| **REJECTED**
- Each verifiable entity has **at most one ACTIVE** VerificationCase (DRAFT, SUBMITTED).
- REJECTED allows resubmission via new DRAFT case.

### 2.2 Document Uploads

- All document uploads go through:
  - **VerificationDocument** (linked to VerificationCase)
  - **Media** (S3/MinIO)
- Max size: `MAX_UPLOAD_BYTES` (env, default 15MB).
- Allowed types: **images (jpeg, png, webp) + PDF only**. Reject others with 400.
- Never auto-approve verification.
- Never infer verification from partial data.

---

## 3. Producer KYC Rules (Policy)

### 3.1 Required Documents

- **Identity proof**: at least one of NID_FRONT or SELFIE_WITH_NID.
- **Factory/office proof**: at least one of TRADE_LICENSE, INCORPORATION_CERT, OTHER.
- Optional: NID_BACK, business registration.

### 3.2 Submit Rules

- At least one business doc + one identity doc.
- At least one document total.
- ProducerOrg.docsJson is **deprecated**; use VerificationCase + VerificationDocument.

### 3.3 Login Redirect Rules

| Producer VerificationCase Status | Redirect |
|----------------------------------|----------|
| No case / DRAFT / SUBMITTED / REJECTED | `/producer/kyc` |
| APPROVED | `/producer` or `/producer/dashboard` |

---

## 4. Owner / Organization / Branch Gating

### 4.1 Features Gated by VERIFIED Status

UNSUBMITTED / SUBMITTED users **CANNOT**:

- Publish branches.
- Sell on marketplace.
- Access wallet / payout.
- Invite staff.
- Use POS / orders.

### 4.2 Middleware / Guards

- Apply verification guards **before** high-impact actions.
- Return clear **403** with policy-based reasons (e.g. `VERIFICATION_REQUIRED`, `VERIFICATION_PENDING`).
- Do NOT leave dead security code (e.g. unused ensureOwnerKyc).

### 4.3 Owner Login Redirect

| Owner KYC Status | Redirect |
|------------------|----------|
| UNSUBMITTED / REJECTED | `/owner/kyc` |
| SUBMITTED / VERIFIED | `/owner/dashboard` |

---

## 5. Admin Review Flow

### 5.1 Admin Must Be Able To

- See all VerificationCases.
- Filter by entityType (OWNER, ORGANIZATION, BRANCH, PRODUCER_ORG).
- Review documents.
- Approve / Reject with reason.

### 5.2 Approval Effects

- Unlock gated features.
- Sync entity status (e.g. ProducerOrg.status = VERIFIED, OwnerKyc.verificationStatus = VERIFIED).

### 5.3 Rejection Effects

- Preserve audit history.
- Allow resubmission via new VerificationCase or reset to DRAFT.

---

## 6. Security Rules

1. **Never auto-approve** verification.
2. **Never unlock** gated features without VERIFIED status.
3. **Never infer** verification from partial data (e.g. docsJson only).
4. **Enforce upload rules**: max size from env, allowed types images + PDF only.
5. Reject disallowed MIME types with **400**.

---

## 7. UX Consistency

- All panels (Owner, Producer, Clinic, Shop) must behave consistently.
- Show verification checklist from policy.
- Show clear status: UNSUBMITTED / PENDING / VERIFIED / REJECTED.
- Disable gated features with clear reasons.
- No blind redirect to /mother or dashboards without verification check.

---

## 8. References

- [00-canonical-system-requirements.md](./00-canonical-system-requirements.md) — Current system behavior.
- [business/producer.md](./business/producer.md) — Producer KYC checklist.
- [business-requirements.md](./business-requirements.md) — Full audit and gaps.
