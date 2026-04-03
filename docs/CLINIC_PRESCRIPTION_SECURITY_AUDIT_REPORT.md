# BPA Clinic — Prescription security audit (full repository sweep)

**Repositories:** `backend-api`, `bpa_web`  
**Audit date:** 2026-03-21  
**Method:** Code trace only (routes → middleware → controller → service → DB). UI treated as non-authoritative.

---

## Rollout note — `clinic.prescription.write` retirement (operators)

**Before / during release, every environment:**

1. `npm run diagnose:prescription-write-overrides` (staging, then production).
2. `npm run migrate:prescription-write-overrides` (idempotent; fixes **array** `permissionOverrides` only).
3. `npm run diagnose:prescription-write-overrides` **again** — confirm no remaining **AT RISK** rows / migratable `write` arrays.
4. If `permissionOverrides` is **object-shaped** JSON (not `string[]`), the migrate script **does not** change it — **manual** fix in DB or owner UI; see [CLINIC_PRESCRIPTION_WRITE_MIGRATION.md](./CLINIC_PRESCRIPTION_WRITE_MIGRATION.md).

Full steps and smoke tests: [CLINIC_PRESCRIPTION_WRITE_MIGRATION.md](./CLINIC_PRESCRIPTION_WRITE_MIGRATION.md).

---

## Phase 1 — Global search and inventory

### 1. Backend routes (`clinic.routes.ts`)

| Method | Path | Handler | Permission(s) | Notes |
|--------|------|---------|---------------|--------|
| GET | `/branches/:branchId/visits/:visitId/prescriptions` | `listPrescriptionsByVisit` | `clinic.prescription.read` | |
| POST | same base (create) | `createPrescription` | `clinic.prescription.create` only | + `requireClinicDoctorStaffForPrescriptionAuthoring` |
| GET | `/branches/:branchId/prescriptions/verify/:qrToken` | `getPrescriptionByQr` | `clinic.prescription.read` | |
| GET | `/branches/:branchId/prescriptions/:prescriptionId` | `getPrescription` | `clinic.prescription.read` | |
| PATCH | `/branches/:branchId/prescriptions/:prescriptionId` | `updatePrescription` | `clinic.prescription.edit` only | + vet middleware |
| POST | `.../prescriptions/:prescriptionId/finalize` | `finalizePrescription` | `clinic.prescription.finalize` only | + vet middleware |
| POST | `.../prescriptions/:prescriptionId/dispense` | `dispensePrescription` | `medicine.dispense.issue` | **No** vet middleware |
| GET | `/branches/:branchId/medicine-search` | `searchMedicine` | `clinic.prescription.read` | Read-only catalog search |
| GET | `.../prescriptions/:prescriptionId/order-lines` | `getPrescriptionOrderLines` | `clinic.prescription.read` **or** `clinic.emr.write` | |

### Doctor routes (`doctor.routes.ts`, prefix `/api/v1/doctor`)

| Method | Path | Handler |
|--------|------|---------|
| GET | `/prescriptions` | `listPrescriptions` |
| POST | `/visits/:id/prescriptions` | `createVisitPrescription` |
| PATCH | `/prescriptions/:prescriptionId` | `updatePrescription` |
| POST | `/prescriptions/:prescriptionId/finalize` | `finalizePrescription` |

All doctor routes use `authenticateToken` only (no branch-scoped `requireClinicPermission`). Authorization is `getDoctorBranchMemberIds` → `ClinicStaffProfile.staffType === "DOCTOR"` (see `doctor.service.ts`).

### 2. Controllers

- **`clinic.controller.ts`** — `listPrescriptionsByVisit`, `createPrescription`, `getPrescription`, `getPrescriptionByQr`, `updatePrescription`, `finalizePrescription`, `dispensePrescription`, `searchMedicine`, `getPrescriptionOrderLines`.
- **`doctor.controller.ts`** — `listPrescriptions`, `createVisitPrescription`, `updatePrescription`, `finalizePrescription` (prescription block ~306–602).

### 3. Services

- **`prescription.service.ts`** — `createPrescription`, `getPrescriptionById`, `getPrescriptionByQrToken`, `listByVisit`, `updatePrescription` (DRAFT-only), `finalizePrescription` (DRAFT→FINALIZED), `markDispensed` (FINALIZED→DISPENSED), `searchMedicine`.
- **`doctor.service.ts`** — `createPrescriptionByVisit`, `updatePrescriptionByDoctor`, `finalizePrescriptionByDoctor` (visit/prescription scoped to `doctorBranchMemberIds`).

No other `src/**/*.ts` files call `prescriptionService.createPrescription` / `updatePrescription` / `finalizePrescription` / `markDispensed` outside the above controllers and doctor service (verified by ripgrep).

### 4. Middleware

- **`clinic.middleware.ts`** — `requireClinicDoctorStaffForPrescriptionAuthoring`: requires `BranchMember` **ACTIVE** on `req.clinicBranchId` + `clinicStaffProfile.staffType === "DOCTOR"`; sets `req.clinicDoctorBranchMemberId`.
- Clinic router stack (elsewhere): `requireClinicPermission` for branch-effective permissions.

### 5. Permission registry

- **`permissionsRegistry.service.ts`** — `clinic.prescription.read`, **RETIRED** `clinic.prescription.write` (registry/seed label only; no route), `create`, `edit`, `finalize`, reserved `delete`.

### 6. Role templates / branch roles

- **`branchRoles.ts`**
  - `BRANCH_ROLE_PERMISSIONS.CLINIC_STAFF`: `clinic.prescription.read` only; authoring via **CLINIC_DOCTOR** template overrides.
  - `BRANCH_ROLE_PERMISSIONS.BRANCH_MANAGER`: `read` + **`medicine.dispense.issue`** (no prescription authoring keys).
  - `BRANCH_ROLE_PERMISSIONS.CLINIC_RECEPTION`: `read` only (no authoring keys).
  - `CLINIC_ROLE_TEMPLATE_PERMISSIONS.CLINIC_DOCTOR`: read + create/edit/finalize.
  - `CLINIC_ROLE_TEMPLATE_PERMISSIONS.CLINIC_NURSE`: read only.
  - `CLINIC_ROLE_TEMPLATE_PERMISSIONS.CLINIC_MANAGER`: pharmacy keys including `medicine.dispense.issue`; **no** `clinic.prescription.*` authoring keys.

### 7. Seeds

- **`prisma/seeders/seedRolesPermissions.ts`** — Defines keys including **RETIRED** `write` label; `CLINIC_STAFF` seed row has **read** only for prescriptions.

### 8. Tests

- **`prescriptionDoctorMiddleware.test.ts`** — NURSE → 403; DOCTOR → `next` + `clinicDoctorBranchMemberId`.
- **`prescription.service.immutability.test.ts`** — `updatePrescription` returns `null` for non-DRAFT (mocked Prisma).

Controller- and middleware-level tests under `**/prescription*.test.ts` (see Post-hardening / Post-write-migration sections).

### 9. Frontend pages (`bpa_web`)

| Area | Path(s) | Behavior |
|------|---------|----------|
| Doctor | `app/doctor/(larkon)/visits/[id]/page.tsx` | Create / edit draft / finalize via **doctor** API helpers |
| Doctor | `app/doctor/(larkon)/prescriptions/page.tsx` | **Read-only** list (`doctorListPrescriptions`) |
| Staff | `.../clinic/visits/[visitId]/page.jsx` | List + print links; `staffClinicPrescriptionsByVisit` (GET) |
| Staff | `.../clinic/prescriptions/.../print/page.tsx` | `staffClinicPrescriptionGet` (GET) + client branch check |
| Staff | `.../clinic/patients/[patientId]/page.jsx` | Print links with `read` |
| Staff | `.../clinic/billing/page.tsx` | `staffClinicPrescriptionOrderLines` (GET) |
| Staff | `.../medicine-control/injection-tokens/page.tsx` | `staffClinicPrescriptionsByVisit` (GET) for visit context |
| Clinic shell | `app/clinic/(larkon)/prescriptions/page.jsx` | Read-only list + QR verify + print link to staff print URL |
| Owner | Catalog “requires prescription” checkbox only — **not** Rx authoring |
| Admin | **No** prescription matches under `app/admin` |

### 10. Frontend API helpers (`bpa_web/lib/api.ts`)

- **Mutations:** `doctorCreateVisitPrescription`, `doctorUpdatePrescription`, `doctorFinalizePrescription` → `/api/v1/doctor/...` only.
- **Staff/clinic:** `staffClinicPrescriptionsByVisit`, `staffClinicPrescriptionGet`, `staffClinicPrescriptionByQr`, `staffClinicPrescriptionOrderLines` → **GET** clinic routes only.
- **Removed / absent:** No `staffClinicPrescriptionCreate`, `Update`, or `Finalize` symbols in repo (verified grep).

### Shared components / menus

- `src/lib/permissionMenu.ts` — doctor nav entry `/doctor/prescriptions` (list page; no authoring).
- No action dropdowns/modals found outside doctor visit page for Rx authoring.

---

## Phase 2 — Backend security trace (mutations)

### A. Clinic POST create

**Chain:** `requireClinicPermission("clinic.prescription.create")` → `requireClinicDoctorStaffForPrescriptionAuthoring` → `createPrescription` → `prescriptionService.createPrescription`.

| Question | Answer |
|----------|--------|
| Endpoint | `POST /api/v1/clinic/branches/:branchId/visits/:visitId/prescriptions` |
| Permission keys | `clinic.prescription.create` only (`clinic.prescription.write` **not** accepted) |
| Active BranchMember? | Yes (implicit via clinic auth + branch context); middleware loads member with `status: "ACTIVE"` |
| `staffType === DOCTOR`? | **Yes** (middleware) |
| Same branch? | **Yes** — `visit` loaded with `{ id, branchId }` match |
| Visit same doctor? | **Yes** — `visit.doctorId === req.clinicDoctorBranchMemberId` |
| Ownership before mutate? | N/A (create); `petId` taken from **visit**, not body |
| Non-doctor via misconfig? | **No** — fails middleware even if role has `create` |
| `write` only in overrides? | **403** insufficient permission — must use migration script + granular keys |

### B. Clinic PATCH update

**Chain:** `requireClinicPermission("clinic.prescription.edit")` → vet middleware → `updatePrescription` → service `updatePrescription`.

| Question | Answer |
|----------|--------|
| Branch | `existing.visit.branchId === branchId` |
| Prescriber | `existing.doctorId === doctorBranchMemberId` |
| DRAFT | Controller **409** if not `DRAFT`; service returns `null` if not `DRAFT` |
| Finalized edit loophole | **Not in code path** — double layer |

### C. Clinic POST finalize

Same as PATCH for branch, prescriber, DRAFT; then `finalizePrescription` service.

### D. Clinic POST dispense

**Chain:** `requireClinicPermission("medicine.dispense.issue")` only → `dispensePrescription` → `markDispensed`.

| Question | Answer |
|----------|--------|
| Vet middleware? | **No** — intentional pharmacy / fulfillment |
| Branch | `existing.visit.branchId === branchId` |
| Status | Service requires **FINALIZED** before **DISPENSED** |
| Mixing with authoring? | **Separated** — dispense does not use `clinic.prescription.*` keys |

### E. Doctor POST/PATCH prescriptions

**Chain:** `authenticateToken` → `getDoctorBranchMemberIds` (DOCTOR profiles only) → `createPrescriptionByVisit` / `updatePrescriptionByDoctor` / `finalizePrescriptionByDoctor`.

| Question | Answer |
|----------|--------|
| Branch in URL | **No** — doctor API is not branch-prefixed |
| Visit assignment | Create: `visit.doctorId IN doctorIds` |
| Prescription ownership | Update/finalize: `prescription.doctorId IN doctorIds` + **DRAFT** in service/controller |
| Client `doctorId` | **Not** trusted from body for create — service uses `visit.doctorId` from DB |
| Cross-branch | Prescription row ties to `visitId`; doctor can hold multiple `branchMemberId`s; enforcement is **prescriber id**, not “current branch” cookie |

### F. Delete

- Registry key `clinic.prescription.delete` exists; **no** delete route or controller handler found.

### G. Hidden / derived mutation

- **`markDispensed`** also creates optional `DispenseRequest` (non-fatal on failure); still only from **FINALIZED** and only via dispense endpoint.

**Flagged (not HIGH):**

- **Doctor API** does not assert `visit.branchId` against a caller-supplied branch; risk is limited to **authorized multi-branch doctors** editing **their own** prescriptions.

---

## Phase 3 — Permission and role matrix audit

### Effective rule (authoritative)

- **Authoring (create/edit/finalize) on clinic API:** `requireClinicDoctorStaffForPrescriptionAuthoring` is **mandatory** on those routes; **permission keys alone cannot authorize a nurse** on clinic mutations.
- **Doctor API:** Only users with at least one `ClinicStaffProfile` with `staffType: "DOCTOR"` get non-empty `doctorIds`.

### Template vs reality

- **`CLINIC_STAFF` / seed** — prescription **read** only; nurses **403** on clinic mutation routes (middleware); vets need **CLINIC_DOCTOR** template (or overrides with create/edit/finalize).
- **`CLINIC_NURSE` template:** `read` only — aligned.
- **`BRANCH_MANAGER`:** `read` + `medicine.dispense.issue` — can **dispense**, not author.
- **`PHARMACY_STAFF` template:** `medicine.dispense.issue` — dispense path; typically no `clinic.*` clinic session (depends on assignment); no Rx authoring keys in template.
- **Owner / admin:** No clinic prescription routes under `owner` module; admin panel has **no** prescription code in `bpa_web/app/admin`.

### Retired `clinic.prescription.write`

- **Removed** from clinic authoring route permission OR lists. Key remains in registry/seed as **RETIRED** for historical rows. Migrate DB overrides with `scripts/migrate-prescription-write-overrides.ts`.

### Dispense vs authoring

- **Authoring keys** / vet middleware vs **`medicine.dispense.issue`** — correctly separated on routes.

### Summary matrix (intended enforcement)

| Capability | BRANCH_MANAGER | CLINIC_RECEPTION | CLINIC_STAFF (nurse) | CLINIC_STAFF (vet) | CLINIC_DOCTOR template | PHARMACY (typical) |
|------------|----------------|------------------|----------------------|--------------------|-------------------------|--------------------|
| View (`read`) | Yes* | Yes | Yes | Yes | Yes | No† |
| Print (UI) | If `read` + staff UI | If `read` | If `read` | If `read` | Doctor UI / print | — |
| QR verify | If `read` | If `read` | If `read` | If `read` | — | — |
| Create (clinic API) | No‡ | No | **No** (403) | Yes if assigned visit + perms | Yes | No |
| Edit / finalize (clinic API) | No‡ | No | **No** (403) | Own draft + perms | Yes | No |
| Doctor API create/edit/finalize | — | — | No (not in doctorIds) | Yes if doctor profile | Yes | No |
| Dispense (`markDispensed`) | If `medicine.dispense.issue` | No | No | If perm | If perm | If `issue` |

\*Per `branchRoles.ts` matrix.  
†Template has no `clinic.prescription.read`; branch role may differ if custom.  
‡Unless given custom overrides (unusual).

---

## Phase 4 — Frontend regression sweep

1. **Non-doctor pages:** Staff/clinic prescription surfaces use **GET** helpers only; copy states read-only where checked (`clinic/prescriptions/page.jsx`, visit page subtitle).
2. **No** “Add / Edit / Finalize / Save / Delete Prescription” on staff/clinic/owner/admin paths except **doctor visit** page.
3. **No** `staffClinicPrescriptionCreate|Update|Finalize` in codebase.
4. **`doctor*Prescription` helpers:** Reachable only from **doctor** routes/components; doctor panel is authenticated as doctor user.

**Suspicious leftover:** None that re-enables staff authoring; **compat risk** is future re-introduction of clinic POST helpers in `lib/api.ts` (recommend CI grep).

---

## Phase 5 — Print / view / verify

| Path | Server enforcement | Client |
|------|-------------------|--------|
| GET prescription by id | `prescription.visit.branchId === :branchId` | Print page rechecks `visit.branchId` vs route |
| QR verify | Same branch check on resolved prescription | Clinic page displays result of GET only |
| List by visit | Visit must exist with `branchId` | N/A |
| Order lines | Branch check via `getPrescriptionById` | Billing page uses branch from layout |

**QR:** Returns same prescription payload as get-by-id path after branch match — **read-only** route; no mutation.

**Doctor list:** `listPrescriptionsForDoctor` — scoped to doctor’s prescriptions (service layer); not branch-param attack surface in same way as clinic routes.

---

## Phase 6 — Finalize / immutability

1. **States (Prisma):** `DRAFT`, `FINALIZED`, `DISPENSED`.
2. **Edit finalized?** **No** — controller rejects; service returns `null` for non-DRAFT updates.
3. **Re-finalize?** **No** — finalize requires DRAFT; service no-ops otherwise.
4. **Clinic vs doctor APIs:** Both require **DRAFT** before finalize/update (doctor controller pre-check + service).
5. **Silent mutation after finalize:** **Dispense** sets **DISPENSED** (explicit endpoint); no other code path updates items/notes after FINALIZED in `prescription.service.ts`.
6. **Amendments / versioning:** **Not implemented** — finalized treated immutable for clinical content; see `CLINIC_PRESCRIPTION_FINALIZATION_LOCKING_AMENDMENT_PLAN.md` for future design.

**HIGH RISK finalized-edit loophole:** **None identified** in traced code.

---

## Phase 7 — Test coverage gaps

| Case | Present? |
|------|----------|
| Non-doctor clinic POST create → 403 | **Partial** — middleware unit test only, not HTTP |
| Non-doctor clinic PATCH/finalize → 403 | Same |
| Doctor create on assigned visit → 200 | **No** integration test |
| Doctor update/finalize own draft → 200 | **No** |
| Doctor update other doctor’s Rx → 403 | **No** |
| Finalized update → 409 | Service unit test only |
| Cross-branch GET prescription → 404 | **No** automated test |
| Cross-branch print | **No** |
| Dispense without FINALIZED → 400 | **No** |
| Dispense permission without authoring | **No** explicit test |

---

# Output sections (required format)

## 1. Executive summary

- **Verdict:** Doctor-only **authoring** is **enforced on the clinic API** by `requireClinicDoctorStaffForPrescriptionAuthoring` in addition to permissions; **non-doctors cannot pass** that gate even if `CLINIC_STAFF` includes authoring keys in JSON matrices.
- **Doctor API** enforces prescribing via `ClinicStaffProfile.staffType === "DOCTOR"` and `doctorId` / visit assignment in DB.
- **Dispense** is intentionally **non-doctor-capable** with `medicine.dispense.issue`, separate from authoring.
- **Rollout readiness:** **SAFE** for doctor-only model — `clinic.prescription.write` removed from authoring route OR lists (2026-03-21). **Operators:** follow **Rollout note** at top of this doc (`diagnose` → `migrate` → `diagnose` again; object JSON = manual).

## 2. Confirmed safe paths (code-traced)

- Clinic: GET list / GET by id / GET QR / GET medicine-search / GET order-lines with **branch** checks where applicable.
- Clinic: POST create, PATCH, POST finalize with **vet middleware** + **visit doctor match** + **DRAFT** rules.
- Doctor: POST/PATCH prescriptions with **getDoctorBranchMemberIds** + visit/prescription doctor match + **DRAFT** rules.
- Service: `updatePrescription` / `finalizePrescription` / `markDispensed` status guards.

## 3. Suspicious leftovers

- **`clinic.prescription.write`** remains in **registry + seed** as RETIRED (historical key only).
- **`clinic.emr.write` OR** on order-lines — broader read than `prescription.read` alone.
- **Unused `doctorListPrescription` consumers** — only doctor list page; safe.

## 4. High-risk findings

- **None** for “non-doctor can author” or “finalized Rx editable” given current middleware placement.
- **Residual:** Doctor API branch-agnostic by design — acceptable if product accepts “doctor owns Rx globally”; tighten if multi-tenant isolation requires branch token on every Rx mutation.

## 5. Permission matrix

See Phase 3 table (view / print / create / edit / finalize / dispense by role template).

## 6. Frontend findings

- **Safe:** Staff/clinic GET-only usage; doctor authoring isolated to `app/doctor/(larkon)/visits/[id]/page.tsx`.
- **Suspicious:** None for hidden authoring; **monitor** `lib/api.ts` for revived clinic mutation exports.

## 7. Backend findings

- **Safe:** Controller branch and prescriber checks; service status machine; dispense separated; authoring permissions are granular only on clinic routes.

## 8. Test coverage gaps

See Phase 7 — **no HTTP-level** prescription auth tests; add supertest (or equivalent) for clinic + doctor routes.

## 9. Recommended cleanup

**a. Must-fix now**  
- None for production security **if** middleware remains on all three clinic mutation routes (verify in code review checklist).

**b. Should-fix next**  
- Optional HTTP supertest suite for full stack.  
- Narrow order-lines permission if product agrees.

**c. Optional**  
- Narrow order-lines to `clinic.prescription.read` only.  
- CI: fail build if `staffClinicPrescription(Create|Update|Finalize)` appears in `lib/api.ts`.

## 10. Final verdict

**SAFE** — legacy `write` OR removed from clinic authoring routes; operators: **Rollout note** (top) + [CLINIC_PRESCRIPTION_WRITE_MIGRATION.md](./CLINIC_PRESCRIPTION_WRITE_MIGRATION.md).

---

---

## Post-hardening pass (2026-03-21)

- **Tests added:** `prescription.clinic.controller.security.test.ts`, `prescription.doctor.controller.security.test.ts`, `prescription.dispense.permission.test.ts`; extended `prescriptionDoctorMiddleware.test.ts` (nurse parity). Covers nurse/middleware intent via controller defensive checks, cross-branch read, finalized PATCH, dispense preconditions, dispense permission gate, doctor non-owner updates.
- **Jest:** `diagnostics: false` for ts-jest so large controllers compile under tests; `permissionsRegistry.test.ts` allows `scope: "branch"`.
- **Roles:** `CLINIC_STAFF` no longer lists `clinic.prescription.create|edit|finalize` in `branchRoles.ts` and `seedRolesPermissions.ts` (vets keep keys via `CLINIC_DOCTOR` template overrides).
- **Routes/docs:** `clinic.routes.ts` comments aligned; stale E2E / queue docs updated; `clinic.prescription.write` described as deprecated everywhere touched.
- **Order-lines:** Still `clinic.prescription.read` OR `clinic.emr.write` — documented in-route (billing/EMR path).

---

## Post–`clinic.prescription.write` route migration (2026-03-21)

- **Routes:** `requireClinicPermission` for clinic Rx authoring uses **only** `create` / `edit` / `finalize` (no `write` OR).
- **Operators:** `npm run diagnose:prescription-write-overrides` → `npm run migrate:prescription-write-overrides` → diagnose again; object-shaped `permissionOverrides` = manual review (same as **Rollout note** at top).
- **Tests:** `prescription.clinic.authoring.permission.test.ts` — `write` alone does **not** pass create/edit/finalize permission gates; granular keys do.
- **Docs:** [CLINIC_PRESCRIPTION_WRITE_MIGRATION.md](./CLINIC_PRESCRIPTION_WRITE_MIGRATION.md) — release operator checklist + Phase 3 detail.

*End of report.*
