# Staff Clinic Integration Standard

This document describes how branch staff (Branch Manager and Clinic Staff) use the clinic area in the Staff Panel, the role/permission matrix, Owner vs Staff API split, and permission-guard policy.

See also: [APPOINTMENT_QUEUE_STANDARD.md](./APPOINTMENT_QUEUE_STANDARD.md) for appointment/queue/visit lifecycles and API details.

---

## 1. Overview

- **Staff App**: `http://localhost:3104/staff` (same Next.js app as Owner; port 3104). User selects a branch → `/staff/branch/[branchId]` → Clinic section is shown when the branch has **clinicEnabled** true and the user has at least one `clinic.*` permission (branch type is normalized to CLINIC when clinic is enabled).
- **Clinic sidebar** (Staff branch): Dashboard, Appointments, Queue, Patients, Visits. Each item is gated by the corresponding permission (e.g. `clinic.overview.read` for Dashboard, `clinic.appointments.read`/manage for Appointments).
- **Backend**:
  - **Staff Clinic API** (`/api/v1/clinic/branches/:branchId/...`): Slots, appointments, queue, patients, visits/EMR, prescriptions, lab, billing, dashboard. Uses `requireClinicPermission` middleware; permissions come from `resolveBranchAccessProfile` (BranchAccessPermission + BranchMember role → BRANCH_ROLE_PERMISSIONS + permissionOverrides).
  - **Owner Clinic API** (`/api/v1/owner/clinic/branches/:branchId/...`): Settings, services, staff profiles, rooms, schedule, holidays, fees, appointment CRUD. Owner authentication only.

---

## 2. Role matrix (Branch Manager vs Clinic Staff)

| Role | Clinic sidebar / operations | Notes |
|------|-----------------------------|--------|
| **BRANCH_MANAGER** | Full access: Dashboard, Appointments, Queue, Patients, Visits, EMR, Prescription, Settings read/write, Staff manage | Clinic setup is done from Owner Panel; day-to-day operations from Staff Panel. |
| **CLINIC_STAFF** | Appointments, Queue, Patients, Visits, EMR, Prescription (read/manage as configured) | No settings/rooms/staff manage; operational only. |
| **SELLER / BRANCH_STAFF / DELIVERY_*** | Clinic section not shown | No clinic permissions. |

- **Branch Manager**: Configures clinic (services, rooms, staff profiles, schedule) from Owner Panel; runs daily operations (appointments, queue, patients, visits) from Staff Panel.
- **Clinic Staff**: Only operations (appointments, queue, patients, visits, prescriptions). No access to clinic setup; Owner/Branch Manager assigns role and overrides via Owner Panel.

---

## 3. Staff Panel clinic flow

1. Staff logs in → selects branch (must have APPROVED BranchAccessPermission for that branch).
2. If branch is CLINIC and clinicEnabled, and user has any `clinic.*` permission, the **Clinic** group appears in the branch sidebar.
3. Layout `/staff/branch/[branchId]/clinic`:
   - Ensures branch type is CLINIC and clinicEnabled.
   - Ensures user has at least one `clinic.*` permission; otherwise shows AccessDenied.
4. Each clinic sub-page (dashboard, appointments, queue, patients, visits) checks the relevant permission(s). If the user lacks that permission, the page shows AccessDenied and a back link to clinic (or branch).
5. All data calls go to `/api/v1/clinic/branches/:branchId/...`, which enforces the same permissions server-side.

---

## 4. Owner vs Staff API split

| Concern | Owner API | Staff API |
|--------|-----------|-----------|
| Clinic enable/disable (module) | PATCH `/owner/clinic/branches/:id/modules/clinic` | — |
| Settings, services, rooms, schedule, holidays, fees, emergency policy | GET/PUT under `/owner/clinic/branches/:id/` | — (optional future: read-only under `/clinic/branches/:id/`) |
| Staff profiles, assign template, permission overrides | GET/PUT/POST/PATCH under `/owner/clinic/branches/:id/staff/...` | — |
| Appointments (list, create, cancel, reschedule, check-in, no-show) | Owner routes exist | Same operations under `/clinic/branches/:id/appointments` |
| Queue (session, tickets, call next, etc.) | — | `/clinic/branches/:id/queue/...` |
| Patients, visits, EMR, prescriptions, lab, billing, dashboard | — | `/clinic/branches/:id/...` |

Staff never call Owner routes; they use only the Staff Clinic API. Owner (or Branch Manager via Owner Panel) configures clinic; staff perform daily operations via Staff Panel and Staff Clinic API.

---

## 5. Permission guard policy

- **Layout** (`/staff/branch/[branchId]/clinic/layout.jsx`): User must have at least one permission that starts with `clinic.`. Otherwise: AccessDenied, back to branch dashboard.
- **Per-page guards** (dashboard, appointments, queue, patients, visits): Each page requires one of the permissions that the sidebar uses for that item (e.g. dashboard → `clinic.overview.read` or `clinic.overview.manage`; visits → `clinic.visits.read` or `clinic.visits.manage` or EMR read/write). If the user lacks the required permission, show AccessDenied and link back to clinic (or branch).
- **Backend**: Every Staff Clinic route uses `requireClinicPermission(...)`. No route is accessible without the appropriate permission and APPROVED branch access.

This ensures that direct URL access to a clinic page without permission still shows AccessDenied (no flash of content before API 403).

---

## 6. Touchpoints (implementation reference)

| File / area | Purpose |
|-------------|---------|
| `bpa_web/app/staff/.../clinic/layout.jsx` | Branch type, clinicEnabled, and any `clinic.*` permission |
| `bpa_web/app/staff/.../clinic/dashboard/page.jsx` | clinic.overview.read or clinic.overview.manage |
| `bpa_web/app/staff/.../clinic/appointments/page.jsx` | clinic.appointments.read or clinic.appointments.manage |
| `bpa_web/app/staff/.../clinic/queue/page.jsx` | clinic.queue.read or clinic.queue.manage |
| `bpa_web/app/staff/.../clinic/patients/page.jsx` | clinic.patients.read or clinic.patients.manage |
| `bpa_web/app/staff/.../clinic/visits/page.jsx` | clinic.visits.read/manage or clinic.emr.read/write |
| `bpa_web/src/lib/branchSidebarConfig.ts` | Clinic group and items with requiredPerm / anyPerms |
| `backend-api/src/api/v1/constants/branchRoles.ts` | BRANCH_ROLE_PERMISSIONS, CLINIC_ROLE_TEMPLATE_PERMISSIONS |
| `backend-api/src/api/v1/modules/clinic/clinic.middleware.ts` | requireClinicPermission, branch + clinicEnabled check |

---

## 7. Troubleshooting: Clinic option not visible in Staff Panel

If the Clinic section or links do not appear for a staff user on a branch:

1. **Clinic enabled for branch**  
   Owner must enable the Clinic module for that branch: Owner Panel → Clinic → select branch → Settings (or module toggle) → enable clinic. The branch’s `featuresJson.clinicEnabled` must be `true`. The API `GET /api/v1/branches/:id/me` returns `clinicEnabled` and normalizes `type` to `CLINIC` when clinic is enabled.

2. **User has clinic permissions**  
   The staff user must have at least one `clinic.*` permission for that branch. That is granted by:
   - **Role**: Assign the user **BRANCH_MANAGER** or **CLINIC_STAFF** for that branch (Owner Panel → Staff / Branch access, or Clinic → branch → Staff).  
   - **Overrides**: Owner can add clinic permission overrides for a branch member (Owner Panel → Clinic → branch → Staff → member → Permissions).

3. **Branch access approved**  
   The user must have **APPROVED** `BranchAccessPermission` for that branch. If access is PENDING or REVOKED, they cannot see branch dashboard or clinic.

After enabling clinic for the branch and ensuring the user has a clinic role (or overrides), refresh the Staff Panel or re-open the branch; the Clinic group and its items should appear in the sidebar when the user has the corresponding permissions.
