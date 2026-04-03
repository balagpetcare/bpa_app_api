# Clinic patient registration visibility — BUILD execution blueprint

**Companion:** [CLINIC_PATIENT_REGISTRATION_VISIBILITY_AUDIT_AND_PLAN.md](./CLINIC_PATIENT_REGISTRATION_VISIBILITY_AUDIT_AND_PLAN.md)

Use this as a Composer **Build** checklist. Order matters for diagnosis before code changes.

---

## A. Inspect before changing

1. **Database (target env the API uses)**  
   - Confirm column exists:  
     `SELECT column_name FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'clinicRegisteredBranchId';`  
   - If **missing**: run migrations (`npx prisma migrate deploy` or project-standard command) — **this is the first fix**.

2. **Network trace (browser DevTools)**  
   - Register one pet from `/staff/branch/{B}/clinic/patient-register`.  
   - **POST** `/api/v1/clinic/branches/{B}/patients`  
     - Status must be **201**.  
     - Body: `success === true`, `data.id` numeric, `data.clinicRegisteredBranchId` should equal **B** (or null only if bug/migration).  
   - **GET** `/api/v1/clinic/branches/{B}/patients?limit=25` — response `data.patients` should contain `data.id`.  
   - **GET** `/api/v1/clinic/branches/{B}/patients/{id}/clinical-overview` — must be **200** for that `id`.

3. **Read-only code confirmation**  
   - [patient.service.ts](../src/api/v1/modules/clinic/patient.service.ts) `registerPatient` — `clinicRegisteredBranchId: branchId` inside `prisma.pet.create`.  
   - `collectBranchScopedPetIds` / `isPetInBranchScope` — include `clinicRegisteredBranchId`.

4. **Rule out wrong id**  
   - Compare URL `/patients/3` with **`data.id`** from POST. If they differ, **no code bug** — user opened wrong record.

---

## B. Files to create

- **None required** for minimal fix (ops migration + frontend guards/copy).  
- **Optional:** `backend-api/scripts/verify-pet-clinic-registration-column.ts` (one-off Prisma raw query) — only if team wants automated check.

---

## C. Files to update

### C1. Frontend — registration success guard (required)

**File:** `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/patients/register/page.jsx`

- In `.then((patient) => { ... })` after `staffClinicPatientRegister`:  
  - If `returnToFromQuery` is set, keep current redirect behavior **only if** `patient?.id` exists (or document exception).  
  - If **no** `returnToFromQuery` and **`!patient?.id`**:  
    - `setFormError("Registration succeeded but the server did not return a patient id. Check the Network tab for POST .../patients or contact support.")`  
    - `setSubmitting(false)`  
    - **Do not** `router.push` to list as if success.  
- **Optional:** `toast.success` with `Registered patient #${patient.id}` when id present.

### C2. Frontend — detail empty-state copy (required)

**File:** `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/patients/[patientId]/page.jsx`

- In the card where `error || !overview?.patient` is shown:  
  - **Replace** single migration-centric paragraph with **two bullets**:  
    1. “This pet is not linked to **this branch** (no registration here, no appointment, no visit). Open the patient from the **Patients** list or register the pet at this branch.”  
    2. “If registration **just** succeeded, confirm the URL uses the **pet id** returned after save, and that the database migration adding **`clinicRegisteredBranchId`** has been applied on the API database.”  
  - Keep **Retry** + **Back to list** actions.

### C3. Backend — optional API clarity (nice-to-have)

**Files:** `backend-api/src/api/v1/modules/clinic/patient.service.ts` and/or `clinic.controller.ts`

- Option A (minimal): No change — scope stays boolean.  
- Option B: In `getPatientClinicalOverview`, if pet exists globally but `!isPetInBranchScope`, return **404** with message **“Pet not linked to this branch”** instead of generic “Patient not found” (requires controller to pass message through).  
- Option C: Add `meta: { reason: 'NOT_IN_BRANCH_SCOPE' }` in JSON — update `sendClinicError` usage only if frontend will read it.

**Recommendation for Build:** Do **C1 + C2** first; add **C3 Option B** only if product wants API-level distinction.

---

## D. Registration flow bugs to fix

- **False success navigation** when `data` has no `id` (client).  
- **Misleading** migration-only messaging when failure is **branch scope** (UI).

---

## E. Redirect / id mapping bugs to fix

- Ensure redirect uses **`patient.id` from response** only (already `staffClinicPatientDetailPath(branchId, patient.id)`).  
- No change to param name: route `[patientId]` = `Pet.id`.

---

## F. Patient lookup / query bugs to fix

- **No change** to `isPetInBranchScope` / `collectBranchScopedPetIds` if migration applied and `registerPatient` sets `clinicRegisteredBranchId`.  
- If column missing, **fix DB** — not the query logic.

---

## G. Branch visibility logic to fix

- **None** in code path when DB matches schema — visibility rules are already correct.  
- Verify **middleware** `req.clinicBranchId` matches URL `:branchId` (already does).

---

## H. Migration / schema assumptions to verify

- Migration: `prisma/migrations/20260331120000_pet_clinic_registered_branch/migration.sql`.  
- Prisma: `Pet.clinicRegisteredBranchId` optional `Int?` FK to `Branch`.  
- After deploy: `prisma migrate deploy` on **production** DB that the running API uses.

---

## I. Validations after implementation

1. Fresh register → POST body contains `data.id` and `data.clinicRegisteredBranchId ===` branch id.  
2. Patients list (no filters) shows new row at top (by `updatedAt`).  
3. Detail/overview loads for that id.  
4. Manually open `/patients/{oldId}` for pet never at branch → message explains **branch link**, not only migration.  
5. Simulate missing `data` in client (mock) → form shows error, no false navigation.

---

## Execution order (short)

1. DB column verification → migrate if needed → restart API.  
2. Re-test Network flow (A2).  
3. Implement **C1**, **C2**.  
4. Optionally **C3**.  
5. Run **I**.

---

## J. Implementation status (2026-03-21)

| Item | Status | Notes |
|------|--------|--------|
| **A1** DB column `pets.clinicRegisteredBranchId` | **Completed** (dev env) | `npx prisma migrate status` → schema up to date on local `bpa_pet_db`. **Production/staging:** operators must run `prisma migrate deploy` on the DB the API uses and restart the API if column was missing. |
| **A2** Network trace (register → list → overview) | **Deferred** | Not run in this session (no authenticated browser E2E). Follow checklist **I** manually after deploy. |
| **C1** Registration success guard | **Completed** | `bpa_web/.../patients/register/page.jsx`: no redirect without `patient.id`; actionable error; `returnTo` only proceeds with valid id; `setSubmitting(false)` on guarded paths. |
| **C2** Detail empty-state copy | **Completed** | `bpa_web/.../patients/[patientId]/page.jsx`: two bullets (branch scope vs wrong id / migration); API error message shown in catch when present. |
| **C3** Backend 404 clarity | **Completed** | `resolvePatientClinicalOverview` + controller: **404** `"Patient not found"` vs **404** `"Pet not linked to this branch"` with `PATIENT_NOT_IN_BRANCH`. |
| **Clinical overview route 404** | **Completed** | **Root cause:** stale `dist/` under `npm start` omitted the route. **Fix:** **sole** registration on **`src/api/v1/routes.ts`** (not duplicated in `clinic.routes.ts`). Ops: [DEV_API_RUN_AND_DIST.md](./DEV_API_RUN_AND_DIST.md). |
| **B** Optional verify script | **Deferred** | No `verify-pet-clinic-registration-column.ts` added (low priority). |

---

## K. Final hardening + validation (2026-03-21)

| Item | Status | Notes |
|------|--------|--------|
| **Phase 1 E2E** (register → list → detail 200) | **Partially completed** | **Code + routing verified** in repo; **authenticated browser QA deferred** to operators. Unauthenticated probe: `GET .../clinical-overview` → **401** (route mounted), not global `Route not found`. |
| **Phase 2 stale-dist guardrails** | **Completed** | [DEV_API_RUN_AND_DIST.md](./DEV_API_RUN_AND_DIST.md); `docs/README.md` link; single mount for clinical-overview; comment in `clinic.routes.ts`. |
| **Phase 3 consistency** | **Completed** | Duplicate route removed from `clinic.routes.ts` / `dist` clinic router; `lib/api.ts` JSDoc: `[patientId]` = `petId` = `Pet.id`. |
| **Repo `npm run build`** | **Deferred** | Pre-existing `tsc` errors; use **`npm run dev`** for API until build is green. |

---

## L. Identity / list / edit alignment (L3–L5) — **Completed** (2026-03-21)

| Item | Status | Notes |
|------|--------|--------|
| **L3** `getPatient` / `updatePatient` vs overview | **Completed** | `resolvePatientForBranch` in [`patient.service.ts`](../src/api/v1/modules/clinic/patient.service.ts); controller returns `PATIENT_NOT_FOUND` vs `PATIENT_NOT_IN_BRANCH` like clinical-overview. |
| **L4** `listPatients` + `ownerId` | **Completed** | Owner-filtered lists intersect `collectBranchScopedPetIds(branchId)` — picker results match branch directory rules. |
| **L5** Detail + edit errors | **Completed** | Shared [`bpa_web/lib/clinicNotFoundHelpers.js`](../../bpa_web/lib/clinicNotFoundHelpers.js) `formatStaffPatientApiError` (`kind`: route / notInBranch / notFound / generic). Detail [`patients/[patientId]/page.jsx`](../../bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/patients/[patientId]/page.jsx): conditional help (no branch bullets for route-only; targeted copy for `PATIENT_NOT_*`). Edit imports same helper. `parseError` attaches `code` in [`bpa_web/lib/api.ts`](../../bpa_web/lib/api.ts). |

### L1–L7 — Executable checklist (operator / QA)

| Step | Action |
|------|--------|
| **L1** | **Network:** After register, assert `data.id` and `data.clinicRegisteredBranchId === branchId` on POST response. |
| **L2** | **DB:** Confirm `pets.clinicRegisteredBranchId` on the database the API uses (`npx prisma migrate status` / SQL from §A1). |
| **L3** | **Backend:** GET/PATCH `.../patients/:petId` return `PATIENT_NOT_FOUND` vs `PATIENT_NOT_IN_BRANCH` like clinical-overview (`resolvePatientForBranch`). |
| **L4** | **Backend:** `listPatients` with `ownerId` intersects `collectBranchScopedPetIds(branchId)` — picker ids must open in branch. |
| **L5** | **Frontend edit:** [`patients/[patientId]/edit/page.jsx`](../../bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/patients/[patientId]/edit/page.jsx) surfaces API `message` / `code`; distinguish route-not-found vs patient errors (same helper as detail). |
| **L6** | **Frontend:** Grep for hardcoded patient links from owner-filtered lists; with L4, linked ids should stay in scope; fix any stray cross-branch links. |
| **L7** | **Validation:** Same `Pet.id` through register redirect → directory row → detail → edit; negative: wrong id, pet never at branch, pet only on another branch’s list. |

### L-session validation (automated where possible, 2026-03-21)

| Check | Result |
|-------|--------|
| **L2** `npx prisma migrate status` (local `bpa_pet_db`) | **Database schema is up to date** (183 migrations). |
| **L3** Route mounted (unauthenticated probe) | `GET http://localhost:3000/api/v1/clinic/branches/1/patients/1/clinical-overview` → **401** (route exists; not global `Route not found`). |
| **L1 / L7** Full browser E2E | **Deferred** to operators (auth + real branch). |
