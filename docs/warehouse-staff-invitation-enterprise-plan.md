# Warehouse Staff Invitation Enterprise Plan

## Executive Summary

Warehouse staff onboarding currently uses manual assignment (`targetUserId` + `role`) on the warehouse staff page and warehouse APIs. Branch staff onboarding already has a mature invitation lifecycle using `staff_invites`, token verification/acceptance, owner invitation management, and branch membership creation.

Recommended direction: **reuse the existing branch invitation architecture (`StaffInvite` + auth invite verify/accept + owner invitation management) with minimal, targeted extension for warehouse assignment**. Do not create a second invitation platform. Extend the current model to support a target entity type for warehouse and create a post-accept assignment into `warehouse_staff_assignments`.

This keeps behavior consistent with branch staff invite flows, remains multi-tenant safe, reuses existing frontend and backend patterns, and avoids duplicated lifecycle logic.

## Current Branch Invitation Audit

### 1) Frontend pages/components

- `bpa_web/app/owner/(larkon)/staffs/new/page.jsx`
  - Main invitation create UI.
  - Sends invite to `/api/v1/owner/branches/:branchId/members/invite`.
  - Supports branch-based role selection and optional invite-as-doctor behavior.
- `bpa_web/app/owner/(larkon)/staffs/page.jsx`
  - Unified staff table that mixes active members + pending/expired/revoked invites.
  - Supports resend, reinvite, cancel, edit, and invite detail navigation.
- `bpa_web/app/owner/(larkon)/invitations/[id]/page.jsx`
  - Invitation detail with action buttons: resend/reinvite/cancel.
- `bpa_web/app/owner/(larkon)/invitations/[id]/edit/page.jsx`
  - Editable fields before acceptance/revocation.
- `bpa_web/app/owner/(larkon)/branches/[id]/staff/page.jsx`
  - Branch team page with quick link to invite flow.

### 2) API client functions

- `bpa_web/app/owner/_lib/ownerApi.ts` exposes invitation operations:
  - list/get/update invitation
  - resend/reinvite/cancel invitation
- Staff list page consumes `/api/v1/owner/staffs` and invitation routes.

### 3) Backend routes/controllers/services

- Routes:
  - `/api/v1/owner/branches/:id/members/invite` (owner flow)
  - `/api/v1/branches/:branchId/members/invite` (branch/manager flow)
  - `/api/v1/owner/invitations/*` (owner invitation management)
  - `/api/v1/auth/invites/verify`, `/api/v1/auth/invites/accept` (public verify/accept)
- Services:
  - `src/api/v1/services/staffInvite.service.ts`
  - create, resend, reinvite, cancel, audit logging, notification delivery.

### 4) DTO/validation schema

- No centralized DTO class found for branch staff invites; validation is controller/service-level:
  - require role
  - require email or phone
  - role eligibility check via `branchRoleMatrix`
  - duplicate pending invite checks.

### 5) Database models and relations

- `StaffInvite` (`staff_invites`) stores invitation state and token metadata.
- `BranchMember` stores accepted staff assignment in branch scope.
- Invite references:
  - inviter (`invitedByUserId`)
  - acceptor (`acceptedByUserId`)
  - org and branch.

### 6) Invitation token/lifecycle

- Token hash is stored, raw token is not persisted.
- Verify endpoint checks status + expiry and can move pending invite -> expired.
- Accept endpoint:
  - creates/links user as needed
  - upserts `BranchMember`
  - marks invite accepted
  - returns authenticated session/token.

### 7) Acceptance + assignment flow

- Acceptance currently materializes into `BranchMember` assignment.
- If doctor flag is enabled, related clinic profile bootstrapping occurs.

### 8) Permission rules + org/branch scoping

- Invite permission based on owner/manager role + branch type + role matrix.
- Role compatibility enforced by `branchRoleMatrix.ts`.
- Owner invitation management is scoped by org ownership.

## Current Warehouse Staff Flow Audit

### Frontend (current)

- `bpa_web/app/owner/(larkon)/warehouse/[id]/staff/page.tsx`
  - Manual add form: `targetUserId` + role dropdown.
  - Calls `warehouseStaffAdd`, `warehouseStaffList`, `warehouseStaffRemove`.
  - No invitation lifecycle.
  - UI role list includes `QC_OFFICER`, `AUDIT_OFFICER`.

### API client (current)

- `bpa_web/lib/api.ts`
  - `warehouseStaffList(warehouseId)`
  - `warehouseStaffAdd(warehouseId, { targetUserId, role })`
  - `warehouseStaffRemove(warehouseId, assignmentId)`

### Backend routes/controller/service (current)

- `src/api/v1/modules/warehouse/warehouse.routes.ts`
  - POST `/:id/staff`, GET `/:id/staff`, DELETE `/:id/staff/:assignmentId`.
- `warehouse.controller.ts`
  - `addStaff` requires org access, validates role against fixed subset.
  - Direct assignment, no invitation.
- `warehouse.service.ts`
  - Writes to `WarehouseStaffAssignment`.
  - soft-removes assignment using `isActive` + `removedAt`.

### DB model (current)

- `WarehouseStaffAssignment` with enum `WarehouseStaffRole`.
- `Warehouse` entity exists and is org-scoped.
- No warehouse invitation table/state/token lifecycle.

### Permission/scoping (current)

- Uses custom org/warehouse access functions in controller.
- Not wired into owner invitation module, and not using invite status model.

## Gap Analysis

- Missing invitation lifecycle in warehouse staff flow:
  - no pending/expired/revoked/accepted states in warehouse UI/API.
  - no token verification/acceptance for warehouse invitations.
  - no resend/reinvite/cancel actions.
- Data model mismatch:
  - branch flow stores pre-accept invite + post-accept assignment.
  - warehouse flow stores assignment only.
- Role mapping inconsistency:
  - warehouse controller currently validates only 4 roles.
  - warehouse UI presents 6 roles.
- Permission handling inconsistency:
  - warehouse endpoints use local access checks, not owner permission middleware conventions used in owner routes.
- UX inconsistency:
  - branch flow has robust invite management pages; warehouse page is manual and low-safety.

## Architecture Decision

### Decision

**Extend existing `StaffInvite` module for warehouse target support; do not build a parallel warehouse-only invite subsystem.**

### Why

- Reuses proven token + lifecycle + notification + audit path.
- Preserves single invitation management surface and shared operational controls.
- Minimizes long-term maintenance and policy drift.

### Can existing invitation module be reused with minimal extension?

**Yes.** Required extensions are scoped and incremental:

- Add target entity support (branch vs warehouse) to `StaffInvite`.
- Extend accept flow to create `WarehouseStaffAssignment` when target is warehouse.
- Extend owner invitation listing/filtering to include warehouse context.
- Reuse existing resend/reinvite/cancel logic with target-aware messaging.

## Entity Target Decision

### Should warehouse be treated as branch-scoped target or separate entity target?

**Separate entity target** within the same invitation module.

- Branch and warehouse assignments persist in different tables with different role enums.
- Forcing warehouse invites into branch semantics would create coupling and edge-case debt.
- Best-fit design: shared invite module + target discriminator.

## Assignment Persistence Decision

### What entity should store assignment after invitation acceptance?

**`WarehouseStaffAssignment`** should remain the canonical warehouse assignment store.

- On accept: upsert/create active assignment for `(warehouseId, userId, role)`.
- Preserve current warehouse workforce reporting and warehouse access controls.

## Role Mapping Strategy

- Warehouse invitation roles should map to `WarehouseStaffRole` enum.
- Support required roles:
  - `WAREHOUSE_MANAGER`
  - `RECEIVING_STAFF`
  - `DISPATCH_STAFF`
  - `INVENTORY_CONTROLLER`
  - `PICKER_PACKER` (or map to closest existing enum role if enum unchanged)
  - `LOADER_SUPPORT` (or map to closest existing enum role if enum unchanged)
- Current enum has `QC_OFFICER`, `AUDIT_OFFICER`; decide one of:
  1. Keep and include them in invite UI options.
  2. Expand enum to include picker/loader roles and retain QC/audit.

Best judgment: **expand enum to include picker/loader and keep existing QC/audit roles** to avoid reducing existing capabilities.

## Owner Permission Model

- Owner and org admin should invite/cancel/reinvite/resend warehouse staff within same org.
- Warehouse manager role may get invite rights only if explicitly configured (optional phase-2).
- Enforce org isolation:
  - inviter must belong to/own invite org.
  - invite target warehouse must belong to same org.
  - acceptance must only materialize assignment for scoped warehouse.

## Invitation Lifecycle and State Machine

Use existing statuses for warehouse invites as well:

- `PENDING` -> invite issued and valid.
- `ACCEPTED` -> consumed and assignment persisted.
- `EXPIRED` -> token past expiry.
- `REVOKED` -> cancelled by owner/admin.

Allowed transitions:

- create -> `PENDING`
- `PENDING` -> `ACCEPTED` (accept endpoint)
- `PENDING` -> `REVOKED` (cancel endpoint)
- `PENDING` -> `EXPIRED` (verify/accept on expired token or cleanup)
- `EXPIRED/REVOKED` -> `PENDING` (reinvite)
- `PENDING` -> `PENDING` (resend with token rotation)

## Target User Flow

1. Owner opens `/owner/warehouse/[warehouseId]/staff`.
2. Clicks Invite Staff (not manual user-id assignment).
3. Enters email/phone, display name, role.
4. System creates pending invite scoped to warehouse.
5. Invite appears in same warehouse staff page (pending card/table) and owner invitation center.
6. Owner can resend/reinvite/cancel.
7. Invitee verifies and accepts link.
8. System creates warehouse assignment and marks invite accepted.
9. Warehouse staff list reflects active assignment.

## Target API Contract

### Create warehouse invite

- `POST /api/v1/owner/warehouse/:warehouseId/staff/invite`
- Body: `{ email?, phone?, displayName?, role }`
- Response: invite metadata + expiry (+ dev token in non-prod).

### List warehouse staff + invites (page payload)

- `GET /api/v1/owner/warehouse/:warehouseId/staff`
- Returns:
  - active/inactive assignments
  - pending/expired/revoked invites for this warehouse.

### Invite actions

- `POST /api/v1/owner/warehouse/:warehouseId/staff/invitations/:inviteId/resend`
- `POST /api/v1/owner/warehouse/:warehouseId/staff/invitations/:inviteId/reinvite`
- `POST /api/v1/owner/warehouse/:warehouseId/staff/invitations/:inviteId/cancel`

### Acceptance (shared)

- Reuse `/api/v1/auth/invites/verify` and `/api/v1/auth/invites/accept`.
- Extend payload resolution to return warehouse target details when invite type is warehouse.

## Target DB / Model Design

### Preferred design (minimal extension)

Extend `StaffInvite`:

- add `targetType` enum: `BRANCH`, `WAREHOUSE`.
- keep `branchId` nullable for branch invites.
- add nullable `warehouseId` for warehouse invites.
- add role storage compatible with both targets:
  - option A: keep `MemberRole` and add `warehouseRole` nullable.
  - option B: replace with neutral string role + validation by target.

Best judgment: **option A** for lower migration risk:
- `role` remains for branch compatibility.
- `warehouseRole` added for warehouse invites.

Constraints/indexes:

- check-like invariant in service layer:
  - `targetType=BRANCH` => `branchId` required, `warehouseId` null.
  - `targetType=WAREHOUSE` => `warehouseId` required, `branchId` null.
- indexes for lookup by `(orgId, targetType, branchId/warehouseId, status)`.

Post-accept persistence:

- Branch target -> `BranchMember` (existing).
- Warehouse target -> `WarehouseStaffAssignment` (new accept branch).

## Permission and Org-Scope Rules

- Invite creation:
  - owner/org-admin only in same org as warehouse.
- Invite action endpoints:
  - same org ownership/admin constraint.
- Accept:
  - token-scoped; assignment only in referenced warehouse.
- List:
  - only users with org owner/admin permissions can list warehouse invites on owner pages.
- No cross-org data leakage in list/detail/action queries.

## Frontend Changes

- Replace manual add flow in `app/owner/(larkon)/warehouse/[id]/staff/page.tsx` with invitation-first UX:
  - invite form (email/phone + role)
  - invitation status list (pending/expired/revoked)
  - resend/reinvite/cancel actions
  - accepted staff list.
- Reuse patterns/components from:
  - `app/owner/(larkon)/staffs/new/page.jsx`
  - `app/owner/(larkon)/staffs/page.jsx`
  - invitation detail/edit components (optionally link to central invitation details).
- Extend `lib/api.ts` with warehouse invite endpoints.

## Backend Changes

- Prisma schema + migration:
  - extend `StaffInvite` for target discriminator and warehouse references.
  - optional enum expansion for additional warehouse roles.
- `staffInvite.service.ts`:
  - target-aware create/resend/reinvite/cancel helpers.
  - message templates include warehouse context.
- `auth.controller.ts` invite verify/accept:
  - recognize warehouse-target invite.
  - on accept, create assignment in `WarehouseStaffAssignment`.
- Owner/warehouse controllers/routes:
  - add warehouse invite routes and list response shape.
- Owner invitation endpoints:
  - remain shared; include target metadata for UI filtering.

## Validation Rules

- Create invite:
  - require at least one contact (`email` or `phone`).
  - validate role belongs to allowed warehouse invite role set.
  - ensure warehouse belongs to inviter org.
  - prevent duplicate active pending invite for same target + contact + role.
- Accept invite:
  - enforce pending status and non-expired token.
  - enforce role/target consistency before assignment.
- Reinvite/resend/cancel:
  - enforce status and org scope.

## Edge Cases

- Invite accepted after staff already manually assigned:
  - make accept path idempotent (upsert assignment).
- Duplicate pending invites for same contact + warehouse:
  - block and return conflict.
- Role changed before acceptance:
  - update invitation role only while non-accepted.
- Warehouse deactivated before acceptance:
  - reject accept with clear domain error.
- Invite accepted after reassignment/removal:
  - reactivate or upsert assignment based on policy.
- Existing user with mismatched email/phone:
  - keep existing verify rules (must match invite identity).

## Error Handling Strategy

- Standardized API response contract:
  - `success: false`, stable `message`, optional code.
- Map expected conditions:
  - 400 validation, 401 unauthorized, 403 forbidden, 404 not found, 409 conflict.
- Do not leak token hashes or sensitive invite internals.
- Preserve non-blocking notification failures (invite persists even if delivery fails).

## Test Plan

### Backend

- Unit tests:
  - role validation by warehouse target.
  - state transitions for resend/reinvite/cancel/accept.
  - org-scope enforcement.
- Integration tests:
  - create -> verify -> accept -> assignment created.
  - expired/revoked token behavior.
  - duplicate prevention.
  - owner list includes warehouse invites.

### Frontend

- Invite create success/error.
- Pending invite action buttons by state.
- Transition from pending invite to active staff after acceptance.
- Filter behavior for invited/expired/cancelled.

### Security

- Cross-org access attempts for all endpoints.
- Invite tampering (wrong target/role/token).

## Rollout Plan

1. Add schema extensions + migration.
2. Ship backend target-aware invite support behind feature flag (`warehouse.staff.invites.enabled`).
3. Add owner warehouse invite UI with dual-read compatibility.
4. Run QA in staging with sample orgs/warehouses.
5. Enable feature flag per org cohort.
6. Deprecate manual `targetUserId` assignment UI path (retain API fallback for emergency admin use if needed).

## Implementation Checklist by File/Module

- Backend schema/migration:
  - `prisma/schema.prisma`
  - new migration under `prisma/migrations/*`
- Backend invite services/controllers:
  - `src/api/v1/services/staffInvite.service.ts`
  - `src/api/v1/modules/auth/auth.controller.ts`
  - `src/api/v1/modules/warehouse/warehouse.controller.ts`
  - `src/api/v1/modules/warehouse/warehouse.routes.ts`
  - `src/api/v1/modules/owner/owner.controller.ts` (shared invitation list payload updates)
- Frontend:
  - `bpa_web/app/owner/(larkon)/warehouse/[id]/staff/page.tsx`
  - `bpa_web/lib/api.ts`
  - optional shared invitation component extraction from owner staff pages.
- Permissions/registry:
  - `src/api/v1/services/permissionsRegistry.service.ts` (if new keys needed)
  - `bpa_web/src/lib/permissionMenu.ts` (if menu access keys updated)

## Implementation Order

1. Data model extension and migration.
2. Service-layer target-aware invitation logic.
3. Verify/accept extension to warehouse assignment.
4. Warehouse invite endpoints.
5. Warehouse staff page UI migration to invitation-first flow.
6. Shared invitation list/detail integration.
7. Tests, rollout flag, staged release.

## Assumptions Resolved by Best Judgment

- Frontend root used for audit is `D:/BPA_Data/bpa_web` (requested `web_app` path is not present).
- Existing branch invitation system is the canonical architecture and should not be duplicated.
- Warehouse invite acceptance should produce `WarehouseStaffAssignment`, not `BranchMember`.
- `StaffInvite` extension is preferable to creating `WarehouseStaffInvite` table.
- Warehouse role set should include required operational roles; enum extension is acceptable and safer than overloading branch `MemberRole`.
- Manual user-id assignment should remain as controlled fallback during rollout, but not primary UX.

---

Updated: `docs/warehouse-staff-invitation-enterprise-plan.md`

## Implemented Outcome (Apr 1, 2026)

### What was implemented

- `StaffInvite` was extended to support warehouse-target invitations (same invitation lifecycle reused).
- Shared auth invite verify/accept flow was extended so warehouse invitations can be verified and accepted without a separate token subsystem.
- Warehouse acceptance now creates/reactivates `WarehouseStaffAssignment` instead of `BranchMember`.
- Warehouse module now exposes invitation endpoints:
  - create invite
  - resend
  - reinvite
  - cancel
  - staff+invite overview
- Warehouse staff page was converted to invitation-first UX with:
  - invite form (email/phone/displayName/role)
  - pending/expired/revoked invitation list + actions
  - assigned staff list
  - loading, empty, success/error, and duplicate-submit safeguards
- Direct raw user-id assignment endpoint was demoted for admin-only emergency use.

### Key implementation notes

- Existing branch invitation architecture was reused (no parallel warehouse invitation module created).
- Existing token verify/accept endpoints remain shared.
- Existing owner invitation center remains compatible; warehouse page uses dedicated warehouse invite APIs.
- Frontend workspace path used for implementation is `D:/BPA_Data/bpa_web` (requested `D:/BPA_Data/web_app` is not present in this workspace).

### Migration status

- Prisma schema updated.
- SQL migration added:
  - `prisma/migrations/20260401143000_staff_invites_warehouse_target/migration.sql`
