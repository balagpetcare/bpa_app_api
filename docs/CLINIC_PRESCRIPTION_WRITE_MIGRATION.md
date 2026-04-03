# Migration: retire `clinic.prescription.write` from clinic Rx authoring

## Release operator checklist

**Pre-deploy**

- Backup DB (min. `branch_access_permissions`; prefer full snapshot).
- Staging: `npm run diagnose:prescription-write-overrides` — fix **AT RISK** / **object-shaped** `permissionOverrides` (migrate script skips objects; edit in UI or SQL).
- Staging: `npm run migrate:prescription-write-overrides`.
- Staging: `npm run diagnose:prescription-write-overrides` again — should be clean.

**Deploy**

- Deploy API (clinic Rx authoring routes = granular keys only).
- Production: `npm run migrate:prescription-write-overrides` if staging diagnose showed array `write` overrides (or run migrate **before** deploy to avoid clinic Rx 403 window).

**Post-deploy verification**

- `npm run diagnose:prescription-write-overrides` — no migratable array rows with `write`; optional SQL (Phase 3) empty or ticketed.

**Smoke tests**

- Vet + clinic API: create draft Rx → PATCH → finalize on same branch.
- Negative: non-vet or read-only → **403** on clinic Rx create.
- Doctor panel: `/api/v1/doctor/...` Rx flow unchanged.

*Expanded steps, SQL, and sign-off table: Phase 3–4 below.*

---

## Phase 1 — Impact analysis (summary)

| Class | Locations |
|-------|-----------|
| **Runtime-critical (removed)** | `clinic.routes.ts` — POST create, PATCH, POST finalize no longer OR `clinic.prescription.write`. |
| **Compatibility** | `permissionsRegistry.service.ts` + `seedRolesPermissions.ts` — key **kept** (RETIRED label) so historical `Permission` / admin UIs stay consistent; **no route uses it**. |
| **Docs/comments** | Audit report, E2E docs, queue standard, amendment plan, this file. |

**Real user paths:** Doctor panel (`/api/v1/doctor/*`) unchanged. Clinic authoring requires `create` / `edit` / `finalize` **and** `requireClinicDoctorStaffForPrescriptionAuthoring`.

**Who breaks without migration:** Users calling **clinic** Rx mutations (`POST|PATCH|…/finalize` under `/api/v1/clinic/branches/:branchId/...`) whose **effective** branch permissions included `clinic.prescription.write` but **not** the matching granular key (`create` / `edit` / `finalize`). Effective permissions = `BRANCH_ROLE_PERMISSIONS[role]` ∪ `permissionOverrides` (array elements **or** object keys — see `resolveBranchAccessProfile`).

**Who does *not* break:** Vets using **only** the doctor panel (`/api/v1/doctor/...` prescriptions) — those routes do **not** use `requireClinicPermission` for Rx; they use `getDoctorBranchMemberIds` + `staffType === DOCTOR`.

**Seed/role matrix:** `CLINIC_STAFF` base role has `clinic.prescription.read` only. **CLINIC_DOCTOR** template writes a **string[]** override list that already includes `create`, `edit`, `finalize` (`ownerClinic.service` `assignClinicRoleTemplate`).

---

## Patterns at risk (DB)

| Pattern | Table / field | After deploy (migration skipped) | Fix |
|--------|----------------|----------------------------------|-----|
| Legacy array override | `branch_access_permissions.permissionOverrides` = `["…","clinic.prescription.write",…]` without all three granular keys | **403** insufficient permission on clinic Rx routes (after vet middleware passes) | `npm run migrate:prescription-write-overrides` |
| Object-shaped JSON | Same column, object with key `clinic.prescription.write` | Same **403**; migration script **skips** non-arrays | Convert to string[] or edit in owner/admin UI |
| PENDING / REVOKED / inactive member | Any | No clinic session or no APPROVED access | N/A until approved + active |

**Not at risk for clinic API:** Nurses / reception — `requireClinicDoctorStaffForPrescriptionAuthoring` returns **403** regardless of permission keys.

---

## Phase 2 — Safe migration design

1. Run **`npm run diagnose:prescription-write-overrides`** on staging, then production, **before** migrate (and again after).
2. Run **`npm run migrate:prescription-write-overrides`** per environment **before or immediately after** API deploy (idempotent; **array** overrides only).
3. Re-assign any vet still missing granular keys via owner **CLINIC_DOCTOR** template or explicit `permissionOverrides` update.
4. No change to doctor routes, Prisma schema, or veterinarian middleware.

---

## Phase 3 — Rollout checklist (expanded)

### Pre-deploy

1. **Backup** database (minimum: `branch_access_permissions`; preferred: full snapshot).
2. **Staging:** `DATABASE_URL=… npm run diagnose:prescription-write-overrides` — capture output; resolve any **object-shaped** overrides or **AT RISK** lines manually.
3. **Staging:** `npm run migrate:prescription-write-overrides` — confirm log lines for updated rows (if any).
4. **Staging:** Re-run diagnose — expect **0** APPROVED+ACTIVE doctor rows missing granular while still listing `write` in effective perms (or only historical RETIRED registry noise in other systems).
5. Optional SQL (Postgres) — rows still mentioning write:

```sql
SELECT id, branch_id, user_id, status, permission_overrides
FROM branch_access_permissions
WHERE permission_overrides::text LIKE '%clinic.prescription.write%';
```

### Deploy

1. Deploy API build containing updated `clinic.routes.ts` (granular keys only on authoring routes).
2. **Production:** Run `npm run migrate:prescription-write-overrides` immediately after deploy **if** diagnose showed array-based `write` overrides (or run **before** deploy for zero downtime on clinic Rx API).

### Post-deploy verification

1. `npm run diagnose:prescription-write-overrides` — **0** migratable rows with `write` in array (optional: **0** substring matches if you cleaned everything).
2. **Smoke — clinic API (vet token, branch context):** with a test vet who has `create`/`edit`/`finalize`, `POST …/visits/:visitId/prescriptions` succeeds (201/200 per API); `PATCH` draft; `POST …/finalize` on draft.
3. **Smoke — negative:** token with **only** `clinic.prescription.read` (or overrides with `write` only after rollback test DB) → **403** on create before vet middleware or after permission gate.
4. **Smoke — doctor panel:** existing flow create/edit/finalize via `/api/v1/doctor/…` unchanged.

---

## Phase 4 — Post-migration

- Registry/seed retain `clinic.prescription.write` as **RETIRED** for traceability.
- Remove stale references from product docs that implied `write` unlocked authoring.

---

## Verdict

**Doctor-only model unchanged.** Authoring is stricter at the permission layer: **write alone no longer substitutes** for create/edit/finalize on clinic routes.

### Rollout readiness (how to sign off)

| Gate | Pass criteria |
|------|----------------|
| Staging diagnose | `npm run diagnose:prescription-write-overrides` — no **AT RISK** doctor rows; object-shaped **ACTION** list empty or ticketed |
| Migration applied | `migrate:prescription-write-overrides` run on prod; optional SQL shows no `write` in `permission_overrides` (or only non-authoring test rows) |
| API | Deployed build uses granular keys on clinic authoring routes |
| Smoke | Vet clinic create + doctor panel Rx both succeed; non-vet / read-only still blocked |

**Template sufficiency:** After migration, any vet assigned **CLINIC_DOCTOR** receives `clinic.prescription.create`, `.edit`, `.finalize` in `permissionOverrides` (full template replace). No dependency on `clinic.prescription.write`.
