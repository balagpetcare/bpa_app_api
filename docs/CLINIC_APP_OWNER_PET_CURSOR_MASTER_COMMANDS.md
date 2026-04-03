# BPA Clinic + App Owner/Pet Identity — Cursor AI Master Implementation Commands

**Purpose:** Copy-paste prompts for Cursor AI to execute implementation phases. Each block is self-contained; confirm touch points from the Implementation Spec before running.

**References:** [CLINIC_APP_OWNER_PET_IDENTITY_STRATEGY.md](./CLINIC_APP_OWNER_PET_IDENTITY_STRATEGY.md), [CLINIC_APP_OWNER_PET_IMPLEMENTATION_SPEC.md](./CLINIC_APP_OWNER_PET_IMPLEMENTATION_SPEC.md), [CLINIC_APP_OWNER_PET_API_CONTRACTS.md](./CLINIC_APP_OWNER_PET_API_CONTRACTS.md), [CLINIC_APP_OWNER_PET_DB_PLAN.md](./CLINIC_APP_OWNER_PET_DB_PLAN.md).

---

## Pre-flight (run first)

Read the following docs and confirm touch points before making any code changes:

- docs/CLINIC_APP_OWNER_PET_IDENTITY_STRATEGY.md
- docs/CLINIC_APP_OWNER_PET_IMPLEMENTATION_SPEC.md
- docs/CLINIC_APP_OWNER_PET_API_CONTRACTS.md
- docs/CLINIC_APP_OWNER_PET_DB_PLAN.md

List the files you will modify (patient.service.ts, pets.controller.ts, clinic.controller.ts, clinic.routes.ts, etc.) and do not delete existing code; merge only. Follow BPA_STANDARD.md.

---

## Command 1 — Phase 1: Canonical model enforcement

Implement Phase 1 of CLINIC_APP_OWNER_PET_IMPLEMENTATION_SPEC: enforce canonical model; ensure Pet.userId is always set; add explicit validation in registerPatient (userId required, return 400 if missing) and in pets.createPet (use req.user.id as userId, reject if not authenticated). Touch points: src/api/v1/modules/clinic/patient.service.ts, src/api/v1/modules/pets/pets.controller.ts. Do not delete existing code; merge only.

---

## Command 2 — Phase 2: Clinic flow hardening

Implement Phase 2 of CLINIC_APP_OWNER_PET_IMPLEMENTATION_SPEC: (1) In ensureOwnerByPhone, after creating a new User, create OwnerProfile (userId, name from displayName) if not already present; (2) Add PATCH /api/v1/clinic/branches/:branchId/patients/:petId/link-owner with body { userId }, implementing linkPetToOwner in patient.service (update Pet.userId, validate User exists), and wire in clinic.controller and clinic.routes with permission clinic.patients.manage; (3) Ensure promote endpoint validates and sets patientId and petId. Touch points: patient.service.ts, clinic.controller.ts, clinic.routes.ts. Do not delete existing code; merge only.

---

## Command 3 — Phase 3: App alignment

Implement Phase 3 of CLINIC_APP_OWNER_PET_IMPLEMENTATION_SPEC: Ensure POST /pets/register and POST /pets use req.user.id as Pet.userId. Add duplicate check: if microchipNumber is provided and already exists for another Pet, return 409 or 400 with code DUPLICATE_PET. Optionally add soft check for same userId + name + animalTypeId and warn or block. Touch points: src/api/v1/modules/pets/pets.controller.ts (and pets.service if it exists). Do not delete existing code; merge only.

---

## Command 4 — Phase 4: Snapshot promotion workflow

Implement Phase 4 of CLINIC_APP_OWNER_PET_IMPLEMENTATION_SPEC: Ensure POST .../appointments/:appointmentId/promote accepts patientId and petId, validates appointment and branch, validates User and Pet exist and Pet.userId equals patientId, and updates appointment. Ensure Visit creation (check-in or queue flow) does not create a Visit when appointment is still snapshot-only (patientId or petId null); require promotion or linked appointment first. Touch points: clinic.controller.ts, appointment.service.ts (or equivalent). Do not delete existing code; merge only.

---

## Command 5 — Phase 5 (optional): Auto-link policy stub

Implement Phase 5 (optional) of CLINIC_APP_OWNER_PET_IMPLEMENTATION_SPEC: Add an optional way for owner to see snapshot-only appointments matching their phone—e.g. GET /api/v1/owner/me/pending-appointments or include in login/me response pendingSnapshotAppointments where mobileSnapshot (normalized) matches current User phone. No automatic merge; frontend can show "Link your visits" and call promote with user-selected pet. Touch points: authUnified.service or new ownerLink.service, owner.controller or clinic.controller. Do not delete existing code; merge only.

---

## Command 6 — Frontend API wrappers (bpa_web)

Add API wrappers in bpa_web lib/api.ts for: staffClinicFindOwner (GET owner-lookup), staffClinicEnsureOwner (POST ensure-owner), staffClinicRegisterPatient (POST patients), staffClinicLinkOwner (PATCH patients/:petId/link-owner). Follow existing staffClinic* pattern in the same file. Do not remove existing functions; add new ones.

---

## Usage

1. Run Pre-flight and confirm touch points.
2. Run Command 1, then test (Phase 1).
3. Run Command 2, then test (Phase 2).
4. Continue in order through Command 6 as needed.
5. Phase 5 (Command 5) is optional; skip if auto-link is not in scope.
