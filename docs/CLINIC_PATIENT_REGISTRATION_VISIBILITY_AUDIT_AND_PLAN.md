# Clinic patient registration — visibility & “Patient not found” audit (enterprise plan)

**Last updated:** 2026-03-21  
**Symptom:** Registration from staff UI (e.g. `/staff/branch/1/clinic/patient-register`) appears to succeed, but the new pet does not show in the Patients directory and opening `/staff/branch/1/clinic/patients/3` shows the **Patient not found** card (with migration hint text).

**Related:** [bpa_web/docs/STAFF_CLINIC_PATIENTS_MODULE_ENTERPRISE_AUDIT_AND_PLAN.md](../../bpa_web/docs/STAFF_CLINIC_PATIENTS_MODULE_ENTERPRISE_AUDIT_AND_PLAN.md), [bpa_web/docs/REGISTER_PATIENT_PAGE_MIGRATION_SUMMARY.md](../../bpa_web/docs/REGISTER_PATIENT_PAGE_MIGRATION_SUMMARY.md), [CLINIC_APP_OWNER_PET_API_CONTRACTS.md](./CLINIC_APP_OWNER_PET_API_CONTRACTS.md).

---

## 1. Problem Summary

Staff clinic **patient** = **`Pet`** row. Visibility at a branch is **not** global: list/detail/overview require the pet to be **in branch scope**. After registration, users expect the pet to appear **immediately** in the same branch. When it does not, or when an arbitrary `/patients/:id` URL fails, the UI blames migrations — which is **often misleading** if the real issue is **scope**, **environment**, or **wrong pet id**.

---

## 2. Full registration flow analysis

| Step | Component | What happens |
|------|-----------|----------------|
| 1 | `bpa_web` `patients/register/page.jsx` (also mounted at `patient-register`) | User selects/creates **owner** (`User.id`); submits pet fields. |
| 2 | Payload | `POST /api/v1/clinic/branches/:branchId/patients` with `userId` (= owner `User.id`), `name`, `animalTypeId`, optional taxonomy fields. |
| 3 | `api.ts` `staffClinicPatientRegister` | `apiPost` → JSON body; returns `res.data` (envelope `success`, `data`, optional `message`). |
| 4 | Middleware | `clinic.middleware` `requireClinicPermission` sets `req.clinicBranchId` from **`req.params.branchId`** (URL segment). |
| 5 | Controller | `clinic.controller` `registerPatient` → `patientService.registerPatient(Number(branchId), body)`. |
| 6 | Service create | `prisma.pet.create({ data: { userId, **clinicRegisteredBranchId: branchId**, ... } })` — see [patient.service.ts](../src/api/v1/modules/clinic/patient.service.ts) `registerPatient`. |
| 7 | Response | `sendClinicSuccess(res, 201, patient)` → `{ success: true, data: <pet> }`. |
| 8 | Frontend redirect | If **`!patient?.id`**: show error, **no** success navigation. If `patient.id`: detail or `returnTo` with `petId` query. |
| 9 | Detail page | `staffClinicPatientClinicalOverview` → **GET** `.../clinical-overview` (**mount:** `src/api/v1/routes.ts`) → `resolvePatientClinicalOverview`: **404** `"Patient not found"` vs **404** `"Pet not linked to this branch"` (`PATIENT_NOT_IN_BRANCH`); then aggregates when in scope. |
| 10 | List page | `listPatients` → `collectBranchScopedPetIds(branchId)` = union of **appointment.petId**, **visit.petId**, **`pet.clinicRegisteredBranchId = branchId`**. |

---

## 3. Exact root cause analysis

### A. Intended behavior (current code — correct when DB + deploy align)

- **Register** sets `pets.clinicRegisteredBranchId` to the **same** `branchId` used for list/get (from URL param via middleware).
- **List** includes pets with that `clinicRegisteredBranchId`.
- **Detail / clinical-overview** use `isPetInBranchScope`: appointment **OR** visit **OR** `clinicRegisteredBranchId = branchId`.

So **if** the insert persists `clinicRegisteredBranchId`, the pet **must** appear in list and pass scope for detail.

### B. Likely root causes when symptom appears

| # | Root cause | Evidence / mechanism |
|---|------------|----------------------|
| **1** | **DB migration not applied** (`20260331120000_pet_clinic_registered_branch`) | Column `clinicRegisteredBranchId` missing → Prisma `create` **fails** at runtime (user should see API error, not success). If an **old API build** runs without this field in code, pets could be created **without** branch registration → **never** in scope. |
| **2** | **Stale API process** | Server not restarted after deploy; running code that does not set `clinicRegisteredBranchId`. |
| **3** | **Wrong pet id in URL (operator / bookmark)** | User opens `/patients/3` but the new pet is id **7**. Pet **3** may exist globally but have **no** appointment/visit/**clinic registration** at branch 1 → **`isPetInBranchScope` false** → same UI error. **Not a registration bug.** |
| **4** | **Misread “success”** | UI navigates away even if `patient` is null (edge: malformed JSON / double envelope) — should harden client to require `patient.id`. |
| **5** | **Branch mismatch** (rare) | Different `branchId` in client vs server (unlikely: middleware uses same param as path). |
| **6** | **FK / constraint** | `clinicRegisteredBranchId` FK to `branches.id` — invalid branch id would fail create (unlikely if other clinic routes work). |

### C. Misleading UI copy

The detail empty-state text mentions **migration** whenever overview is null. **`getPatientClinicalOverview` returns null** for **any** failed scope or missing pet — including **“pet exists but not linked to this branch”**. That is **not necessarily** a migration issue.

---

## 4. Existing relevant files / APIs / DB paths

| Layer | Path |
|-------|------|
| Frontend register | `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/patients/register/page.jsx`, `patient-register/page.jsx` (re-export) |
| Frontend API | `bpa_web/lib/api.ts` — `staffClinicPatientRegister`, `staffClinicPatientsList`, `staffClinicPatientClinicalOverview` |
| Routes | `clinic.routes.ts` — `POST/GET/PATCH .../patients`, `GET .../patients/:petId`, etc. **`GET .../clinical-overview`** is only on `src/api/v1/routes.ts`. |
| Controller | `clinic.controller.ts` — `registerPatient`, `listPatients`, `getPatient`, `getPatientClinicalOverview` |
| Service | `patient.service.ts` — `registerPatient`, `listPatients`, `collectBranchScopedPetIds`, `isPetInBranchScope`, `resolvePatientClinicalOverview`, `resolvePatientForBranch`, `getPatientByPetId`, etc. |
| Middleware | `clinic.middleware.ts` — `req.clinicBranchId` from `params.branchId` |
| Schema | `prisma/schema.prisma` — `Pet.clinicRegisteredBranchId` |
| Migration | `prisma/migrations/20260331120000_pet_clinic_registered_branch/migration.sql` |

---

## 5. Current state

| Bucket | Assessment |
|--------|------------|
| **Complete** | End-to-end design: register sets branch id; list/overview use scope helper; `Pet` is clinical patient. |
| **Partial** | Operational guarantees (migration applied, API version) not enforced in app. |
| **Missing** | ~~Distinct API error codes for GET patient~~ **Done (§22).** Optional: automated column verification script. |
| **Broken** | ~~UX conflating migration with scope~~ **Mitigated:** detail/edit use `formatStaffPatientApiError` + conditional copy; generic bullets only when `kind === "generic"`. |

---

## 6. Recommended final registration flow

1. Staff submits register → **single** `POST .../patients` with `userId`, `name`, `animalTypeId`, …  
2. Server creates `Pet` with **`clinicRegisteredBranchId = req.clinicBranchId`** (unchanged).  
3. Response returns full pet including **`id`** and ideally **`clinicRegisteredBranchId`** for verification.  
4. Client **requires** `data.id` before navigation; otherwise show error + log response.  
5. Redirect to detail using **returned** `id` only.  
6. List/detail use existing scope rules (no change unless product wants cross-branch listing).  

---

## 7. Domain mapping

| Term | Meaning |
|------|---------|
| **Owner** | `User` (`Pet.userId`) |
| **Patient (UI)** | `Pet` |
| **patientId (route)** | `Pet.id` |
| **Visit.patientId** | Owner `User.id` (not pet id) — do not mix |
| **Branch registration** | `Pet.clinicRegisteredBranchId` |
| **Appointment / visit** | Alternative paths into `collectBranchScopedPetIds` |

---

## 8. Correct post-registration behavior

- HTTP **201** with `success: true` and `data` = created pet with **`id`** and **`clinicRegisteredBranchId`** equal to branch in URL.  
- Client navigates to `.../patients/{data.id}`.  
- Clinical overview **200** with `patient` payload.

---

## 9. Correct patient visibility rules

At branch **B**, list includes pet **P** iff **any** of:

- `Appointment` with `branchId = B` and `petId = P`, or  
- `Visit` with `branchId = B` and `petId = P`, or  
- `Pet` with `id = P`, `deleted = false`, and `clinicRegisteredBranchId = B`.

---

## 10. Correct detail page lookup rules

- **Param** is **`petId`** (named `patientId` in Next route folder only).  
- Backend **`getPatientClinicalOverview(branchId, petId)`** calls **`isPetInBranchScope`** first; if false → **404 / null** → frontend “not found” card.  
- **Opening another pet’s numeric id** is expected to fail if that pet is not in scope.

---

## 11. API / data contract expectations

- **POST** `/api/v1/clinic/branches/:branchId/patients`  
  - Body: `userId` (number), `name`, `animalTypeId`, optional fields per controller.  
  - Response: `{ success: true, data: Pet & { owner?: ... } }`.  
- **GET** list/overview/get: all use same `branchId` resolution via middleware.

---

## 12. File-by-file implementation plan (summary)

| File | Action |
|------|--------|
| `bpa_web/.../register/page.jsx` | After POST: if `!patient?.id`, show error (do not navigate as success); optional toast with new id. |
| `bpa_web/.../[patientId]/page.jsx` | Replace/overload empty-state copy: scope vs migration; optional link back to list. |
| `backend-api/.../patient.service.ts` | Optional: ensure returned pet always includes `clinicRegisteredBranchId` in JSON (already on model). |
| `backend-api/.../clinic.responses` / controller | Optional: **403/404 subcodes** or `meta.reason` = `NOT_IN_BRANCH_SCOPE` vs `NOT_FOUND` (requires frontend handling). |
| `backend-api/docs` / runbooks | Migration verification step for `pets.clinicRegisteredBranchId`. |

---

## 13. Step-by-step execution phases

| Phase | Description |
|-------|-------------|
| **0** | Reproduce: capture Network tab for POST (status, body `data.id`, `data.clinicRegisteredBranchId`) and GET overview for that id. |
| **1** | Ops: confirm migration applied on target DB; `prisma migrate status`; API restart. |
| **2** | Frontend hardening: success guard + clearer copy. |
| **3** | (Optional) Backend: differentiated error reason for scope vs missing pet. |
| **4** | QA: register → immediate list row → detail overview. |

---

## 14. Validation checklist

- [ ] DB: column `pets."clinicRegisteredBranchId"` exists (SQL `\d pets` or equivalent).  
- [ ] POST register returns `data.clinicRegisteredBranchId ===` branch used in path.  
- [ ] GET `.../patients` includes new `id` without needing appointment.  
- [ ] GET `.../patients/:id/clinical-overview` returns 200 for that `id`.  
- [ ] Opening a **different** id with no scope still fails (expected).  

---

## 15. Risks / deferred items

- **Deferred:** Auto-link pet to open appointment on register (product).  
- **Risk:** Changing 404 shape may affect other consumers — gate behind optional `meta` only.

---

## 16. Final acceptance criteria

- [ ] Root cause documented; migration + scope + id confusion distinguished.  
- [ ] Register flow never treats missing `data.id` as success.  
- [ ] User-visible message reflects **branch scope** when pet exists but is not visible at branch.  
- [ ] Newly registered pets appear in list and overview **without** requiring visit/appointment when migration + code are aligned.

---

## Build execution companion

See [CLINIC_PATIENT_REGISTRATION_VISIBILITY_BUILD_EXECUTION.md](./CLINIC_PATIENT_REGISTRATION_VISIBILITY_BUILD_EXECUTION.md).

---

## 17. Implementation status (2026-03-21 — finalized 2026-03-21 hardening)

- **Completed (code):** C1/C2/C3 per build doc — registration guard, detail copy + API message passthrough, `resolvePatientClinicalOverview` and `CLINIC_ERROR_CODES.PATIENT_NOT_IN_BRANCH`.  
- **Completed (clinical-overview routing):** Main-router mount only; duplicate removed from `clinic.routes.ts`; [DEV_API_RUN_AND_DIST.md](./DEV_API_RUN_AND_DIST.md) added.  
- **Completed (L3–L5):** `resolvePatientForBranch` for GET/PATCH patient (same 404 semantics as overview); `listPatients(ownerId)` intersects branch scope; staff **detail + edit** use `formatStaffPatientApiError` for `code` / `kind` and conditional copy (route vs branch vs wrong id).  
- **Completed (local DB):** Prisma migrations applied in dev; `clinicRegisteredBranchId` migration in repo.  
- **Partially completed:** §14 / §16 / Phase 1 manual browser QA (register → list → detail **200** with session) — **operator should confirm** after deploy.  
- **Deferred:** Optional column verification script; product idea “auto-link pet to open appointment on register” (§15); full `npm run build` green (repo-wide `tsc` debt).

---

## 18. Clinical overview API route (`Route not found`)

- **Canonical path:** `GET /api/v1/clinic/branches/:branchId/patients/:petId/clinical-overview` (`petId` = `Pet.id`; staff UI `[patientId]` is the same value).  
- **Sole mount (source of truth):** **`src/api/v1/routes.ts`** immediately before `router.use("/clinic", …)`. **`clinic.routes.ts` does not register this path** (avoids maintaining two copies; see final hardening pass).  
- **Failure mode:** Global 404 `Route not found: GET …` when using **`npm start`** with **stale `dist/`** (older bundles missing the `routes.js` mount).  
- **Operational note:** [DEV_API_RUN_AND_DIST.md](./DEV_API_RUN_AND_DIST.md). Frontend: `lib/api.ts` uses the canonical path; staff detail page treats `Route not found` as an API deployment / build hint, not patient scope.

---

## 19. Symptom-to-cause matrix (identity / branch visibility)

| Symptom | Likely cause | What to verify |
|---------|----------------|----------------|
| Detail `/patients/9` works; edit `/patient-edit/8` fails | **Different `Pet.id` in URLs** (tabs, bookmarks, manual typing) | Compare both numbers to POST `data.id` / list row `id`. |
| “Patient not found” on edit but message on detail mentions branch | **Historical:** GET patient used to collapse scope into one 404. **Now:** `PATIENT_NOT_IN_BRANCH` vs `PATIENT_NOT_FOUND` on GET/PATCH patient (see §22). | Network → response JSON `code`. |
| Pet “in database” but not in Patients directory | **`clinicRegisteredBranchId` null** or **wrong branch row**; or pet only visible via another branch | SQL / Prisma: `pets` row for `id`; `migrate status`. |
| Listed in picker but detail 404 | **Fixed (L4):** `listPatients` + `ownerId` now intersects `collectBranchScopedPetIds`. If still seen, cache or non-staff API path. | GET list with `ownerId` — every `id` should open overview. |
| Global `Route not found: GET …/clinical-overview` | **Stale `dist/`** under `npm start`, or wrong API host | [DEV_API_RUN_AND_DIST.md](./DEV_API_RUN_AND_DIST.md); use `npm run dev` or rebuild `dist`. |

---

## 20. Canonical identity (`Pet.id` only)

- There is **no** separate clinic **Patient** table in Prisma for this flow. Staff **patient** = **`Pet`**.
- **URL segment** `[patientId]` (Next.js folder name) = **REST param** `:petId` = **`Pet.id`** (integer).
- **Do not confuse** with `Visit` or other domains that use “patient” to mean **owner `User.id`** — see §7.
- **Navigation contract:** `staffClinicPatientDetailPath(branchId, id)`, `staffClinicPatientEditPath(branchId, id)`, and list row `p.id` must all be the same **`Pet.id`**.

---

## 21. `listPatients(ownerId)` vs branch directory

- **Directory** (`GET .../patients` without `ownerId`): pets with `id ∈ collectBranchScopedPetIds(branchId)` only.
- **Owner filter** (`ownerId` query): **same branch scope** — `userId = ownerId` **and** `id ∈ collectBranchScopedPetIds(branchId)` (L4). Pickers (intake, appointment wizards, `CompleteIntakeModal`, etc.) therefore **cannot** list an owner’s pet that has no appointment, visit, or **clinic registration** at this branch.
- **Product tradeoff:** Staff can no longer use this endpoint to enumerate **all** owner pets across branches under a branch-scoped clinic URL; that was intentional for **strict branch isolation**.

---

## 22. `getPatient` vs `getPatientClinicalOverview` (aligned semantics)

| Endpoint | Resolver | `404` + `code` |
|----------|----------|----------------|
| `GET .../patients/:petId/clinical-overview` | `resolvePatientClinicalOverview` | `PATIENT_NOT_FOUND` — no non-deleted pet; `PATIENT_NOT_IN_BRANCH` — pet exists but not in scope. |
| `GET .../patients/:petId` | `resolvePatientForBranch` | **Same** messages and codes as row above. |
| `PATCH .../patients/:petId` | `resolvePatientForBranch` (before update) | **Same**; update proceeds only when `kind === "OK"`. |

**Scope** (unchanged): appointment at branch **or** visit at branch **or** `pets.clinicRegisteredBranchId = branchId`.

**Frontend:** `bpa_web/lib/clinicNotFoundHelpers.js` — `formatStaffPatientApiError` maps API `message` / `code` + `kind` for staff **detail** and **edit** pages (`parseError` in `lib/api.ts` attaches `code`).
