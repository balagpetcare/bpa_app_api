# Sidebar Permission Guardrail

## Purpose

Ensure **role/permission ↔ sidebar gating consistency**: every permission key referenced by the staff branch sidebar is (1) registered in the permissions registry and (2) for clinic items, present in at least one clinic context role (CLINIC_STAFF or BRANCH_MANAGER).

## Source of truth

- **Sidebar config:** `bpa_web/src/lib/branchSidebarConfig.ts` (`BRANCH_SIDEBAR[].items[].requiredPerm` and `anyPerms`).
- **Canonical key list:** `backend-api/src/api/v1/constants/sidebarPermissionKeys.ts` (must be kept in sync with branchSidebarConfig when adding/removing sidebar items or permission keys).
- **Registry:** `backend-api/src/api/v1/services/permissionsRegistry.service.ts` (`REGISTRY`).
- **Role mappings:** `backend-api/src/api/v1/constants/branchRoles.ts` (`BRANCH_ROLE_PERMISSIONS`).

## Scan results (initial)

### Sidebar keys collected (branchSidebarConfig)

All keys from `requiredPerm` and `anyPerms`:

- **Overview:** dashboard.view, tasks.view, approvals.view
- **Operations:** inventory.read, inventory.receive, inventory.adjust, inventory.transfer, pos.view, customers.view
- **Clinic:** clinic.overview.read, clinic.overview.manage, clinic.appointments.read, clinic.appointments.manage, clinic.queue.read, clinic.queue.manage, clinic.patients.read, clinic.patients.manage, clinic.visits.read, clinic.visits.manage
- **People:** staff.view
- **Analytics:** reports.view

### Missing keys (before fixes)

- **Registry:** dashboard.view, tasks.view, approvals.view, inventory.receive, inventory.adjust, inventory.transfer, pos.view, customers.view, staff.view, reports.view, clinic.overview.manage were not in the registry.
- **Clinic roles:** clinic.overview.manage was not in CLINIC_STAFF or BRANCH_MANAGER.

### Unreachable sidebar items

- **Clinic Dashboard:** could be unreachable for users who only had clinic.overview.manage (e.g. from overrides) if no role granted it; BRANCH_MANAGER now includes clinic.overview.manage so the item is reachable.

## Proposed patch list (implemented)

1. **backend-api/src/api/v1/constants/sidebarPermissionKeys.ts** (new) – Canonical list of branch sidebar and clinic-only permission keys.
2. **backend-api/src/api/v1/constants/sidebarPermissionKeys.test.ts** (new) – Guardrail tests: all sidebar keys in registry, all clinic keys in at least one clinic role.
3. **backend-api/src/api/v1/services/permissionsRegistry.service.ts** – Add missing keys: dashboard.view, tasks.view, approvals.view, inventory.receive, inventory.adjust, inventory.transfer, pos.view, customers.view, staff.view, reports.view, clinic.overview.manage; add group "Staff Branch" and GROUP_ORDER entry.
4. **backend-api/src/api/v1/constants/branchRoles.ts** – Add clinic.overview.manage to BRANCH_MANAGER so Clinic Dashboard is reachable.

## Running the guardrail

```bash
cd backend-api
npm test -- src/api/v1/constants/sidebarPermissionKeys.test.ts
```

When adding a new sidebar item or permission in `branchSidebarConfig.ts`, update `sidebarPermissionKeys.ts` and (if needed) the registry and role mappings so the test stays green.
