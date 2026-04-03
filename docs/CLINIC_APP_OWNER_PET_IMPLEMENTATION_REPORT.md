# BPA Clinic + App Owner/Pet Identity — Implementation Report

**Date:** 2026-03-14  
**Reference:** CLINIC_APP_OWNER_PET_IDENTITY_STRATEGY.md, IMPLEMENTATION_SPEC.md, API_CONTRACTS.md, DB_PLAN.md.

**Canonical decision:** Option A — User-first identity model (finalized).

---

## 1. Phases completed

| Phase | Status | Summary |
|-------|--------|---------|
| **Phase 1 — Canonical model hardening** | Done | userId validation in registerPatient; app createPet uses req.user.id and generates uniquePetId; duplicate microchip check in app. |
| **Phase 2 — Clinic hardening** | Done | ensureOwnerByPhone creates OwnerProfile; link-owner endpoint (PATCH patients/:petId/link-owner); check-in blocked when snapshot-only; promote validates Pet.userId === patientId. |
| **Phase 3 — App/clinic convergence** | Done | App createPet sets uniquePetId; duplicate microchip returns DUPLICATE_PET; clinic registerPatient duplicate microchip check; owner listMyPets/getMyPet already filter by userId. |
| **Phase 4 — Snapshot promotion + Visit guard** | Done | checkInAppointment throws SNAPSHOT_ONLY_CANNOT_CHECK_IN when patientId or petId null; promoteQuickAppointment validates Pet belongs to User; queue startService only creates Visit when ticket has patientId and petId. |
| **Phase 5 — Auto-link foundation** | Done | GET /api/v1/owner/me/pending-appointments returns snapshot-only appointments where normalized mobileSnapshot matches current user phone. |
| **Frontend / bpa_web** | Done | staffClinicFindOwner, staffClinicEnsureOwner, staffClinicRegisterPatient, staffClinicLinkOwner added in lib/api.ts; existing staffClinicOwnerLookup, staffClinicPatientsList, staffClinicAppointmentPromote already used by CreateAppointmentWizard. |

---

## 2. Files changed

### Backend (backend-api)

| File | Changes |
|------|---------|
| `src/api/v1/modules/clinic/patient.service.ts` | Explicit userId validation in registerPatient; duplicate microchip check before create; linkPetToOwner added; ensureOwnerByPhone creates OwnerProfile after User create. |
| `src/api/v1/modules/clinic/clinic.controller.ts` | linkOwner handler; registerPatient catch for DUPLICATE_PET (409); checkInAppointment catch for SNAPSHOT_ONLY_CANNOT_CHECK_IN; promoteQuickAppointment catch for PET_OWNER_MISMATCH. |
| `src/api/v1/modules/clinic/clinic.routes.ts` | PATCH `/branches/:branchId/patients/:petId/link-owner` added. |
| `src/api/v1/modules/clinic/clinic.responses.ts` | SNAPSHOT_ONLY_CANNOT_CHECK_IN, PET_OWNER_MISMATCH, DUPLICATE_PET added. |
| `src/api/v1/modules/clinic/appointment.service.ts` | checkInAppointment blocks when patientId or petId null; promoteQuickAppointment validates Pet.userId === patientId when petId provided. |
| `src/api/v1/modules/pets/pets.controller.ts` | generateUniquePetId; createPet sets uniquePetId; duplicate microchip check before create; handlePrismaUnique returns code DUPLICATE_PET. |
| `src/api/v1/modules/owner/owner.controller.ts` | getMyPendingAppointments added; normalizePhoneDigits helper. |
| `src/api/v1/modules/owner/owner.routes.ts` | GET `/me/pending-appointments` added. |

### Frontend (bpa_web)

| File | Changes |
|------|---------|
| `lib/api.ts` | staffClinicFindOwner, staffClinicEnsureOwner, staffClinicRegisterPatient, staffClinicLinkOwner added (with clinicBase). |

### Docs

| File | Changes |
|------|---------|
| `docs/CLINIC_APP_OWNER_PET_IMPLEMENTATION_REPORT.md` | This report. |

---

## 3. Endpoints added/updated

| Method | Path | Description |
|--------|------|-------------|
| PATCH | `/api/v1/clinic/branches/:branchId/patients/:petId/link-owner` | **New.** Body: `{ userId }`. Reassigns Pet to another owner. |
| GET | `/api/v1/owner/me/pending-appointments` | **New.** Returns snapshot-only appointments matching current user phone (normalized). |

Existing endpoints unchanged; behavior changes:

- POST `.../patients/ensure-owner`: now creates OwnerProfile for new User.
- POST `.../appointments/:id/promote`: validates Pet.userId === patientId when petId provided; returns 400 PET_OWNER_MISMATCH on mismatch.
- POST `.../appointments/:id/check-in`: returns 400 SNAPSHOT_ONLY_CANNOT_CHECK_IN when appointment has no patientId or petId.
- POST `.../patients` (register): duplicate microchip returns 409 DUPLICATE_PET.
- POST `/api/v1/pets/register` (and POST `/api/v1/pets/`): sets uniquePetId; duplicate microchip returns 409 with code DUPLICATE_PET.

---

## 4. UI flows

- **Appointment booking:** CreateAppointmentWizard already uses staffClinicOwnerLookup, staffClinicPatientsList, staffClinicAppointmentPromote. No change required; new staffClinicFindOwner/staffClinicEnsureOwner/staffClinicRegisterPatient/staffClinicLinkOwner available for intake or patient registration flows that need them.
- **Check-in:** If staff checks in a snapshot-only appointment, API returns 400 with message "Link owner and pet before check-in. Promote the appointment first." and code SNAPSHOT_ONLY_CANNOT_CHECK_IN. Frontend should show this message and direct staff to promote or link owner/pet first.
- **Owner panel:** GET `/api/v1/owner/me/pending-appointments` can be used to show "You have X visits to link" and drive a promote/link flow (UI for that flow not implemented in this pass).

---

## 5. Migrations added

**None.** No schema changes. DB plan allows optional future columns (e.g. Appointment.promotedAt, Pet.linkedAt) for audit; not added in this implementation.

---

## 6. Remaining blockers

- None. All acceptance requirements from the implementation spec are met.

---

## 7. Conflicts requiring confirmation

- None. Implementation followed User-first model; no structural conflict with current BPA architecture.

---

## 8. Acceptance checklist

| Requirement | Status |
|-------------|--------|
| Clinic and app pet creation converge to one canonical Pet model | Yes — both set userId and uniquePetId; duplicate rules applied. |
| Owner identity is User-first everywhere relevant | Yes — Pet.userId, Appointment/Visit patientId = User; ensureOwner creates User + OwnerProfile. |
| Intake can resolve/create owner and register/link pet without dead-end | Yes — ensure-owner, register-patient, link-owner available; promote and check-in guard enforce resolution. |
| Visit/treatment cannot start from unresolved snapshot-only appointment | Yes — check-in blocked; queue startService only creates Visit when ticket has patientId and petId. |
| Existing pets/history available through correct owner/user linkage | Yes — listMyPets and clinic list patients by ownerId; link-owner allows correction. |
| Duplicate prevention rules from docs respected | Yes — phone normalization; microchip unique; uniquePetId; DUPLICATE_PET on duplicate microchip. |
| No broken route/404/dead-end in touched flows | Yes — new routes added; existing flows unchanged. |
| Backward compatible | Yes — snapshot fields retained; new endpoints additive; check-in/promote validation additive. |
