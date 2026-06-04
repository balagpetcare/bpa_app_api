# Owner Staff Invitation — Branch-Type RBAC Verification Summary

**Path:** `docs/OWNER_STAFF_INVITATION_BRANCH_TYPE_RBAC_VERIFICATION_SUMMARY.md`
**Related plan:** `docs/OWNER_STAFF_INVITATION_BRANCH_TYPE_RBAC_MASTER_PLAN.md`
**Verification date:** 2026-04-08
**Method:** Static code-path review, consistency checks, targeted script execution (no full E2E browser run in this pass).

---

## 1. Executive outcome

| Area | Result |
|------|--------|
| Single source of truth for branch → invite roles | **Pass** — `src/api/v1/constants/branchRoleMatrix.ts` |
| Backend enforcement on invite create | **Pass** — `createStaffInvite` → `canInviteRole` |
| Backend enforcement on direct member add/update | **Pass** — `canInviteRole("OWNER", …)` |
| Backend enforcement on invitation role edit | **Pass** — `updateOwnerInvitation` for `BRANCH` targets |
| Owner UI role list vs backend | **Pass** — `GET .../invite-allowed-roles` + optional `roleLabels` (hardening) |
| Existing `MemberRole` rows | **Pass** — migration is add-only enum values |
| Duplicate matrix in unified orchestration | **Resolved** — delegates to `branchRoleMatrix` |
| Warehouse-only roles on branch invite | **Pass** — not in matrix; warehouse flow uses `WarehouseStaffRole` |

---

## 2. Scenarios reviewed (code-path analysis)

### 2.1 Branch invite creation

| Step | Path | Finding |
|------|------|---------|
| Owner POST invite | `owner.controller.inviteBranchMember` → `createStaffInvite` | **Pass** — validates via `canInviteRole`; inviter passed as `"OWNER"` (see risks). |
| Manager POST invite | `branches.controller.inviteBranchMember` → `createStaffInvite` | **Pass** — `inviterRole` from org owner / member role; manager subset enforced in matrix. |
| Invalid role | `canInviteRole` | **Pass** — throws `Invalid role for this branch type` or manager-specific message. |
| Unknown / empty branch types | `getAllowedInviteRolesForBranch` | **Pass** — falls back to `DEFAULT_ALLOWED_ROLES` (shop-like). |
| Multi-type branch | Union of roles per linked type + aliases | **Pass** — implemented in matrix. |

### 2.2 Role discovery for UI

| Step | Path | Finding |
|------|------|---------|
| Owner panel dropdown | `GET /api/v1/owner/branches/:id/members/invite-allowed-roles` | **Pass** — uses `getEffectiveBranchIdsForOwnerPanel` (consistent with branch list visibility). |
| Response shape | `allowedRoles`, `primaryBranchTypeCode`, `roleLabels` | **Pass** — labels from `labelsForInviteRoles` / `INVITE_ROLE_LABELS` (reduces label drift). |
| Staff app / generic client | `GET /api/v1/branches/:branchId/members/invite-allowed-roles` | **Pass** — still uses `getInviteableRolesForInviter` (unchanged contract). |

### 2.3 Direct membership (non-invite)

| Step | Path | Finding |
|------|------|---------|
| POST member | `addBranchMember` | **Pass** — matrix validation, normalized role stored. |
| PATCH member role | `updateBranchMember` | **Pass** — same validation + normalized role. |

### 2.4 Invitation lifecycle edits

| Step | Path | Finding |
|------|------|---------|
| PATCH invitation role | `updateOwnerInvitation` | **Pass** — validates when `targetType === BRANCH"` and `branchId` set. |
| Warehouse-target invites | `updateOwnerInvitation` | **N/A** — branch `role` validation skipped (warehouse uses `warehouseRole`; separate validation elsewhere). |

### 2.5 Accept / access permission

| Step | Path | Finding |
|------|------|---------|
| `BranchAccessPermission.role` for new enum values | `auth.controller` `memberRoleForBranchAccessPermission` | **Pass** — extended set includes new `MemberRole` values. |
| Staff dashboard permissions | `branchRoles.ts` `BRANCH_ROLE_PERMISSIONS` | **Pass** — entries for `DOCTOR`, `PHARMACIST`, service staff roles. |

### 2.6 Seeding & data model

| Step | Path | Finding |
|------|------|---------|
| Branch type aliases | `seedBranchTypes.ts` | **Pass** — idempotent upserts for legacy/alias codes. |
| RBAC role rows | `seedRolesPermissions.ts` | **Pass** — `DOCTOR`, `PHARMACIST`, `GROOMING_STAFF`, `BOARDING_STAFF`, `TRAINING_STAFF`; existing clinic roles retained. |
| Prisma enum | `MemberRole` + migration `20260408180000_member_role_branch_invite_rbac` | **Pass** — add-only `ALTER TYPE ... ADD VALUE`. |

### 2.7 Regression / dead code

| Check | Finding |
|-------|---------|
| Legacy `isRoleAllowedForBranch` in `owner.controller` | **Removed** (no duplicate path). |
| Second role matrix in `unifiedStaffOrchestration.service` | **Removed** — uses `branchRoleMatrix`. |
| Frontend duplicate `ROLES_BY_BRANCH_TYPE` for default owner flow | **Removed** — API-driven list. |
| `BRANCH_TYPE_CODES` in matrix vs usage | **Note** — informational constant; lookup is map-driven + aliases. |

### 2.8 Automated check executed

| Check | Result |
|-------|--------|
| `npx ts-node src/api/v1/constants/branchRoleMatrix.test.ts` | **Pass** (warehouse DC, pharmacy, clinic, invalid cross-type). |

---

## 3. Pass / fail summary

- **Pass:** Core invite validation, member add/update, invitation role edit (branch), owner + manager invite paths, multi-type union, alias normalization, seed/migration design, staff permission maps, matrix test script.
- **Fail:** None identified in reviewed paths.
- **Partial / follow-up:** See section 5.

---

## 4. Unresolved risks

1. **Owner route inviter role hardcoded** — `inviteBranchMember` always passes `"OWNER"` into `createStaffInvite`. Any authenticated owner-panel user who can hit this route gets owner-level *matrix* rules (all roles allowed for branch type), even if they are delegated staff. **Mitigation:** Tighten by resolving real inviter role (owner vs `BRANCH_MANAGER` / `ORG_ADMIN`) and calling `canInviteRole(actualInviterRole, …)`.
2. **Branch access on invite POST** — `createStaffInvite` loads branch by id only; authorization is route/middleware dependent. Ensure no IDOR for non-owner callers on owner routes (out of scope for this verification pass; confirm `ownerPanelGuard` + org checks on `branchId`).
3. **Enum migration idempotency** — PostgreSQL `ALTER TYPE ... ADD VALUE` is not re-runnable if values already exist. **Mitigation:** one-time deploy; document rollback as rare/custom.
4. **Branches with no `BranchType` links** — Default shop-like roles apply; may be wrong for misconfigured data. **Mitigation:** data quality / admin UI to require types.
5. **Full `tsc` / CI** — Repo-wide TypeScript may still report unrelated errors; verify CI green on your branch before release.

---

## 5. Recommended follow-up tasks

1. Implement **dynamic inviter role** for `POST /owner/branches/:id/members/invite` (and optionally align `invite-allowed-roles` with `getInviteableRolesForInviter(actualInviter, branch)` for non-owners).
2. Optionally return **`roleLabels`** from `GET /api/v1/branches/:branchId/members/invite-allowed-roles` for staff-app parity with owner endpoint.
3. Add **integration tests** (HTTP) for: invite allowed roles, invite create 400 on bad role, member add 400 on bad role.
4. Run **manual QA** (checklist below) on staging after `migrate deploy` + seed.
5. Audit **repairWarehouseStaffAccess** / scripts that cast `WarehouseStaffRole` → `MemberRole` (pre-existing type issues).

---

## 6. Seed / migration order (production)

1. **`npx prisma migrate deploy`** — applies `20260408180000_member_role_branch_invite_rbac` (and any pending migrations).
2. **`npx prisma generate`** — client must include new enum members.
3. **`node scripts/check-migration-integrity.js`** — per `PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`.
4. **Seed (idempotent)** — at minimum:
   - `seedBranchTypes` (alias types),
   - `seedRolesPermissions` (new role keys + permissions).
5. **Smoke-test** invite + accept on a non-production org before full rollout.

**Order rationale:** DB enum must exist before runtime writes of new roles; Prisma client must match schema; seeds upsert permissions/roles without removing existing staff.

---

## 7. Manual browser QA checklist (example routes)

Assume owner panel base `http://localhost:3104` (or your WowDash port); API `3000` with cookies/proxy as configured.

| # | Action | Route / API | Expected |
|---|--------|-------------|----------|
| 1 | Open invite form | `/owner/staffs/new` | Branch list loads; types visible on branch chips if returned. |
| 2 | Select **WAREHOUSE_DC** branch | Same | Role dropdown loads (not stuck on “Loading…”); includes `WAREHOUSE_MANAGER`, `RECEIVING_STAFF`, etc.; not `INVENTORY_CONTROLLER` unless passed via `allowedRoles` prop. |
| 3 | Select **PHARMACY_DIAGNOSTICS** branch | Same | Includes `PHARMACIST`, `CLINIC_INVENTORY_STAFF`. |
| 4 | Select **CLINIC** branch | Same | Includes `DOCTOR`, `CLINIC_STAFF`, `CLINIC_RECEPTION`. |
| 5 | Submit valid invite | POST `/api/v1/owner/branches/:id/members/invite` | 201 (or 200 existing pending); no `Invalid role for this branch type`. |
| 6 | DevTools: POST invite with invalid role | Same, body `role: "WAREHOUSE_MANAGER"` on clinic-only branch | **400** with clear message. |
| 7 | GET allowed roles | `/api/v1/owner/branches/:id/members/invite-allowed-roles` | `success`, `data.allowedRoles` array, `data.roleLabels` object. |
| 8 | Invitation list / edit | `/owner/invitations` or `/owner/invitations/[id]/edit` | Change role to invalid type → **400** (branch invites). |
| 9 | Register / accept invite | `/register?invite=…` | Completes; `BranchMember.role` matches invite. |
| 10 | Staff login | `/staff/...` for that branch | Sidebar/permissions consistent with `branchRoles` entry for role. |

---

## 8. Final verification sign-off

- **Code-path review:** Completed (this document).
- **Hardening applied in this pass:** Server-side `roleLabels` on owner `invite-allowed-roles` response; frontend prefers server labels over local map.
- **Production readiness:** **Ready** after migrate + generate + integrity check + seed + manual QA above; address risk (1) before treating delegated-owner-panel invites as fully least-privilege.

---

*Updated: `docs/OWNER_STAFF_INVITATION_BRANCH_TYPE_RBAC_VERIFICATION_SUMMARY.md`*
