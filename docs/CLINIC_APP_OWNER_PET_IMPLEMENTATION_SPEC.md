# BPA Clinic + App Owner/Pet Identity — Implementation Spec

**Purpose:** Step-by-step implementation guide for the unified owner/pet identity system. Follow BPA_STANDARD.md (no deletion of working code, merge only).

**References:** [CLINIC_APP_OWNER_PET_IDENTITY_STRATEGY.md](./CLINIC_APP_OWNER_PET_IDENTITY_STRATEGY.md) (master), [CLINIC_APP_OWNER_PET_API_CONTRACTS.md](./CLINIC_APP_OWNER_PET_API_CONTRACTS.md), [CLINIC_APP_OWNER_PET_DB_PLAN.md](./CLINIC_APP_OWNER_PET_DB_PLAN.md).

---

## 1. Implementation Principles

- **User-first:** User = owner identity; no new Owner entity. Enforce Pet.userId and Appointment/Visit patientId = User.
- **Convergence:** Clinic and app pet creation both produce Pet with userId; duplicate prevention applied in both paths.
- **Intake as reconciliation:** Snapshot-only appointments resolved or promoted at intake; Visit requires linked patientId and petId.
- **Backward compatible:** Snapshot fields retained; new endpoints additive; no breaking changes to existing APIs.

---

## 2. Module Responsibilities

| Module | Responsibility | Touch points |
|--------|----------------|--------------|
| **patient.service** | Clinic owner lookup, ensure-owner, register-patient, update-patient, link-owner (when added), list/get patients | clinic.controller.ts, clinic.routes.ts |
| **pets.controller** | App pet creation (POST /register, POST /); userId = req.user.id; duplicate check | pets.routes.ts |
| **owner.controller** | App owner's pets (GET /me/pets, GET /me/pets/:petId) | owner.routes.ts |
| **clinic.controller** | Appointments CRUD, promote (snapshot → linked); intake orchestration | appointment.service, patient.service |
| **CreateAppointmentWizard** (bpa_web) | Owner search, pet select, snapshot vs linked flow; call owner-lookup, ensure-owner, patients | staff clinic appointments page |

---

## 3. Phase 1 — Canonical Model Enforcement

**Goal:** Ensure Pet.userId is always set; validate in both clinic and app registration paths.

**Backend:**

- **patient.service.registerPatient:** Already requires userId. Confirm no code path creates Pet without userId. Add explicit validation (userId required) and return 400 if missing.
- **pets.controller.createPet:** Ensure req.user.id is used as userId when creating Pet. Reject if not authenticated. Add validation that userId is set from session.
- **Schema:** Pet.userId is already NOT NULL; no migration. Document in DB plan.

**Acceptance criteria:**

- [ ] registerPatient rejects request without userId.
- [ ] POST /pets/register and POST /pets use req.user.id as Pet.userId.
- [ ] No Pet created without a valid userId.

**Touch points:** `src/api/v1/modules/clinic/patient.service.ts`, `src/api/v1/modules/pets/pets.controller.ts`.

---

## 4. Phase 2 — Clinic Flow Hardening

**Goal:** ensureOwner creates OwnerProfile when needed; add link-owner endpoint; promote validation.

**Backend:**

- **ensureOwnerByPhone:** After creating User (UserAuth + UserProfile), optionally create **OwnerProfile** (userId, name from displayName) so owner panel has a consistent profile. Merge with existing; do not duplicate.
- **link-owner:** Add `PATCH /api/v1/clinic/branches/:branchId/patients/:petId/link-owner` with body `{ userId }`. patient.service: add linkPetToOwner(petId, userId) — update Pet.userId; validate User exists; permission clinic.patients.manage.
- **Promote:** Ensure existing promote (if any) or add POST appointments/:id/promote with patientId, petId. Validate appointment is snapshot-only or allow overwrite per policy; set patientId and petId; optional promotedAt (if column added later).

**Acceptance criteria:**

- [ ] ensureOwnerByPhone creates OwnerProfile for new User when created.
- [ ] link-owner endpoint updates Pet.userId; returns 400 if User not found or pet not found.
- [ ] Promote sets appointment patientId and petId; Visit creation can proceed when linked.

**Touch points:** `patient.service.ts`, `clinic.controller.ts`, `clinic.routes.ts`.

---

## 5. Phase 3 — App Alignment

**Goal:** App pet creation uses req.user.id; duplicate check (microchip, name+owner+animalType).

**Backend:**

- **pets.controller:** Confirm createPet uses req.user.id. Add duplicate check: if microchipNumber provided and already exists, return 409 or 400 with DUPLICATE_PET. Optional: soft check for same userId + name + animalTypeId — warn or block (configurable).
- **owner.controller listMyPets / getMyPet:** Ensure only pets where Pet.userId = req.user.id are returned (already expected).

**Acceptance criteria:**

- [ ] POST /pets/register sets userId = req.user.id.
- [ ] Duplicate microchip returns clear error.
- [ ] GET /owner/me/pets returns only current user's pets.

**Touch points:** `pets.controller.ts`, `pets.service` (if exists), `owner.controller.ts`.

---

## 6. Phase 4 — Snapshot Promotion Workflow

**Goal:** Intake as reconciliation point; promote before Visit creation.

**Backend:**

- **Promote API:** POST /api/v1/clinic/branches/:branchId/appointments/:appointmentId/promote with body `{ patientId, petId }`. Validate appointment exists and belongs to branch; validate User and Pet exist and Pet.userId = patientId; set appointment.patientId and appointment.petId. Permission: clinic.appointments.manage or clinic.patients.manage.
- **Visit creation:** Existing flow already requires petId and patientId when creating Visit from appointment. Ensure check-in or queue flow does not create Visit when appointment is still snapshot-only; require promotion or linked appointment first.

**Frontend:**

- Intake or appointment detail: when appointment has only snapshots, show "Link owner & pet" or "Promote" action; call owner-lookup → ensure-owner → select/create pet → call promote.

**Acceptance criteria:**

- [ ] Promote endpoint updates appointment; returns 200.
- [ ] Visit is not created for snapshot-only appointment without promote/link.
- [ ] Staff can promote from intake or appointment detail.

**Touch points:** `clinic.controller.ts`, `clinic.routes.ts`, `appointment.service.ts`; bpa_web intake/appointment UI.

---

## 7. Phase 5 — Auto-Link Policy Stub (Optional)

**Goal:** When User logs in with phone matching Appointment.mobileSnapshot, suggest linking (promotion).

**Backend:**

- **Optional:** New endpoint GET /api/v1/owner/me/pending-appointments or extend login/me response with `pendingSnapshotAppointments: []` where mobileSnapshot (normalized) matches current User's phone. Or add ownerLink.service: findAppointmentsByPhone(phone) for owner panel.
- **authUnified or owner:** No automatic merge; return list of snapshot-only appointments that match phone so frontend can show "You have X visits to link" and call promote with user's choice of pet.

**Frontend:**

- Owner panel: after login, if pendingSnapshotAppointments length > 0, show banner or list "Link your visits" → select appointment, select pet → call promote (owner-scoped promote or clinic promote with branch context). Permission may require clinic or owner endpoint for promote.

**Acceptance criteria:**

- [ ] Optional: Owner can see snapshot appointments matching their phone.
- [ ] Optional: Owner can promote (link) with their User and selected Pet.

**Touch points:** authUnified.service or new ownerLink.service; owner.controller or clinic.controller; bpa_web owner panel.

---

## 8. Edge Cases

| Case | Handling |
|------|----------|
| Snapshot-only appointment at check-in | Block Visit creation; require promote or link owner/pet first. |
| Duplicate owner creation | ensureOwnerByPhone normalizes phone and finds existing User first; P2002 catch returns existing. |
| Phone format variants | normalizePhoneDigits; support 0-prefix, 88, 880 for BD. |
| Pet already linked to another User | link-owner allows reassignment; audit or permission only for staff. |
| Microchip duplicate across owners | Reject create/update; return DUPLICATE_PET. |

---

## 9. QA Checklist (per phase)

- [ ] Phase 1: Create pet from clinic with userId; create pet from app; verify both have userId. Attempt create without userId (clinic) fails.
- [ ] Phase 2: ensure-owner creates User + OwnerProfile; link-owner changes pet's owner; promote sets appointment patientId/petId.
- [ ] Phase 3: App register pet; duplicate microchip rejected; list my pets only.
- [ ] Phase 4: Snapshot appointment → promote → check-in → Visit created. Snapshot without promote cannot create Visit.
- [ ] Phase 5: (Optional) Login with phone matching snapshot → see pending; promote from owner panel.

---

## 10. Reference to Other Docs

- **API contracts:** [CLINIC_APP_OWNER_PET_API_CONTRACTS.md](./CLINIC_APP_OWNER_PET_API_CONTRACTS.md)
- **DB plan:** [CLINIC_APP_OWNER_PET_DB_PLAN.md](./CLINIC_APP_OWNER_PET_DB_PLAN.md)
- **Master strategy:** [CLINIC_APP_OWNER_PET_IDENTITY_STRATEGY.md](./CLINIC_APP_OWNER_PET_IDENTITY_STRATEGY.md)
