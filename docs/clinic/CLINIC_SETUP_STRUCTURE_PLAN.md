# Clinic Setup & Structure Plan

## 1. Scope

Enable an Owner (port 3104) to **configure and manage clinic capabilities** for any of their Branches. A clinic is NOT a separate entity -- it is a **Branch with `BranchTypeCode.CLINIC`** and its `featuresJson` flags unlocked. The Owner Panel gets dedicated pages for clinic setup, service catalog management, operating-hours/specializations, and a read-only overview of appointments/patients -- delegating day-to-day clinical operations to the Clinic Panel (3102) and Staff Panel.

### In-scope (Phase 1: Setup & Structure)

- Owner can mark a Branch as a clinic (branch type = CLINIC)
- Owner can configure clinic-specific settings per branch (specializations, operating hours, consultation slots)
- Owner can manage the service catalog (CRUD) for clinic branches
- Owner can view clinic branches overview (appointment counts, patient counts, staff counts)
- Owner can assign clinic staff roles to branch members
- Menu and navigation updates in Owner Panel sidebar

### Out-of-scope (later phases)

- Appointment booking engine (Clinic Panel, Phase 2)
- Patient medical records / EMR (Phase 3)
- Prescription management (Phase 3)
- Treatment workflows (Phase 3)
- Clinic billing / invoicing (Phase 4)
- Public clinic discovery (Mother App, Phase 5)

---

## 2. Data Model Changes (Minimal)

### 2a. Existing models leveraged -- NO migration needed

| Model | Field | Already exists | Usage |
| ----- | ----- | -------------- | ----- |

- `Branch.capabilitiesJson` -- already stores `{ clinic: true }` when branch is a clinic
- `Branch.featuresJson` -- already stores `{ appointments: true, services: true }` etc.
- `Branch.types` -> `BranchToType` -- already links branch to `BranchTypeCode.CLINIC`
- `Service` model -- full CRUD for clinic service catalog (name, category, price, duration)
- `BranchMember` + `BranchMemberRole` -- staff assignment with `CLINIC_STAFF` role
- `Permission` / `RolePermission` -- `service.read`, `clinic.appointments.read`, `clinic.patients.read` already registered

### 2b. New field: `Branch.clinicSettingsJson` (one migration)

Add a single JSON column to Branch to store clinic-specific configuration:

```prisma
model Branch {
  // ... existing fields ...
  clinicSettingsJson Json @default("{}") // clinic hours, specializations, slot config
}
```

Shape of `clinicSettingsJson`:

```typescript
type ClinicSettings = {
  specializations?: string[];        // e.g. ["general", "dermatology", "surgery"]
  consultationSlotMinutes?: number;  // default 30
  maxDailyAppointments?: number;     // optional cap
  walkInsAllowed?: boolean;          // default true
  operatingHours?: {                 // clinic-specific override of branch hours
    [day: string]: { open: string; close: string; breakStart?: string; breakEnd?: string };
  };
  emergencyAvailable?: boolean;
  notes?: string;
};
```

**Migration**: Single `ALTER TABLE branches ADD COLUMN "clinicSettingsJson" JSONB DEFAULT '{}'::jsonb;`

### 2c. New permissions to register (seed only, no migration)

| Permission key           | Label                          | Scope |
| ------------------------ | ------------------------------ | ----- |
| `clinic.settings.read`   | View clinic settings           | both  |
| `clinic.settings.write`  | Edit clinic settings           | both  |
| `clinic.services.manage` | Manage clinic services         | both  |
| `clinic.overview.read`   | View clinic overview dashboard | both  |

Add these to `permissionsRegistry.service.ts` under a "Clinic Setup" group, and to `seedRolesPermissions.ts` for `BRANCH_MANAGER` and `CLINIC_STAFF` roles.

---

## 3. API Routes (Backend)

All new routes are added under the **existing** `owner.routes.ts` file, scoped to `/api/v1/owner/clinic/*`.

### 3a. Clinic Branch Overview

```
GET /api/v1/owner/clinic/branches
```

Returns all branches where `BranchTypeCode = CLINIC` for the owner's orgs. Includes counts (services, staff, appointments).

### 3b. Clinic Settings (per branch)

```
GET  /api/v1/owner/clinic/branches/:branchId/settings
PUT  /api/v1/owner/clinic/branches/:branchId/settings
```

Read and update `clinicSettingsJson`. Validates branch belongs to owner and has CLINIC type.

### 3c. Clinic Services (per branch) -- delegates to existing `services` module

```
GET    /api/v1/owner/clinic/branches/:branchId/services
POST   /api/v1/owner/clinic/branches/:branchId/services
PATCH  /api/v1/owner/clinic/branches/:branchId/services/:serviceId
DELETE /api/v1/owner/clinic/branches/:branchId/services/:serviceId
```

Thin wrappers ensuring owner context + branch ownership, then calling existing `services.service.ts` logic.

### 3d. Clinic Staff (per branch)

```
GET /api/v1/owner/clinic/branches/:branchId/staff
```

Lists `BranchMember` rows for the clinic branch, with role info. Uses existing `owner.controller.ts` branch members logic.

### Implementation pattern

New files:

- `src/api/v1/modules/owner/ownerClinic.controller.ts` -- handler functions
- `src/api/v1/modules/owner/ownerClinic.service.ts` -- business logic

Routes mounted in existing `owner.routes.ts`:

```typescript
const clinicCtrl = require('./ownerClinic.controller');
router.get('/clinic/branches', clinicCtrl.listClinicBranches);
router.get('/clinic/branches/:branchId/settings', clinicCtrl.getClinicSettings);
router.put('/clinic/branches/:branchId/settings', clinicCtrl.updateClinicSettings);
router.get('/clinic/branches/:branchId/services', clinicCtrl.listClinicServices);
router.post('/clinic/branches/:branchId/services', clinicCtrl.createClinicService);
router.patch('/clinic/branches/:branchId/services/:serviceId', clinicCtrl.updateClinicService);
router.delete('/clinic/branches/:branchId/services/:serviceId', clinicCtrl.deleteClinicService);
router.get('/clinic/branches/:branchId/staff', clinicCtrl.listClinicStaff);
```

---

## 4. Permissions & Guards

- All `/owner/clinic/*` routes sit behind existing `ownerPanelGuard` (already applied to all owner routes after auth/KYC).
- Per-route permission checks use `requireOwnerPermission('clinic.settings.read', 'branch')` etc.
- Existing `BRANCH_MANAGER` and `OWNER` roles get all `clinic.*` permissions by default.
- `CLINIC_STAFF` gets `clinic.settings.read`, `clinic.overview.read`, `clinic.services.manage`.

---

## 5. UI Routes (Owner Panel -- port 3104)

### 5a. New pages under `app/owner/(larkon)/`

| Route                                   | Page                                      | Purpose                                                                      |
| --------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| `/owner/clinic`                         | `clinic/page.tsx`                         | Clinic branches overview (list clinic branches with KPI cards)               |
| `/owner/clinic/[branchId]`              | `clinic/[branchId]/page.tsx`              | Single clinic branch dashboard (services count, staff, appointments summary) |
| `/owner/clinic/[branchId]/settings`     | `clinic/[branchId]/settings/page.tsx`     | Clinic settings form (specializations, hours, slot config)                   |
| `/owner/clinic/[branchId]/services`     | `clinic/[branchId]/services/page.tsx`     | Service catalog CRUD table                                                   |
| `/owner/clinic/[branchId]/services/new` | `clinic/[branchId]/services/new/page.tsx` | Create new service form                                                      |
| `/owner/clinic/[branchId]/staff`        | `clinic/[branchId]/staff/page.tsx`        | Clinic staff list with roles                                                 |

### 5b. Sidebar menu update

Update `REGISTRY.owner` in `src/lib/permissionMenu.ts` -- replace the placeholder "Medical" section with Clinic section (see plan implementation).

### 5c. API calls

Add functions in `app/owner/_lib/ownerApi.ts` for clinic branches, settings, services, and staff (see plan implementation).

---

## 6. Rollout Strategy

### Phase 1A: Backend (no UI changes yet)

1. Add `clinicSettingsJson` migration
2. Register new permissions in seeds
3. Add `ownerClinic.controller.ts` + `ownerClinic.service.ts`
4. Mount routes in `owner.routes.ts`
5. Test with curl / Postman

### Phase 1B: Frontend (Owner Panel)

1. Add owner API functions in `ownerApi.ts`
2. Create clinic overview page
3. Create clinic branch detail + settings pages
4. Create clinic services CRUD pages
5. Create clinic staff view page
6. Update sidebar menu

### Phase 1C: Integration

1. Verify BranchForm already supports CLINIC type selection (it does)
2. Ensure new clinic pages only render for branches with CLINIC type
3. Cross-link: Owner clinic overview -> Staff branch dashboard

---

## 7. Files Changed in Execution Phase

### Backend

| File                                                                  | Change type                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| `prisma/schema.prisma`                                                | ADD `clinicSettingsJson` to Branch model                      |
| `prisma/migrations/YYYYMMDD_add_clinic_settings/migration.sql`        | NEW migration                                                 |
| `src/api/v1/modules/owner/owner.routes.ts`                            | EDIT: mount clinic routes                                     |
| `src/api/v1/modules/owner/ownerClinic.controller.ts`                  | NEW                                                           |
| `src/api/v1/modules/owner/ownerClinic.service.ts`                     | NEW                                                           |
| `src/seeds/seedRolesPermissions.ts`                                   | EDIT: add clinic permissions to roles                         |
| `src/api/v1/modules/admin_permissions/permissionsRegistry.service.ts` | EDIT: register new clinic permissions                         |
| `src/api/v1/utils/branchRoles.ts`                                     | EDIT: add clinic permissions to CLINIC_STAFF / BRANCH_MANAGER |

### Frontend

| File                                                         | Change type                                           |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| `src/lib/permissionMenu.ts`                                  | EDIT: replace Medical placeholder with Clinic section |
| `app/owner/_lib/ownerApi.ts`                                 | EDIT: add clinic API functions                        |
| `app/owner/(larkon)/clinic/page.tsx`                         | NEW: clinic branches overview                         |
| `app/owner/(larkon)/clinic/[branchId]/page.tsx`              | NEW: clinic branch dashboard                          |
| `app/owner/(larkon)/clinic/[branchId]/settings/page.tsx`     | NEW: clinic settings form                             |
| `app/owner/(larkon)/clinic/[branchId]/services/page.tsx`     | NEW: services CRUD                                    |
| `app/owner/(larkon)/clinic/[branchId]/services/new/page.tsx` | NEW: create service form                              |
| `app/owner/(larkon)/clinic/[branchId]/staff/page.tsx`        | NEW: clinic staff list                                |

---

## 8. QA Checklist

- Branch with type CLINIC appears in `/owner/clinic` overview
- Branch without CLINIC type does NOT appear
- Clinic settings can be saved and retrieved
- Service CRUD works: create, list, edit, delete
- Service categories match enum: CONSULTATION, VACCINATION, SURGERY, GROOMING, BOARDING, DIAGNOSTICS, EMERGENCY, OTHER
- Clinic staff list shows correct members with roles
- Sidebar "Clinic" section only visible when owner has clinic branches
- Permissions guard: non-owner cannot access `/owner/clinic/*` routes
- Existing branch creation flow still works (BranchForm type selector)
- Existing services module (`/api/v1/services`) unaffected
- No breaking changes to Clinic Panel (port 3102) or Staff Panel
- Migration is reversible (JSON column with default)
- All existing tests still pass

---

## 9. Step-by-Step Execution Checklist

1. **Create plan doc** -- `docs/clinic/CLINIC_SETUP_STRUCTURE_PLAN.md`
2. **Migration** -- Add `clinicSettingsJson` to Branch
3. **Permissions seed** -- Register `clinic.settings.read`, `clinic.settings.write`, `clinic.services.manage`, `clinic.overview.read`
4. **Backend service** -- Create `ownerClinic.service.ts` with business logic
5. **Backend controller** -- Create `ownerClinic.controller.ts` with route handlers
6. **Mount routes** -- Add clinic routes to `owner.routes.ts`
7. **Backend smoke test** -- Verify with curl
8. **Frontend API layer** -- Add functions to `ownerApi.ts`
9. **Clinic overview page** -- `/owner/clinic`
10. **Clinic branch detail page** -- `/owner/clinic/[branchId]`
11. **Clinic settings page** -- `/owner/clinic/[branchId]/settings`
12. **Clinic services pages** -- List + Create
13. **Clinic staff page** -- `/owner/clinic/[branchId]/staff`
14. **Sidebar update** -- Replace Medical placeholder with Clinic
15. **QA pass** -- Run through checklist above
16. **Commit and tag** -- `clinic-setup-v1.0.0`
