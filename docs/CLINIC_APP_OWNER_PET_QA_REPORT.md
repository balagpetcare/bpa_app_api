# BPA Clinic + App Owner/Pet — Frontend Wiring & QA Report

**Date:** 2026-03-14  
**Reference:** CLINIC_APP_OWNER_PET_IMPLEMENTATION_REPORT.md (backend behavior and endpoints).

This report covers frontend wiring completed after the owner/pet implementation so that backend behavior is usable end-to-end.

---

## 1. Scenarios audited and status

| Scenario | Status | Notes |
|----------|--------|------|
| **Appointment snapshot-only booking** | ✓ | CreateAppointmentWizard supports booking without owner/pet; promote flow links them. |
| **Intake completion when owner is missing** | ✓ | Intake page shows banner when `patientId`/`petId` missing; link goes to appointments?promote=id and opens Complete intake modal. |
| **Ensure owner by phone** | ✓ | CompleteIntakeModal uses staffClinicEnsureOwner; owner created then patients listed. |
| **Register patient (pet)** | ✓ | CompleteIntakeModal registers pet via staffClinicPatientRegister; DUPLICATE_PET (409) surfaced with clear message. |
| **Link pet to owner** | ✓ | Backend PATCH link-owner; staff can use Complete intake (owner + pet selection) and promote. |
| **Promote appointment** | ✓ | CompleteIntakeModal calls staffClinicAppointmentPromote; PET_OWNER_MISMATCH shown with hint to pick correct pet. |
| **Blocked check-in for unresolved snapshot-only** | ✓ | Check-in button disabled when `!a.patientId \|\| !a.petId`; if API returns 400, message + hint shown; "Link first" badge when snapshot-only. |
| **Doctor treatment start guard** | ✓ | Backend creates visit only when ticket has patientId/petId; doctor panel already shows friendly message on invalid transition. |
| **App-side pet creation** | ✓ | Owner My Pets + Add pet (POST /api/v1/user/pets/register); DUPLICATE_PET (409) shown with clear message; canonical Pet model, same as clinic. |
| **Owner pending-appointments claim flow** | ✓ | GET /api/v1/owner/me/pending-appointments wired; owner dashboard shows "You have X visits to link" when count > 0; full claim/promote done via staff. |

---

## 2. Frontend files changed (this pass)

### bpa_web

| File | Changes |
|------|---------|
| `app/staff/(larkon)/branch/[branchId]/clinic/appointments/page.jsx` | Check-in: SNAPSHOT_ONLY hint in error; Check-in disabled when `!patientId \|\| !petId`; "Complete intake" shown for snapshot-only BOOKED/CONFIRMED; "Link first" badge; `?promote=` support (useSearchParams, usePathname) to auto-open CompleteIntakeModal; promote error PET_OWNER_MISMATCH hint; register-pet error DUPLICATE_PET message. |
| `app/staff/(larkon)/branch/[branchId]/clinic/intake/[appointmentId]/page.jsx` | Banner when `!appointment.patientId \|\| !appointment.petId` with link to `/staff/branch/{branchId}/clinic/appointments?promote={appointmentId}`. |
| `app/owner/(larkon)/dashboard/page.jsx` | ownerMyPendingAppointments(); pending-appointments alert; My Pets card + Clinic card. |
| `app/owner/_lib/ownerApi.ts` | ownerMyPendingAppointments(); ownerRegisterPet() for POST /api/v1/user/pets/register with DUPLICATE_PET error code. |
| `app/owner/(larkon)/pets/page.tsx` | **New.** My Pets list (ownerMyPets); Add pet link. |
| `app/owner/(larkon)/pets/new/page.tsx` | **New.** Add pet form; getAnimalTypes/getBreedsByAnimalType; DUPLICATE_PET (409) message. |
| `app/owner/(larkon)/pets/[id]/page.tsx` | **New.** Pet detail (ownerMyPetGet). |
| `app/clinic/(larkon)/appointments/page.jsx` | Check-in catch: same SNAPSHOT_ONLY hint as staff appointments. |

### backend-api (docs only)

| File | Changes |
|------|---------|
| `docs/CLINIC_APP_OWNER_PET_QA_REPORT.md` | This QA report. |

---

## 3. Backend endpoints used (unchanged)

- POST `.../appointments/:id/check-in` — 400 SNAPSHOT_ONLY_CANNOT_CHECK_IN when patientId/petId null.
- POST `.../appointments/:id/promote` — 400 PET_OWNER_MISMATCH when pet not owned by selected user.
- POST `.../patients` (register) — 409 DUPLICATE_PET on duplicate microchip.
- POST `.../patients/ensure-owner` — create owner by phone.
- GET `/api/v1/owner/me/pending-appointments` — snapshot-only appointments matching user phone.
- POST `/api/v1/user/pets/register` — owner self-service pet registration; 409 DUPLICATE_PET on duplicate microchip.
- GET `/api/v1/owner/me/pets` — list current user's pets; GET `/api/v1/owner/me/pets/:petId` — pet detail.

---

## 4. Owner self-service pet registration (added)

- **My Pets** (`/owner/pets`): Lists pets for current user via GET /api/v1/owner/me/pets; "Add pet" → `/owner/pets/new`.
- **Add pet** (`/owner/pets/new`): Form (name, species, breed, sex, date of birth, microchip, notes); submits to POST /api/v1/user/pets/register (canonical Pet model). On 409, shows: "This microchip number is already registered. Use a different number or leave microchip blank."
- **Pet detail** (`/owner/pets/[id]`): Read-only view via GET /api/v1/owner/me/pets/:petId.
- **Dashboard:** "My Pets" card added next to Clinic; links to `/owner/pets`.
- **API:** `ownerRegisterPet()` in ownerApi.ts; throws with `err.code === 'DUPLICATE_PET'` on 409 for UI handling.

---

## 5. Unresolved blockers

- **None.** Owner self-service pet registration is implemented; DUPLICATE_PET handling and canonical model alignment are in place.

---

## 6. Pages/routes tested (manual QA checklist)

| Page / route | Purpose |
|---------------|---------|
| `/staff/branch/{branchId}/clinic/appointments` | List appointments; Check-in disabled for snapshot-only; "Complete intake" + "Link first" for unresolved; error hint on failed check-in; ?promote= opens Complete intake modal. |
| `/staff/branch/{branchId}/clinic/appointments?promote={id}` | Opens Complete intake modal for appointment `id` (e.g. from intake page). |
| `/staff/branch/{branchId}/clinic/intake/[appointmentId]` | Intake form; banner + "Link owner & pet" when appointment snapshot-only; link to appointments?promote=id. |
| Complete intake modal (from appointments) | Step 1: find/create owner by phone; Step 2: select or register pet; Promote; PET_OWNER_MISMATCH and DUPLICATE_PET messages. |
| `/owner` dashboard | Pending-appointments count loaded; info alert "You have X visits to link" when > 0. |
| `/doctor/appointments/[id]` | Start treatment; friendly message if transition invalid (check-in/queue first). |
| `/clinic?branchId=...` appointments | Check-in error shows SNAPSHOT_ONLY hint. |
| `/owner/pets` | My Pets list; Add pet button; empty state. |
| `/owner/pets/new` | Add pet form; species/breed from common APIs; 409 → DUPLICATE_PET message. |
| `/owner/pets/[id]` | Pet detail (read-only). |
| `/owner` dashboard | My Pets card + pending-appointments alert. |

---

## 7. Summary

- **Check-in:** Snapshot-only appointments cannot be checked in; UI disables the button and shows a clear error + hint; staff use "Complete intake" to link owner & pet first.
- **Intake:** If owner/pet missing, staff see a banner and a direct link to open the promote (Complete intake) flow for that appointment.
- **Promote / register:** PET_OWNER_MISMATCH and DUPLICATE_PET are surfaced with clear, actionable messages.
- **Owner panel:** Pending-appointments API is wired and the dashboard shows when the user has visits to link (claim flow done via staff).
- **Owner My Pets:** Self-service pet registration uses POST /api/v1/user/pets/register (canonical Pet model); DUPLICATE_PET (409) handled with clear message; pet list and detail use owner/me/pets.
- Backend behavior from CLINIC_APP_OWNER_PET_IMPLEMENTATION_REPORT.md is used as-is; no frontend/backend architectural conflicts.

---

## 8. Rollout-ready QA/UAT report

### Tested scenarios (pass criteria)

| # | Scenario | How to test | Expected |
|---|----------|-------------|----------|
| 1 | Snapshot-only booking | Staff: create appointment without owner/pet (e.g. phone). | Appointment created; Check-in disabled until promote. |
| 2 | Intake when owner missing | Staff: open intake for snapshot-only appointment. | Banner + "Link owner & pet" → appointments?promote=id. |
| 3 | Ensure owner by phone | In Complete intake modal: enter phone, "Create owner". | Owner created; pets list loaded. |
| 4 | Register pet (staff) | In Complete intake: register new pet with microchip. | Pet created; if duplicate microchip → DUPLICATE_PET message. |
| 5 | Promote appointment | Complete intake: select owner + pet, Promote. | Appointment promoted; if wrong pet → PET_OWNER_MISMATCH message. |
| 6 | Blocked check-in | Staff: try Check-in on snapshot-only row. | Button disabled or 400 with hint to use Complete intake. |
| 7 | Doctor start treatment | Doctor: start consult before check-in. | Friendly message to complete check-in/queue first. |
| 8 | Owner My Pets list | Owner: open /owner/pets. | List of pets or empty state; "Add pet" works. |
| 9 | Owner Add pet | Owner: /owner/pets/new, submit with microchip. | Pet created and redirect to list; duplicate microchip → 409 message. |
| 10 | Owner pending-appointments | Owner (phone matches snapshot): open dashboard. | "You have X visits to link" when count > 0. |

### All files changed (cumulative)

**bpa_web**

- `app/owner/_lib/ownerApi.ts` — ownerRegisterPet(), ownerMyPendingAppointments(), ownerMyPets/ownerMyPetGet (existing).
- `app/owner/(larkon)/dashboard/page.jsx` — My Pets card; pending-appointments alert.
- `app/owner/(larkon)/pets/page.tsx` — **New.** My Pets list.
- `app/owner/(larkon)/pets/new/page.tsx` — **New.** Add pet form (DUPLICATE_PET handling).
- `app/owner/(larkon)/pets/[id]/page.tsx` — **New.** Pet detail.
- `app/staff/(larkon)/branch/[branchId]/clinic/appointments/page.jsx` — Check-in/promote/register wiring.
- `app/staff/(larkon)/branch/[branchId]/clinic/intake/[appointmentId]/page.jsx` — Snapshot-only banner.
- `app/clinic/(larkon)/appointments/page.jsx` — Check-in error hint.

**backend-api**

- `docs/CLINIC_APP_OWNER_PET_QA_REPORT.md` — This report (updated).
- `docs/CLINIC_APP_OWNER_PET_IMPLEMENTATION_REPORT.md` — Source of truth (unchanged).

### Remaining polish items (non-blocking)

- **Owner edit pet:** No edit form for owner-update of pet (e.g. notes, weight); backend has PUT/PATCH /api/v1/user/pets/:id; can be added later.
- **Owner claim flow in-app:** Pending-appointments only inform; actual promote still done at staff panel; optional: owner could select pet and call promote if an owner-scoped promote API is added.
- **Clinic list patientId/petId:** List already returns these via include; no change needed.
