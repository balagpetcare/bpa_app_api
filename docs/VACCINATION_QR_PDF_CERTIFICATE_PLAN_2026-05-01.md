# Vaccination QR/PDF Certificate Plan

## 1. Goal
Add a customer-safe vaccination certificate flow that supports:

- public QR verification without login
- owner-visible print/download entry points from the existing pet vaccination card
- staff-visible print action from the clinic vaccination page
- a printable vaccination card/certificate that can later evolve into downloadable PDF

This phase should extend the existing read-only vaccination card work, not replace the staff clinic vaccination module and not introduce customer write access.

## 2. Existing Token/Certificate Support
Current backend support already gives us a workable starting point:

- `Vaccination.certificateToken` exists in `prisma/schema.prisma` as nullable and unique
- `certificateToken` is generated when a vaccination is created manually and when it is administered with stock deduction in `src/api/v1/modules/clinic/vaccination.service.ts`
- the current lookup route is staff-only: `GET /api/v1/clinic/branches/:branchId/vaccinations/certificate/:token`
- the current service helper `getByCertificateToken(token)` returns the normal vaccination record shape, which includes internal refs that are not safe for a public response

Current limitations:

- there is no public verification route yet
- `certificateToken` is nullable, so some legacy rows may not have a token
- there is no certificate revocation/versioning layer yet beyond vaccination status such as `VOIDED`
- there is no customer-safe serializer dedicated to public verification
- there is no current QR generation or embedded certificate document output

Related existing surfaces:

- owner vaccination card already exists at backend route `GET /api/v1/owner/me/pets/:petId/vaccination-card`
- owner vaccination card page already exists at `bpa_web/app/owner/(larkon)/pets/[id]/vaccination-card/page.tsx`
- staff vaccination workflow exists at `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/vaccinations/page.jsx`

## 3. Public Verification API
Recommended route:

`GET /api/v1/public/vaccinations/verify/:token`

Why this route:

- it keeps verification separate from authenticated owner and staff routes
- it matches the intended public use case for QR scanning
- it avoids leaking branch-scoped clinic route structure into a public endpoint

Recommended behavior:

- look up vaccination by `certificateToken`
- treat missing token, null token, `VOIDED` record, or revoked certificate state as not valid
- return a certificate-safe projection only
- do not return raw normalized clinic vaccination objects

Recommended safe public response:

```json
{
  "success": true,
  "data": {
    "valid": true,
    "status": "ACTIVE",
    "verifiedAt": "2026-05-01T12:00:00.000Z",
    "certificate": {
      "token": "optional-token-or-omit",
      "pet": {
        "displayName": "Luna",
        "animalType": "Dog",
        "breed": "Golden Retriever"
      },
      "vaccination": {
        "vaccineName": "Rabies",
        "administeredAt": "2026-03-10T00:00:00.000Z",
        "nextDueDate": "2027-03-10T00:00:00.000Z",
        "manufacturer": "safe-if-present",
        "batchNumber": "safe-if-present"
      },
      "clinic": {
        "branchName": "BPA Dhanmondi"
      }
    }
  }
}
```

Public response rules:

- include `valid` or `invalid`
- include a minimal pet display identity
- include only the vaccination record being verified, not the pet's entire clinical timeline, for the first version
- include branch or clinic name when available
- exclude owner name, phone, address, payment, notes, stock, billing, audit, and internal refs

Recommendation on pet identity:

- default to pet display name plus high-level taxonomy
- if privacy concerns are higher, support a masked variant such as first name plus pet type in a later toggle

## 4. QR Generation Strategy
Recommendation: encode the public verify URL, not a signed payload blob.

Preferred QR content:

`https://<public-app-origin>/verify/vaccinations/<token>`

Why URL-based QR is the better fit here:

- simpler scanning flow for owners, clinics, and third parties
- avoids duplicating certificate data inside the QR itself
- keeps revocation and correction logic server-controlled
- lets us change public response formatting later without regenerating every QR contract

Avoid for now:

- embedding vaccination metadata directly into the QR payload
- unsigned JSON blobs in the QR
- owner PII in QR content

Future hardening option:

- if token leakage becomes a concern, move later to opaque high-entropy tokens with optional signed short-lived redirect exchange, while keeping the same scan URL shape

## 5. PDF Strategy
Recommended strategy: Phase C should be printable HTML generated on demand, and Phase D can add real PDF generation only after the printable layout is stable.

Why:

- the backend currently has no dedicated PDF generation dependency such as `pdfkit`, `puppeteer`, or similar
- the system already has an established HTML print pattern in `src/api/v1/modules/inventory/printDocuments.service.ts`
- the frontend already uses browser print flows elsewhere, which is the fastest low-risk path for certificate rollout

Phase C printable card:

- generate a print-friendly HTML card or certificate view on demand
- render from owner and staff UI using browser print
- embed the public verify URL as visible text and later as QR
- include clinic branding, pet identity, vaccine details, administered date, next due date, and verification note

Phase D PDF strategy:

- first choice: generate PDF from the stabilized print-friendly HTML
- do not store PDFs by default in Phase D unless regulation or offline evidence requires immutable artifacts
- if stored later, use the existing media/storage pipeline and keep files versioned

Branding/signature/versioning plan:

- branch logo and clinic name from branch profile if available
- doctor/staff signature should be optional and only shown if an approved signature source exists
- certificate should show issue timestamp and printable version label
- verified status must always be driven by live token verification, even if an old PDF still exists

Revocation/versioning rule:

- QR verify result is the source of truth
- a printed or downloaded certificate becomes informational if the underlying record is later corrected, voided, or revoked

## 6. Frontend Plan
Public verify page:

- add public page at `bpa_web/app/verify/vaccinations/[token]/page.tsx`
- follow the existing public verification precedent from `bpa_web/app/verify/[serial]/page.tsx`
- show valid or invalid state, certificate details, clinic verification, and privacy-safe messaging

Owner UI:

- keep the existing owner vaccination card page at `bpa_web/app/owner/(larkon)/pets/[id]/vaccination-card/page.tsx`
- add `Download/Print` button after public verify and print HTML are available
- add `QR coming soon` or `Verification available soon` placeholder before QR embedding lands

Staff UI:

- add a `Print Card` or `Print Certificate` action on `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/vaccinations/page.jsx`
- keep this separate from public verify so staff actions remain permissioned and branch-aware

Shared UI expectations:

- certificate summary card
- printable layout with minimal chrome
- clear badge for active, invalid, revoked, or voided state
- customer-safe content only

## 7. Security/Privacy
Public and owner-facing certificate views must not expose sensitive fields.

Safe to expose:

- pet display name
- animal type and optionally breed
- vaccine name
- administered date
- next due date
- manufacturer if approved as safe
- batch number if approved as safe by business and compliance
- branch or clinic display name
- public certificate validity state

Do not expose:

- owner phone, email, address, NID, KYC, or payment data
- internal stock ledger IDs
- inventory batch IDs
- order IDs
- invoice IDs
- internal branch or org IDs
- audit event data
- private staff notes
- correction notes beyond a high-level invalid or superseded result

Token handling rules:

- treat the token as a bearer-style verification secret
- never expose token lists in owner or staff tables unnecessarily
- avoid logging full tokens in analytics or error logs
- if the token is shown in any payload, prefer returning only what the page needs

## 8. Risks
- legacy vaccinations may have `certificateToken = null`, so public verify cannot work for every old record without fallback issuance
- voided or corrected vaccinations may leave stale printed copies in circulation
- current token lookup helper returns a broader internal record shape and must not be reused directly as a public response serializer
- batch number may be considered sensitive in some jurisdictions or business workflows and may need a final policy decision before exposure
- branch visibility can be inconsistent for legacy/manual rows where branch linkage is missing
- owner-facing print and public verify can drift if they do not share one certificate-safe mapping layer
- stored PDFs can become outdated after correction or void unless revocation and version labeling are explicit
- token leakage through screenshots, copied URLs, or browser history is possible

## 9. Implementation Phases
Phase A: public verify API

- add `GET /api/v1/public/vaccinations/verify/:token`
- add certificate-safe serializer and status rules
- return invalid for missing, voided, revoked, or unknown tokens

Phase B: public verify page

- add `app/verify/vaccinations/[token]/page.tsx`
- render public-safe verification result
- keep styling simple and scan-friendly

Phase C: print-friendly HTML card

- add print-focused owner and staff certificate view/action
- reuse the same safe certificate mapping
- use browser print instead of server PDF generation

Phase D: PDF generation

- add true downloadable PDF from the stabilized print layout
- optionally integrate with media storage only if persistent artifact storage is required

Phase E: QR generation/embedding

- generate QR from the public verify URL
- embed it into owner and staff print views and later PDF

## 10. Exact Next Implementation Command
Implement Phase A-C only: add `GET /api/v1/public/vaccinations/verify/:token`, build `app/verify/vaccinations/[token]/page.tsx`, and add print-friendly owner/staff vaccination certificate actions using shared safe certificate mapping and browser-print HTML, without PDF storage or QR embedding yet.
