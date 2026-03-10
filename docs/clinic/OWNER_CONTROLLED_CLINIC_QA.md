# Owner-Controlled Clinic — QA and Admin Override

## Owner (3104) — Primary Control

- **Enable/disable clinic module**: Owner uses Clinic branch Settings page; "Enable Clinic Module" toggle calls `PATCH /api/v1/owner/clinic/branches/:branchId/modules/clinic` with `{ enabled: true|false }`. Only owner (via `clinic.settings.write`) can call this.
- **Clinic permission grant**: Owner assigns role templates via existing "Assign template" or updates clinic-only permission overrides via `PATCH /api/v1/owner/clinic/branches/:branchId/staff/:memberId/permissions` with `{ permissionOverrides: string[] }` (only keys starting with `clinic.` are applied).

## Staff Portal (3104 Staff Branch)

- When `featuresJson.clinicEnabled` is **false**: All `/api/v1/clinic/branches/:branchId/*` routes return **403** with `code: "CLINIC_MODULE_DISABLED"` and message "Clinic module is disabled for this branch. Owner can enable it in branch settings."
- Staff sidebar clinic group is hidden when clinic is disabled (or when branch summary reports `clinicEnabled: false`).
- Direct URL to `/staff/branch/:branchId/clinic/*` shows a "Disabled by owner" banner and does not call clinic APIs when disabled.

## Admin (3103) — Emergency Override

- **Branch features**: Admin can change any branch's `featuresJson` (including `clinicEnabled`) via **PATCH /api/v1/admin/branches/:id** with `featuresJson: { ...existing, clinicEnabled: true|false }`. This is for emergency override only; normal control is Owner.
- **Response messages**: Backend 403 for clinic routes use `CLINIC_MODULE_DISABLED` when the module is off; permission-denied uses `BRANCH_ACCESS_DENIED` and may include `requiredPermission` in the response body for UX.

## Branch Isolation

- Every clinic check is scoped by `orgId` and `branchId`. Owner endpoints use `getEffectiveBranchIdsForOwnerPanel`; staff clinic middleware uses `resolveBranchAccessProfile` and branch `featuresJson`.

## Verification Checklist

- [ ] **Owner toggle**: Owner (3104) opens Clinic → Branch → Settings; toggles "Enable Clinic Module" off → staff sidebar clinic group disappears; toggles on → clinic group appears. No regressions in other owner clinic settings.
- [ ] **Permission grant**: Owner assigns clinic role template to a staff member; staff can access clinic pages when module is enabled and has required permission.
- [ ] **Direct URL when disabled**: With clinic disabled, staff opens `/staff/branch/:id/clinic/dashboard` directly → "Clinic module disabled" message and Back/Select Branch. No clinic API success.
- [ ] **API 403 when disabled**: With clinic disabled, any call to `/api/v1/clinic/branches/:id/*` or staff clinic queue/appointments returns 403 with `code: "CLINIC_MODULE_DISABLED"`.
- [ ] **Branch isolation**: Staff in branch A cannot see or operate clinic for branch B. Owner sees only their org’s clinic branches.
- [ ] **Admin override**: Admin (3103) edits branch features and sets `clinicEnabled: true`; staff can use clinic without owner having enabled it (emergency override).
