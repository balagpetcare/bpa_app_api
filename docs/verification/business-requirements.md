# Business Verification & Onboarding Requirements (Canonical Spec)

This document is derived from a codebase scan. It lists business types, mandatory fields, verification gating, document uploads, and gaps.

**Scope:** Onboarding, register/login redirect, mother workspace, owner/clinic/producer/partner modules, Prisma models (org/workspace/branch/owner/producer/clinic/staff/verification/documents/uploads), API validators/middlewares, and permission/role checks that return 403 or AccessDenied.

---

## 1. Panels & Routes (Onboarding, Register/Login Redirect, Mother, Owner/Clinic/Producer)

### 1.1 Frontend panels (bpa_web)

| Panel | Base path | Port | Key routes | Notes |
|-------|-----------|------|------------|--------|
| **Mother** | `/mother` | 3100 | `/mother`, `/mother/login`, `/mother/register` | Default customer fallback in auth redirect. |
| **Shop** | `/shop` | 3101 | `/shop`, `/shop/login`, `/shop/register`, `/shop/pos`, `/shop/orders`, `/shop/products`, `/shop/inventory`, `/shop/staff`, `/shop/customers` | Branch/shop staff. |
| **Clinic** | `/clinic` | 3102 | `/clinic`, `/clinic/login`, `/clinic/register`, `/clinic/appointments`, `/clinic/patients`, `/clinic/services`, `/clinic/staff` | Branch/clinic staff. |
| **Admin** | `/admin` | 3103 | `/admin/onboarding`, `/admin/onboarding/publish-requests`, `/admin/onboarding/partner-applications` | Super-admin whitelist; onboarding = partner apps + publish requests. |
| **Owner** | `/owner` | 3104 | `/owner/login`, `/owner/register`, `/owner/onboarding`, `/owner/kyc`, `/owner/dashboard`, `/owner/organizations`, `/owner/workspace`, `/owner/team` | Owner profile + KYC + org/branch; onboarding redirect when no org/branch/context. |
| **Producer** | `/producer` | — | `/producer/login`, `/producer/register`, `/producer/kyc`, `/producer/dashboard`, `/producer/products`, `/producer/batches`, `/producer/staff` | Separate auth; KYC for ProducerOrg. |
| **Partner** | `/partner` | — | `/partner/apply`, `/partner/login`, `/partner/dashboard` | Partner application wizard (legacy-style flow). |
| **Staff** | `/staff` | — | `/staff`, `/staff/branch/[branchId]`, `/staff/login`, `/staff/register`, `/staff/workspace` | Branch staff; access request when PENDING. |
| **Country** | `/country` | — | `/country/dashboard`, `/country/login`, `/country/register`, etc. | Country-scoped admin. |

**References:**
- [bpa_web/app/owner/layout.jsx](../../../bpa_web/app/owner/layout.jsx) — onboarding redirect (`needsOnboarding` → `/owner/onboarding`), KYC redirect (OWNER context + UNSUBMITTED/REJECTED → `/owner/kyc`), auth routes.
- [bpa_web/src/lib/permissionMenu.ts](../../../bpa_web/src/lib/permissionMenu.ts) — admin onboarding menu: `admin.onboarding`, `admin.onboardingPublish`, `admin.onboardingPartner`.
- [backend-api/docs/PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md) — fixed ports.

### 1.2 Login redirect (backend canonical)

Redirect is decided in `authUnified.service.decideRedirect()` and returned in login/me as `default_redirect` / `recommendedPath`:

| Context | KYC/Status | Redirect |
|---------|------------|----------|
| Admin | — | `/admin` |
| Owner | UNSUBMITTED or REJECTED | `/owner/kyc` |
| Owner | SUBMITTED / VERIFIED | `/owner/dashboard` |
| Team | — | `/owner/workspace` |
| Producer | PENDING | `/producer/kyc` |
| Producer | VERIFIED | `/producer` |
| Staff (branch APPROVED) | — | `/staff/branch/{branchId}` |
| Staff (branch PENDING) | — | `/staff` (access-request) |
| Country admin | — | `/country/dashboard` |
| Customer | — | `/mother` |

**Reference:** [src/api/v1/services/authUnified.service.ts](../../src/api/v1/services/authUnified.service.ts) — `decideRedirect`, `getOwnerKycStatus`.

### 1.3 Register endpoints

| Endpoint | Module | Creates | Required body (API) |
|----------|--------|--------|----------------------|
| `POST /api/v1/auth/register` | auth.controller | User, UserAuth, UserProfile, UserWallet; if `isOwner`: OwnerProfile, optionally OwnerKyc (if `address`) | email or phone, password (min 4); optional name, address, **isOwner** |
| `POST /api/v1/producer/auth/register` | producer.controller → producer.service | User, UserAuth, UserProfile, UserWallet, **ProducerOrg** (status PENDING), ProducerOrgStaff (PRODUCER_OWNER) | email or phone, password (min 4); optional name |

**References:**
- [src/api/v1/modules/auth/auth.controller.ts](../../src/api/v1/modules/auth/auth.controller.ts) — `register` (lines ~123–237).
- [src/api/v1/modules/producer/producer.controller.ts](../../src/api/v1/modules/producer/producer.controller.ts), [producer.service.ts](../../src/api/v1/modules/producer/producer.service.ts) — `registerProducer`.

### 1.4 Onboarding endpoints (Owner)

| Endpoint | Purpose |
|----------|--------|
| `GET /api/v1/owner/onboarding/status` | Returns `needsOnboarding`, `hasOrg`, `hasBranch`, `contextCount`, `step`. Needs onboarding when no OwnerProfile, no org, no branch, no context. |
| `POST /api/v1/owner/onboarding/start` | Body: `organizationName?`, `branchName?`. Creates Organization (PENDING_REVIEW), Branch (DRAFT), UserContext (OWNER, default). Fails if user already has an org. |

**Reference:** [src/api/v1/modules/owner/onboarding.controller.js](../../src/api/v1/modules/owner/onboarding.controller.js).

---

## 2. Business Types & Panel Mapping

| Business type | Panel(s) | Prisma / API entity | Notes |
|---------------|----------|---------------------|--------|
| **Owner (partner)** | Owner (3104), Partner | User + OwnerProfile (+ OwnerKyc), Organization, Branch | Owner panel is main; Partner is legacy wizard. |
| **Organization** | Owner, Admin | Organization, OrganizationLegalProfile | Owner creates; Admin approves (partner onboarding). |
| **Branch** | Owner, Shop, Clinic, Staff, Admin | Branch, BranchProfileDetails, BranchPublishRequest | Types: CLINIC, PET_SHOP, DELIVERY_HUB, etc. |
| **Producer** | Producer | ProducerOrg, ProducerOrgStaff | Separate auth; status PENDING → VERIFIED by admin. |
| **Partner application (legacy)** | Partner, Admin | PartnerApplication | businessName, nidNumber required; Admin approve/reject. |
| **Staff / branch member** | Staff, Owner | BranchMember, BranchAccessPermission | Invite → PENDING → APPROVED. |
| **Country admin** | Country | UserCountryRole, etc. | Country-scoped. |
| **Super admin** | Admin | SuperAdminWhitelist | Whitelist by email/phone. |

---

## 3. Mandatory Fields (DB/API) by Business Type

### 3.1 Owner (User + OwnerProfile + OwnerKyc)

| Layer | Required fields | Source |
|-------|------------------|--------|
| **OwnerProfile** | `name` | Schema: `name String`; all other fields optional. |
| **OwnerKyc** | `fullName` | Schema; API draft allows partial. Submit: backend sets SUBMITTED; at least one document required by **ensureOwnerKyc** (see §4). |
| **Register (isOwner)** | email or phone, password (min 4); profile: displayName (default "New User"), username (generated) | auth.controller register. |

**Reference:** [prisma/schema.prisma](../../prisma/schema.prisma) — `OwnerProfile` (lines ~570–604), `OwnerKyc` (~610–664).

### 3.2 Organization

| Layer | Required fields | Source |
|-------|------------------|--------|
| **Organization** | `name`, `ownerUserId`; status default PENDING_REVIEW | owner.controller createOrganization: `name` required. |
| **OrganizationLegalProfile** | `organizationName`, `registrationType` (default PROPRIETORSHIP) | owner.controller: “required field organizationName”; schema. |
| **Partner application** | `businessName`, `nidNumber` | partner_onboarding.controller submitApplication / submitDraft. |

**Reference:** [prisma/schema.prisma](../../prisma/schema.prisma) — Organization (~2448+), OrganizationLegalProfile (~691+). [partner_onboarding.controller.ts](../../src/api/v1/modules/partner_onboarding/partner_onboarding.controller.ts) — submitDraft (lines ~155–159), submitApplication (~179–184).

### 3.3 Branch

| Layer | Required fields | Source |
|-------|------------------|--------|
| **Branch** | `orgId`, `name`; status default DRAFT | owner.controller createBranch: `name` required. |
| **BranchProfileDetails** | Optional fields; verificationStatus default UNSUBMITTED | Schema. |

**Reference:** [prisma/schema.prisma](../../prisma/schema.prisma) — Branch (~2523+), BranchProfileDetails (~796+).

### 3.4 Producer

| Layer | Required fields | Source |
|-------|------------------|--------|
| **ProducerOrg** | `ownerUserId`, `name`; status PENDING | producer.service registerProducer. |
| **Producer register** | email or phone, password (min 4); name optional (default "Producer User") | producer.service registerProducer. |

**Reference:** [prisma/schema.prisma](../../prisma/schema.prisma) — ProducerOrg (~4472+). [producer.service.ts](../../src/api/v1/modules/producer/producer.service.ts) — registerProducer.

### 3.5 Producer (ProducerOrg + VerificationCase)

| Layer | Required fields | Source |
|-------|------------------|--------|
| **ProducerOrg** | `ownerUserId`, `name`; status PENDING | producer.service registerProducer. |
| **VerificationCase (PRODUCER_ORG)** | entityType, entityId; status DRAFT → SUBMITTED | producerKyc.service: getOrCreateProducerVerificationCase, submitProducerKyc. |
| **Submit (new flow)** | At least one business doc (TRADE_LICENSE / INCORPORATION_CERT / OTHER) and one identity doc (NID_FRONT / SELFIE_WITH_NID); min one document | producerKyc.service validation; see [docs/verification/business/producer.md](business/producer.md). |

**Reference:** [docs/verification/00-canonical-system-requirements.md](00-canonical-system-requirements.md), [docs/verification/business/producer.md](business/producer.md).

### 3.6 Partner application (PartnerApplication)

| Layer | Required fields | Source |
|-------|------------------|--------|
| **Submit** | `businessName`, `nidNumber` | API validation on submit; schema has optional `tradeLicenseNo`, `docsJson`. |

**Reference:** [prisma/schema.prisma](../../prisma/schema.prisma) — PartnerApplication (~2425+).

---

## 4. Verification Status Gating (APPROVED vs PENDING)

### 4.1 Owner KYC

- **ensureOwnerKyc** (middleware): Requires OwnerKyc row; `verificationStatus` in **SUBMITTED** or **VERIFIED**; not locked/deleted; **at least one KYC document**. Used for: **none** in current owner routes (middleware exists but is not applied to any route in owner.routes.ts). So today owner panel does not API-gate org/branch creation on KYC.
- **requireOwnerKycVerified** (middleware): Requires OwnerKyc **VERIFIED** and not locked. Used for:
  - **Partner flow:** `POST /api/v1/partner/branches/:branchId/publish` — branch publish requires KYC verified.

**Snippet (ensureOwnerKyc):**

```ts
// status === "SUBMITTED" || status === "VERIFIED"; hasDoc = documents.length > 0
if (!ok) return 403 KYC_NOT_SUBMITTED;
if (!hasDoc) return 403 KYC_DOCUMENT_REQUIRED;
```

**References:**
- [src/middlewares/ensureOwnerKyc.ts](../../src/middlewares/ensureOwnerKyc.ts)
- [src/middlewares/requireOwnerKycVerified.ts](../../src/middlewares/requireOwnerKycVerified.ts)
- [src/api/v1/modules/partner_onboarding/partner_onboarding.routes.ts](../../src/api/v1/modules/partner_onboarding/partner_onboarding.routes.ts) — branch publish uses `requireOwnerKycVerified`.

### 4.2 Organization / Branch (legacy legal profile)

- **Organization:** status PENDING_REVIEW / APPROVED; OrganizationLegalProfile.verificationStatus: UNSUBMITTED | SUBMITTED | VERIFIED | REJECTED. When org status is PENDING_REVIEW or APPROVED, direct PATCH can be soft-locked (changes saved as VerificationCase draft) or hard-locked (409 VERIFICATION_LOCKED) per `VERIFICATION_HARD_LOCK` env.
- **Branch:** Same pattern: BranchProfileDetails.verificationStatus SUBMITTED/VERIFIED triggers draft or 409.
- **Branch publish:** Request goes to BranchPublishRequest; admin approve/reject. Partner route for publish uses **requireOwnerKycVerified**.

**Reference:** [src/api/v1/modules/owner/owner.controller.ts](../../src/api/v1/modules/owner/owner.controller.ts) — `isVerificationHardLockEnabled`, `saveVerificationDraftFromLegacy`, `buildVerificationSignal`; updateOrganization (~946+), updateBranch (~1441+); submitBranch (~1687+).

### 4.3 Universal verification (VerificationCase)

- **Entity types:** OWNER, ORGANIZATION, BRANCH, PRODUCER_ORG (schema enum).
- **Case status:** DRAFT → SUBMITTED → APPROVED | REJECTED. When case is SUBMITTED, draft edits and document uploads are blocked (soft message returned).
- **Redirect logic:** Owner with KYC UNSUBMITTED/REJECTED → `/owner/kyc`; Producer PENDING → `/producer/kyc`.

**Reference:** [src/api/v1/services/authUnified.service.ts](../../src/api/v1/services/authUnified.service.ts) — decideRedirect; [src/api/v1/modules/owner/owner.verification.controller.ts](../../src/api/v1/modules/owner/owner.verification.controller.ts).

### 4.4 Producer org

- **ProducerOrg.status:** PENDING → VERIFIED (admin approve) or REJECTED/BLOCKED. Producer login redirect: PENDING → `/producer/kyc`, else `/producer`.

**Reference:** [src/api/v1/services/authUnified.service.ts](../../src/api/v1/services/authUnified.service.ts) — resolveAuthContexts, decideRedirect.

### 4.5 Partner application

- **PartnerApplication.status:** NOT_APPLIED (draft) → PENDING_REVIEW → APPROVED | REJECTED. **requireApprovedPartner** in partner_onboarding.controller: createOrganization/createBranch (partner flow) require an APPROVED partner application.

**Reference:** [src/api/v1/modules/partner_onboarding/partner_onboarding.controller.ts](../../src/api/v1/modules/partner_onboarding/partner_onboarding.controller.ts) — requireApprovedPartner, createOrganization, createBranch.

---

## 5. Document Upload Models, Required Doc Types, Formats, Storage

### 5.1 Document models (Prisma)

| Model | Parent | Key fields | Storage |
|-------|--------|------------|--------|
| **OwnerKycDocument** | OwnerKyc | type (DocumentType), status (DocumentStatus), mediaId → Media | Media (S3/MinIO) |
| **OrganizationDocument** | OrganizationLegalProfile | type, status, mediaId → Media | Media |
| **BranchDocument** | BranchProfileDetails | type, status, mediaId → Media | Media |
| **VerificationDocument** | VerificationCase | docType (DocumentType), status (VerificationDocStatus), mediaId → Media | Media (folder `verification/{entityType}`) |

**Reference:** [prisma/schema.prisma](../../prisma/schema.prisma) — OwnerKycDocument (~666+), OrganizationDocument (~742+), BranchDocument (~841+), VerificationDocument (~924+), Media (~1234+).

### 5.2 DocumentType enum (schema)

- **Owner KYC:** NID_FRONT, NID_BACK, SELFIE_WITH_NID, TRADE_LICENSE, OTHER.
- **Org legal:** TRADE_LICENSE, TIN_CERT, BIN_CERT, INCORPORATION_CERT, PARTNERSHIP_DEED, BOARD_RESOLUTION, BANK_CHEQUE_LEAF, OTHER.
- **Branch:** STORE_FRONT_PHOTO, STORE_INSIDE_PHOTO, SIGNBOARD_PHOTO, VET_LICENSE, DRUG_LICENSE, OTHER.

**Reference:** [prisma/schema.prisma](../../prisma/schema.prisma) — enum DocumentType (~2381+).

### 5.3 API document rules

- **Owner KYC upload** (`POST /api/v1/owner/kyc/documents`): Requires KYC row, not locked. `type` required; allowed: NID_FRONT, NID_BACK, SELFIE_WITH_NID, TRADE_LICENSE, OTHER. Field name `file`.
- **Verification case upload** (`POST /api/v1/owner/verification-case/documents`): entityType, entityId, docType required; allowed all DocumentType values. Field name `file`.
- **ensureOwnerKyc:** At least one OwnerKycDocument required for SUBMITTED/VERIFIED to pass (when middleware is used).

**Reference:** [src/api/v1/modules/owner/owner.controller.ts](../../src/api/v1/modules/owner/owner.controller.ts) — uploadOwnerKycDocument (~524+); [src/api/v1/modules/owner/owner.verification.controller.ts](../../src/api/v1/modules/owner/owner.verification.controller.ts) — uploadVerificationDocument (~232+).

### 5.4 File size and processing

- **Owner routes (multer):** `MAX_UPLOAD_BYTES` env, default 15MB. [owner.routes.ts](../../src/api/v1/modules/owner/owner.routes.ts).
- **Media processing:** Images optimized (sharp, resize, jpeg); video optional transcode (ffmpeg). No explicit allowlist of MIME types in owner KYC/verification controllers; multer accepts file and media.processor handles image/video. Non-image/non-video passes through unchanged.
- **Storage:** S3/MinIO via `media.service.uploadAndCreateMedia`; Media record: url, key, type, mimeType, sizeBytes, hash, ownerUserId.

**References:**
- [src/api/v1/modules/media/media.service.ts](../../src/api/v1/modules/media/media.service.ts) — uploadAndCreateMedia, S3 PutObjectCommand.
- [src/api/v1/modules/media/media.processor.ts](../../src/api/v1/modules/media/media.processor.ts) — processUploadFile, isImage, isVideo.

---

## 6. Permission / Role Checks (403 / AccessDenied)

### 6.1 Middlewares

| Middleware | Effect | Used on |
|------------|--------|--------|
| **ownerPanelGuard** | 403 if role not in OWNER, ADMIN, STAFF, TEAM (or context) | All owner routes after auth (except onboarding/me/profile/kyc which run before guard). |
| **ensureOwnerKyc** | 403 KYC_REQUIRED / KYC_NOT_SUBMITTED / KYC_DOCUMENT_REQUIRED / KYC_LOCKED | Not used on any route in codebase. |
| **requireOwnerKycVerified** | 403 KYC_VERIFIED_REQUIRED if owner KYC not VERIFIED | Partner: `POST /partner/branches/:branchId/publish`. |
| **requireOwnerPermission(scope, resource)** | 403 if user lacks permission for org/branch | Owner: org/branch update/delete, branch write. |
| **requireApprovedPartner** (internal) | 403 if PartnerApplication not APPROVED | Partner: createOrganization, createBranch. |

**References:**
- [src/middlewares/ownerPanelGuard.ts](../../src/middlewares/ownerPanelGuard.ts)
- [src/api/v1/modules/owner/owner.routes.ts](../../src/api/v1/modules/owner/owner.routes.ts)
- [src/api/v1/modules/partner_onboarding/partner_onboarding.controller.ts](../../src/api/v1/modules/partner_onboarding/partner_onboarding.controller.ts) — requireApprovedPartner.

### 6.2 Controller-level 403s

| Location | Condition | Response |
|----------|-----------|----------|
| owner.controller | KYC locked (upsert/submit/delete doc) | 403 'KYC is locked' |
| owner.controller | Org/branch not found or not owned | 404 |
| owner.controller | Verification hard lock (env) | 409 VERIFICATION_LOCKED |
| productImport.controller | No organization access / org or branch not accessible | 403 "No organization access" / "Organization not accessible" / "Branch not accessible" |
| orders.controller | Order/branch access | 403 (e.g. branch not accessible) |
| partner_onboarding.controller | requireApprovedPartner throws | 403 "Partner application required" / "not approved" |
| owner.verification.controller | ensureOwnerEntityAccess | 403 Forbidden |

**Reference:** [src/api/v1/modules/owner/owner.controller.ts](../../src/api/v1/modules/owner/owner.controller.ts) — 403 on KYC locked; [src/api/v1/modules/owner/productImport.controller.ts](../../src/api/v1/modules/owner/productImport.controller.ts) — 403 on org/branch access.

---

## 7. Gaps & Unclear Requirements

1. **ensureOwnerKyc not applied:** Middleware exists but is not used on any owner route. So org/branch creation in Owner panel is not gated by KYC or “at least one document” at API level; only UX redirects to KYC and partner branch publish requires verified KYC.
2. **Owner onboarding/start skips KYC:** `POST /owner/onboarding/start` creates org + branch without checking KYC. Combined with (1), an owner can have org/branch without ever submitting KYC until they hit an action that uses requireOwnerKycVerified (e.g. partner publish).
3. **Document type vs entity:** No single table mapping “for entity type X, document types Y are required”. Required doc types are implied by UI and by ensureOwnerKyc (≥1 document), not by entity-specific validation in code.
4. **Allowed file formats:** No explicit allowlist of MIME types or extensions for KYC/verification uploads; only size limit and media processor (image/video). PDF and other types are not explicitly allowed or rejected in the scanned owner/verification upload code.
5. **ProducerOrg KYC:** Producer “KYC” is ProducerOrg status (PENDING/VERIFIED) and optional docsJson; no separate document table or DocumentType for producer in schema. Producer panel has `/producer/kyc`; backend submitKyc accepts name, countryCode, docsJson — not aligned with a formal document model like Owner/Org/Branch.
6. **PartnerApplication vs Owner flow:** Two paths: (a) Partner wizard (apply → admin approve → create org/branch with requireApprovedPartner), (b) Owner panel (register with isOwner → onboarding/start or create org/branch directly). Relationship between PartnerApplication and OwnerProfile/OwnerKyc is not enforced in code (e.g. same user can have both; no mandatory link).
7. **VerificationCase for PRODUCER_ORG:** Schema has VerificationEntityType PRODUCER_ORG and admin_verifications uses it for producer org approve/reject, but owner panel verification-case API is owner/org/branch focused; producer verification flow is separate (ProducerOrg.status, admin producer-org endpoints).
8. **Required fields for submit:** Owner KYC submit does not validate a minimum set of fields (e.g. fullName, address, nid) in one place; draft can be partial. “Minimum requirements for verification queue” exist for branch (submitBranch) but not consolidated in a single validator.
9. **Staff invite register:** Register with invite token (staff/country) is validated in auth.controller verifyInvite; mandatory fields for staff-onboarded users are not listed in this spec (separate flow).
10. **Mother workspace:** “Mother” is the customer-facing app and redirect fallback; no business verification or onboarding model in this scan beyond auth and profile.

---

## 8. Quick reference – file paths

| Topic | File path |
|-------|-----------|
| Auth register/login, needsOnboarding | `src/api/v1/modules/auth/auth.controller.ts` |
| Auth redirect, contexts | `src/api/v1/services/authUnified.service.ts` |
| Owner onboarding | `src/api/v1/modules/owner/onboarding.controller.js` |
| Owner routes | `src/api/v1/modules/owner/owner.routes.ts` |
| Owner KYC & verification | `src/api/v1/modules/owner/owner.controller.ts`, `owner.verification.controller.ts` |
| ensureOwnerKyc | `src/middlewares/ensureOwnerKyc.ts` |
| requireOwnerKycVerified | `src/middlewares/requireOwnerKycVerified.ts` |
| ownerPanelGuard | `src/middlewares/ownerPanelGuard.ts` |
| Partner onboarding | `src/api/v1/modules/partner_onboarding/partner_onboarding.routes.ts`, `partner_onboarding.controller.ts` |
| Admin onboarding | `src/api/v1/modules/partner_onboarding/admin_onboarding.routes.ts` |
| Producer auth & register | `src/api/v1/modules/producer/producer.controller.ts`, `producer.service.ts` |
| Owner layout & redirects | `bpa_web/app/owner/layout.jsx` |
| Admin menu (onboarding) | `bpa_web/src/lib/permissionMenu.ts` |
| Schema (Owner, KYC, Org, Branch, Verification, Media, Producer) | `prisma/schema.prisma` |
| Media upload (S3/MinIO) | `src/api/v1/modules/media/media.service.ts`, `media.processor.ts` |

---

*Document generated from codebase scan. No code changes were made.*
