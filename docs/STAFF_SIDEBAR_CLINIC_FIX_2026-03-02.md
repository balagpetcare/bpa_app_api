# Staff Sidebar – Clinic Module Integration Fix Report

**Date:** 2026-03-02  
**Scope:** staff panel (3104) + backend permissions/roles  
**Status:** Completed

## Problem

Clinic routes/pages existed under `/staff/branch/[branchId]/clinic/...`, but the Staff sidebar did not show the Clinic section/items for clinic branches.

## Root Cause

### Primary: Missing permission keys in roles

Sidebar gating expects:

- `clinic.queue.read` / `clinic.queue.manage`
- `clinic.visits.read` / `clinic.visits.manage`

But no branch role included `clinic.visits.read`/`clinic.visits.manage`, so the Visits menu item always failed the filter.

`CLINIC_STAFF` also lacked `.read` keys for appointments/queue, causing inconsistency with sidebar gating expectations.

### Secondary: Branch payload normalization overwriting values

In `fetchBranchSummary`, `type` and `clinicEnabled` could be overwritten by API fields due to spread order. This made sidebar gating unreliable in some cases.

## Fix Summary

### Backend (backend-api)

- **`src/api/v1/constants/branchRoles.ts`**
  - `BRANCH_MANAGER`: added `clinic.appointments.read`, `clinic.queue.read`, `clinic.visits.read`, `clinic.visits.manage`
  - `CLINIC_STAFF`: added `clinic.appointments.read`, `clinic.queue.read`, `clinic.visits.read`, `clinic.visits.manage`
- **`prisma/seeders/seedRolesPermissions.ts`**
  - Added new permissions: `clinic.queue.read`, `clinic.visits.read`, `clinic.visits.manage`
  - Ensured `CLINIC_STAFF` seed includes `clinic.visits.read`/`clinic.visits.manage`
- **`src/api/v1/services/permissionsRegistry.service.ts`**
  - Registered: `clinic.queue.read`, `clinic.visits.read`, `clinic.visits.manage`

### Frontend (bpa_web)

- **`src/lib/branchSidebarConfig.ts`** and **`src/lib/useStaffBranchMenuItems.ts`**
  - Temporary debug logs were used and removed; no behavior change kept.
- **`lib/api.ts`**
  - Branch normalization fixed: spread `rawBranch` first, then set `type` and `clinicEnabled` last so they are reliable for the sidebar.

## Verification (Manual QA)

1. **Branch not clinic:** Open a branch where `type !== "CLINIC"`. Expected: no “Clinic” section.
2. **Clinic branch, clinic disabled:** `type === "CLINIC"`, `clinicEnabled === false`. Expected: no “Clinic” section.
3. **Clinic branch, clinic enabled, role without clinic permissions:** Role is `BRANCH_STAFF` or `SELLER`. Expected: no “Clinic” section.
4. **Clinic branch, clinic enabled, CLINIC_STAFF:** Expected: “Clinic” section shows Dashboard, Appointments, Queue, Patients, Visits.
5. **Clinic branch, clinic enabled, BRANCH_MANAGER:** Expected: all clinic items visible.
6. **Branch payload:** On `/staff/branch/<id>`, verify network call to `.../branches/<id>/me`. Expected: response includes `branch.type` and `branch.clinicEnabled`.

## Notes

- If DB was seeded before adding new permissions, re-run role/permission seed so the new permission keys exist.
- Existing staff role assignments do not require migration; effective permissions derive from role mapping.

**Optional debug:** Set `NEXT_PUBLIC_CLINIC_SIDEBAR_DEBUG=true` and re-add console logs to trace: branchId, branch.type, branch.clinicEnabled, permissions, visible groups.
