# Producer KYC — Checklist & Document Types

## DocumentType (Producer allowlist)

| Doc type | Use | Required for submit |
|----------|-----|----------------------|
| NID_FRONT | Identity | One of (NID_FRONT or SELFIE_WITH_NID) |
| NID_BACK | Identity (optional) | — |
| SELFIE_WITH_NID | Identity | One of (NID_FRONT or SELFIE_WITH_NID) |
| TRADE_LICENSE | Business proof | One of (TRADE_LICENSE, INCORPORATION_CERT, OTHER) |
| INCORPORATION_CERT | Business proof | One of (TRADE_LICENSE, INCORPORATION_CERT, OTHER) |
| OTHER | Other | One of (TRADE_LICENSE, INCORPORATION_CERT, OTHER) |

## Submit rules

- At least **one business doc**: TRADE_LICENSE, INCORPORATION_CERT, or OTHER.
- At least **one identity doc**: NID_FRONT or SELFIE_WITH_NID.
- At least one document total (enforced by backend).

## File rules

- **MIME allowlist**: image/jpeg, image/png, image/webp, application/pdf.
- **Max size**: `MAX_UPLOAD_BYTES` (default 15MB).

## API

- `GET /api/v1/producer/kyc/status` — producerOrgId, verificationCaseId, status, missingDocs, canSubmit, documents.
- `POST /api/v1/producer/kyc/documents` — multipart: `file`, `docType`.
- `POST /api/v1/producer/kyc/submit` — submit case (no body for new flow).

## Status flow

- DRAFT → upload docs → Submit → SUBMITTED → Admin approve/reject → APPROVED or REJECTED.
- REJECTED → upload to new DRAFT (createIfRejected) → submit again.
