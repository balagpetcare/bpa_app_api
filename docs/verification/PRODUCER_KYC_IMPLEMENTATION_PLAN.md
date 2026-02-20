# Producer KYC Implementation Plan (VerificationCase + ProducerOrgDocument)

## Goal
Replace Producer `docsJson`-only flow with a formal document model and unify with VerificationCase. Backward compatible; no break to registration/login redirects.

---

## Touched Files

| Area | File | Change |
|------|------|--------|
| **Prisma** | `prisma/schema.prisma` | Add `ProducerOrgDocument` model; `ProducerOrg.documents`, `ProducerOrg.legacyDocsJson`; `Media.producerOrgDocuments` |
| **Prisma** | New migration | Safe name e.g. `20250210000000_producer_org_document` |
| **API** | `src/api/v1/modules/producer/producerKyc.controller.ts` | **New** – GET status, POST submit, POST documents |
| **API** | `src/api/v1/modules/producer/producerKyc.service.ts` | **New** – getOrCreateCase, validation, missingDocs, MIME/size |
| **API** | `src/api/v1/modules/producer/producer.routes.ts` | Mount kyc routes; multer for documents |
| **API** | `src/api/v1/modules/producer/producer.service.ts` | submitKyc: persist to `legacyDocsJson`, deprecation comment |
| **Auth** | `src/api/v1/services/authUnified.service.ts` | Producer context from VerificationCase; decideRedirect by case status |
| **Admin** | `src/api/v1/modules/admin_verifications/admin_verifications.controller.ts` | approveProducerOrg/rejectProducerOrg: update VerificationCase + ProducerOrg.status |
| **Frontend** | `bpa_web/app/producer/kyc/page.jsx` | Use new status/submit/documents API; checklist, upload, pending/rejected |
| **Script** | `scripts/migrate-producer-kyc-to-verification-case.ts` | **New** – idempotent: create DRAFT VerificationCase per ProducerOrg; legacy docsJson → notes |
| **Docs** | `docs/verification/00-canonical-system-requirements.md` | **New** – canonical reference |
| **Docs** | `docs/verification/business/producer.md` | **New** – Producer KYC checklist, DocumentType map |
| **Tests** | `src/api/v1/modules/producer/producerKyc.test.ts` | **New** – minimal stubs or integration examples |

---

## Part 1 – Prisma

- **ProducerOrgDocument**: `id`, `producerOrgId` (FK), `type` (DocumentType), `status` (DocumentStatus), `mediaId` (FK → Media), `createdAt`, `updatedAt`. Use existing enums.
- **ProducerOrg**: add `documents ProducerOrgDocument[]`, `legacyDocsJson Json?` (optional).
- **Media**: add `producerOrgDocuments ProducerOrgDocument[]`.
- Migration: add table `producer_org_documents`, add column `legacy_docs_json` to `producer_orgs`.

---

## Part 2 – API

- **GET /api/v1/producer/kyc/status**: Return `{ producerOrgId, verificationCaseId, status, missingDocs[], canSubmit }`. Use producerKyc.service.
- **POST /api/v1/producer/kyc/submit**: Get/create VerificationCase (PRODUCER_ORG, entityId = producerOrgId), set status SUBMITTED.
- **POST /api/v1/producer/kyc/documents**: multipart `file` + `docType`; MIME allowlist (images + PDF); max size MAX_UPLOAD_BYTES; create VerificationDocument + ProducerOrgDocument.
- **Validation**: At least one of TRADE_LICENSE | INCORPORATION_CERT | OTHER; at least one identity (NID_FRONT or SELFIE_WITH_NID). Allowlist for Producer KYC doc types.
- **Legacy**: Existing `POST /kyc/submit` (body: name, countryCode, docsJson) → save to `legacyDocsJson`, return deprecation warning in response.

---

## Part 3 – Auth

- **resolveAuthContexts**: For producer (owner), load latest VerificationCase for PRODUCER_ORG + entityId = producerOrg.id. Map: no case/DRAFT → PENDING; SUBMITTED → PENDING; APPROVED → APPROVED; REJECTED → PENDING (or keep REJECTED for “show KYC page”).
- **decideRedirect**: Producer → if case status DRAFT or SUBMITTED or no case → `/producer/kyc`; if APPROVED → `/producer` or `/producer/dashboard`.

---

## Part 4 – Admin

- **approveProducerOrg**: Update latest VerificationCase (PRODUCER_ORG, entityId) to APPROVED, set ProducerOrg.status = VERIFIED.
- **rejectProducerOrg**: Update latest VerificationCase to REJECTED, set ProducerOrg.status = REJECTED.

---

## Part 5 – Frontend

- Producer KYC page: call GET `/api/v1/producer/kyc/status`; show checklist (missingDocs), upload form (docType + file), submit button (POST `/kyc/submit`). If status SUBMITTED show “Pending Review”; if REJECTED show reason and allow re-submit (new case or same flow).

---

## Part 6 – Data migration

- Script: for each ProducerOrg without a VerificationCase (PRODUCER_ORG, entityId), create one (DRAFT). If docsJson present, store as payloadJson or note. Idempotent (skip if case exists).

---

## Part 7 – Documentation & tests

- `00-canonical-system-requirements.md`: state ProducerOrg uses VerificationCase + ProducerOrgDocument; docsJson deprecated.
- `business/producer.md`: checklist and DocumentType mapping.
- Jest: `src/api/v1/modules/producer/producerKyc.test.ts` (validation helpers).
- Curl examples (Producer KYC; replace TOKEN and optional file path):

```bash
# Status
curl -s -H "Cookie: access_token=TOKEN" -H "Accept: application/json" "http://localhost:3000/api/v1/producer/kyc/status"

# Submit (new flow, no body)
curl -s -X POST -H "Cookie: access_token=TOKEN" -H "Content-Type: application/json" -d "{}" "http://localhost:3000/api/v1/producer/kyc/submit"

# Upload document
curl -s -X POST -H "Cookie: access_token=TOKEN" -F "file=@/path/to/doc.pdf" -F "docType=TRADE_LICENSE" "http://localhost:3000/api/v1/producer/kyc/documents"
```
