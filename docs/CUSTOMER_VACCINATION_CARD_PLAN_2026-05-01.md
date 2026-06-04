# Customer Vaccination Card Plan

## 1. Goal
Add an owner/customer-facing vaccination card so a pet owner can open their own pet, see a privacy-safe vaccination history, understand what is due next, and eventually print or share the card without exposing clinic-only operational data.

Recommended first target:
- Authenticated owner route: `GET /api/v1/owner/me/pets/:petId/vaccination-card`

Reason:
- The backend already exposes owner pet reads under `/api/v1/owner/me/pets` in [src/api/v1/modules/owner/owner.routes.ts](D:/BPA_Data/backend-api/src/api/v1/modules/owner/owner.routes.ts:28) and [src/api/v1/modules/owner/owner.controller.ts](D:/BPA_Data/backend-api/src/api/v1/modules/owner/owner.controller.ts:345).
- The frontend already has an owner "My Pets" flow at [app/owner/(larkon)/pets/page.tsx](D:/BPA_Data/bpa_web/app/owner/(larkon)/pets/page.tsx:1) and [app/owner/(larkon)/pets/[id]/page.tsx](D:/BPA_Data/bpa_web/app/owner/(larkon)/pets/[id]/page.tsx:1).
- The `mother` panel exists, but today it is only a thin customer surface with placeholder dashboard/health pages and no pet pages: [app/mother/page.jsx](D:/BPA_Data/bpa_web/app/mother/page.jsx:1), [app/mother/(larkon)/dashboard/page.tsx](D:/BPA_Data/bpa_web/app/mother/(larkon)/dashboard/page.tsx:1), [app/mother/(larkon)/health/page.jsx](D:/BPA_Data/bpa_web/app/mother/(larkon)/health/page.jsx:1).

## 2. Existing Owner/Pet System
### Backend
- Owner pet read endpoints already exist:
  - `GET /api/v1/owner/me/pets`
  - `GET /api/v1/owner/me/pets/:petId`
  - Registered in [src/api/v1/modules/owner/owner.routes.ts](D:/BPA_Data/backend-api/src/api/v1/modules/owner/owner.routes.ts:28).
- Those handlers enforce owner ownership with `Pet.userId = current user` and `deleted = false`:
  - [src/api/v1/modules/owner/owner.controller.ts](D:/BPA_Data/backend-api/src/api/v1/modules/owner/owner.controller.ts:345)
  - [src/api/v1/modules/owner/owner.controller.ts](D:/BPA_Data/backend-api/src/api/v1/modules/owner/owner.controller.ts:364)
- Canonical pet CRUD already exists under `/api/v1/user/pets`:
  - Mounted in [src/api/v1/routes.ts](D:/BPA_Data/backend-api/src/api/v1/routes.ts:83)
  - Routes in [src/api/v1/modules/pets/pets.routes.ts](D:/BPA_Data/backend-api/src/api/v1/modules/pets/pets.routes.ts:1)
  - Aggregated pet profile endpoint exists but currently returns hard-coded vaccination status placeholders in [src/api/v1/modules/pets/pets.controller.ts](D:/BPA_Data/backend-api/src/api/v1/modules/pets/pets.controller.ts:507)

### Clinic Vaccination APIs
- Staff clinic vaccination routes are separate and branch-scoped:
  - `GET /api/v1/clinic/branches/:branchId/patients/:petId/vaccinations`
  - `GET /api/v1/clinic/branches/:branchId/patients/:petId/vaccinations/next-due`
  - `POST /api/v1/clinic/branches/:branchId/vaccinations`
  - `POST /api/v1/clinic/branches/:branchId/vaccinations/administer`
  - `PATCH /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/correct`
  - `POST /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/void`
  - `GET /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/audit`
  - Defined in [src/api/v1/modules/clinic/clinic.routes.ts](D:/BPA_Data/backend-api/src/api/v1/modules/clinic/clinic.routes.ts:981)
- Access is guarded by clinic branch membership plus clinic permissions in [src/api/v1/modules/clinic/clinic.middleware.ts](D:/BPA_Data/backend-api/src/api/v1/modules/clinic/clinic.middleware.ts:18).
- Pet visibility for clinic routes is branch-linked, not owner-linked, via `resolvePatientForBranch` in [src/api/v1/modules/clinic/clinic.controller.ts](D:/BPA_Data/backend-api/src/api/v1/modules/clinic/clinic.controller.ts:2463).
- Vaccination service already supports:
  - legacy/manual records with nullable branch linkage
  - stock-backed administration
  - idempotency replay
  - correction
  - void
  - audit events
  - See [src/api/v1/modules/clinic/vaccination.service.ts](D:/BPA_Data/backend-api/src/api/v1/modules/clinic/vaccination.service.ts:48)

### Frontend
- Owner pet pages already exist:
  - list page: [app/owner/(larkon)/pets/page.tsx](D:/BPA_Data/bpa_web/app/owner/(larkon)/pets/page.tsx:1)
  - detail page: [app/owner/(larkon)/pets/[id]/page.tsx](D:/BPA_Data/bpa_web/app/owner/(larkon)/pets/[id]/page.tsx:1)
- Owner dashboard already links into My Pets in [app/owner/(larkon)/dashboard/page.jsx](D:/BPA_Data/bpa_web/app/owner/(larkon)/dashboard/page.jsx:269).
- Owner pet helpers already exist in [app/owner/_lib/ownerApi.ts](D:/BPA_Data/bpa_web/app/owner/_lib/ownerApi.ts:2454).
- Shared frontend API helpers in [lib/api.ts](D:/BPA_Data/bpa_web/lib/api.ts:4617) currently cover staff clinic vaccination APIs only, not owner/customer vaccination-card APIs.
- There is no `app/customer` route tree. The customer-facing surface is currently `app/mother`, and it does not yet contain pet management or vaccination pages.

## 3. Required Customer API
Recommended route:
- `GET /api/v1/owner/me/pets/:petId/vaccination-card`

Why this route instead of `/api/v1/owner/pets/:petId/vaccination-card`:
- It matches the existing owner pet namespace exactly.
- It can live beside the current `GET /api/v1/owner/me/pets/:petId`.
- It avoids inventing a second owner-pet routing pattern.

Suggested response shape:

```json
{
  "success": true,
  "data": {
    "pet": {
      "id": 123,
      "name": "Milo",
      "species": "Dog",
      "breed": "Golden Retriever",
      "sex": "MALE",
      "dateOfBirth": "2023-02-01T00:00:00.000Z",
      "microchipNumber": "optional-safe-if-business-allows"
    },
    "cardStatus": {
      "summary": "UP_TO_DATE",
      "overdueCount": 0,
      "upcomingCount": 1,
      "lastVaccinatedAt": "2026-03-15T10:00:00.000Z",
      "nextDueAt": "2026-06-15T00:00:00.000Z"
    },
    "nextDue": [
      {
        "vaccinationId": 77,
        "vaccineTypeId": 5,
        "vaccineName": "Rabies",
        "nextDueDate": "2026-06-15T00:00:00.000Z",
        "status": "DUE_SOON"
      }
    ],
    "history": [
      {
        "vaccinationId": 77,
        "vaccineTypeId": 5,
        "vaccineName": "Rabies",
        "administeredAt": "2026-03-15T10:00:00.000Z",
        "nextDueDate": "2026-06-15T00:00:00.000Z",
        "status": "ACTIVE",
        "recordType": "STOCK_BACKED",
        "branchName": "Gulshan Clinic",
        "doctorName": "Dr. Ayesha Rahman",
        "vetClinic": null,
        "notes": null
      }
    ],
    "meta": {
      "printReady": false,
      "qrReady": false
    }
  }
}
```

Planned backend behavior:
- Authorize with current owner session.
- Load pet by `id + userId + deleted = false`, reusing the same owner ownership rule as `getMyPet`.
- Read vaccination records directly from `vaccination` with `vaccineType`, plus safe branch/doctor display joins where available.
- Exclude internal-only fields from serialization instead of reusing staff audit payloads.
- Default history behavior:
  - include `ACTIVE`
  - include `CORRECTED` with a badge
  - exclude `VOIDED` from customer history by default
- Compute `cardStatus` from all owner-visible, non-voided records.
- Do not reuse `getVaccinationAudit` or billing payloads for this route.

Important implementation note:
- Existing `getNextDueByPet` only returns future non-voided due dates in [src/api/v1/modules/clinic/vaccination.service.ts](D:/BPA_Data/backend-api/src/api/v1/modules/clinic/vaccination.service.ts:535).
- Owner card status needs overdue detection too, so the new owner endpoint should compute overdue/upcoming summary itself instead of relying on that helper unchanged.

## 4. Access Control
- Only the authenticated pet owner/customer may access their own pet vaccination card.
- Clinic staff routes remain separate and unchanged under `/api/v1/clinic/...`.
- This owner/customer route should not depend on clinic branch permissions.
- The owner/customer endpoint should stay authenticated, not public.
- Future QR/public share should use a separate tokenized route in a later phase, not the owner session route.

Recommended authorization rule:
- `pet.id === :petId`
- `pet.userId === req.user.id`
- `pet.deleted === false`

Recommended placement:
- Add the route alongside existing `/owner/me/pets/:petId` routes, before owner-panel business permissions are relevant.
- This is a personal record read, not an org/branch management action.

## 5. Frontend Plan
Recommended first frontend target:
- Existing owner pet detail page at `app/owner/(larkon)/pets/[id]/page.tsx`

Recommended UX:
- `My Pets -> Pet Details -> Vaccination Card`
- First implementation can be either:
  - a new section on the existing pet detail page, or
  - a dedicated child page such as `/owner/pets/[id]/vaccination-card`

Recommendation:
- Phase A-B should extend the existing detail flow, with `/owner/pets/[id]` remaining the entry point.
- If a separate URL is preferred for print/layout isolation, use `/owner/pets/[id]/vaccination-card`.

UI contents:
- history table
- next due panel
- overdue badges
- download/print placeholder
- QR placeholder for future phase

Frontend wiring plan:
- Add owner helper in `app/owner/_lib/ownerApi.ts` first, because existing owner pet pages already use `ownerMyPets` and `ownerMyPetGet`.
- `lib/api.ts` does not currently host owner pet helpers, so it is not the best Phase A-B home unless the team wants later reuse from `mother`.
- Do not plan the first UI in `app/mother` yet; that panel currently lacks pet pages and would increase scope.

## 6. Data Privacy
Customer can see:
- pet basic profile needed for card context
- vaccine name/type
- administered date
- next due date
- customer-safe record status
- safe branch display name, when present
- safe doctor/vet display name, when present
- `vetClinic` text if it is already a customer-facing manual field
- customer-approved notes only if the product explicitly approves this field for owner display

Customer should not see:
- private/internal staff notes by default
- audit events
- correction reasons intended for staff-only operations
- void reasons intended for staff-only operations
- stock ledger ids
- inventory batch ids
- clinical item ids
- clinical item variant ids
- billing order ids
- invoice ids
- idempotency keys
- certificate tokens
- branch access metadata
- actor user ids, branch member ids, or internal permission data

Default recommendation for notes:
- Hide `vaccination.notes` until the business confirms that staff notes are safe for customer viewing.
- If later enabled, introduce a dedicated customer-safe note field or explicit allowlist rule instead of exposing raw internal notes.

## 7. Risks
- Legacy records:
  - Some vaccination rows are branch-null manual records, and the service already flags them as legacy/manual.
  - Owner card should display them safely without pretending branch attribution is certain.
- Voided records:
  - Staff service supports `VOIDED`.
  - Showing voided records to customers may confuse them unless carefully labeled.
  - Default recommendation is to exclude them from customer history in Phase A-B.
- Corrected records:
  - Current correction updates the same record status to `CORRECTED`.
  - Customer UI should show a corrected badge, not internal correction audit detail.
- Private notes:
  - Existing `notes` field is operationally ambiguous.
  - Treat as private by default.
- Branch visibility:
  - Some legacy/manual records may have no safe branch association.
  - Use `branchName` only when confidently available.
- Missing customer link:
  - Clinic records may exist for pets/appointments before an owner link is complete.
  - Owner route can only show records for pets already linked to the authenticated user.
- Overdue logic gap:
  - Existing helper returns upcoming due items, not overdue ones.
  - New endpoint must compute overdue summary directly.
- Public route confusion:
  - There is a certificate-token route today, but it is still staff-permissioned and branch-scoped in [src/api/v1/modules/clinic/clinic.routes.ts](D:/BPA_Data/backend-api/src/api/v1/modules/clinic/clinic.routes.ts:1037).
  - Do not treat it as a customer/public solution for Phase A-B.

## 8. Implementation Phases
### Phase A: owner API
- Add `GET /api/v1/owner/me/pets/:petId/vaccination-card`
- Reuse owner ownership check pattern from existing owner pet reads
- Build privacy-safe DTO
- Exclude voided records by default
- Compute next due and overdue summary in the owner layer

### Phase B: owner frontend card tab/page
- Add Vaccination Card entry from `My Pets -> Pet Details`
- Render history table, next due summary, overdue badges
- Add empty placeholders for print/download and QR
- Keep this in owner panel first

### Phase C: print-friendly UI
- Add print stylesheet or dedicated print view
- Keep same owner-authenticated data source

### Phase D: QR/PDF later
- Add QR/share strategy later
- Decide between tokenized public view vs authenticated share flow
- Add PDF/export later after privacy review

## 9. Exact Next Implementation Command
`Implement Phase A-B by adding GET /api/v1/owner/me/pets/:petId/vaccination-card with owner-only access and a privacy-safe response, then surface it from the existing /owner/pets/[id] flow as a Vaccination Card page/section with history, next due, overdue badges, and print/QR placeholders.`
