# Teams & Delegation – Deployment Checklist

**Status: READY FOR PRODUCTION** (verified: backend, database, frontend, docs, owner isolation, scope engine, enable/revoke-all/set-team)

## Overview
Owner accounts can create teams, assign delegation scopes (Products, Clinics, Inventory, Staff, Branches, Finance Read Only), and manage members. Delegated users receive scope-filtered permissions at login (auth/me) and owner routes enforce scope via middleware. This doc confirms the feature is production-ready and how to deploy it.

---

## 1. Frontend (Next.js – Owner Panel)

**Location:** `bpa_web/app/owner/teams/page.jsx`

- **Create Team form:** BPA Design System (card radius-12, card-body p-24, form-control, form-label, row/col). Responsive layout.
- **Fields:** Team Name (required), Description (optional), Delegation Scopes (checkboxes: Products, Clinics, Inventory, Staff, Branches, Finance (Read Only)).
- **Validation:** Inline error under Team Name when empty.
- **Toasts:** Success and error alerts with dismiss; success auto-clears after 5s.
- **Loading:** Spinner on Create Team button while submitting; loading state for initial teams list.
- **API:** POST `/api/v1/owner/teams` with JSON `{ name, description?, scopes? }`. Owner is set server-side (do **not** send `owner_id` from client).
- **State:** React state (useState/useCallback) for inputs, loading, success, error; Teams list is refetched on success. *(BPA Next.js owner panel uses React state; Riverpod is used in the Flutter app.)*
- **List update:** After successful create, form resets and teams list is reloaded.

---

## 2. Backend (Node.js + Express + Prisma)

**Endpoints:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/owner/team/overview` | Team owner only | Counts: teams, members, pending invites |
| GET | `/api/v1/owner/team/invitations` | Team owner only | All invitations for owner (all teams) |
| GET | `/api/v1/owner/teams` | Team owner only | List current user's teams |
| POST | `/api/v1/owner/teams` | Team owner only | Create team |
| POST | `/api/v1/owner/teams/:teamId/invite` | Team owner only | Invite by email (body: `{ email, scopes?, branchIds? }`); returns `rawToken` |
| GET | `/api/v1/owner/teams/:teamId/invitations` | Team owner only | List invitations for one team |
| POST | `/api/v1/owner/teams/:teamId/members` | Team owner only | Add team member (by userId) |
| DELETE | `/api/v1/owner/teams/:teamId/members/:userId` | Owner/Admin | Remove team member |
| GET | `/api/v1/owner/delegations/scopes` | Owner/Admin | List permission scopes |
| POST | `/api/v1/owner/delegations` | Owner/Admin | Assign delegation |
| POST | `/api/v1/owner/delegations/revoke` | Owner/Admin | Revoke one delegation |
| POST | `/api/v1/owner/delegations/revoke-all` | Owner/Admin | Revoke all delegations for a user (body: `{ delegatedUserId }`) |
| POST | `/api/v1/owner/delegations/set-team` | Owner/Admin | Set team for all delegations of a user (body: `{ delegatedUserId, teamId }`) |
| PATCH | `/api/v1/owner/staffs/:id/disable` | Owner/Admin | Disable staff (BranchMember) |
| PATCH | `/api/v1/owner/staffs/:id/enable` | Owner/Admin | Enable staff (BranchMember) |

**POST body:** `{ name, description?, scopes? }`. `owner_id` is set from `req.user.id`.

**Validation:**
- Team name required (trimmed); duplicate name per owner → 409.
- Scopes must be subset of: `products`, `clinics`, `inventory`, `staff`, `branches`, `finance_read`. Invalid scope → 400.

**Responses:**
- Success: `201` → `{ success: true, data: team }`
- Error: `4xx/5xx` → `{ success: false, error: "message" }`

**Database:** `owner_teams` with `name`, `description`, `scopes` (JSONB), `ownerUserId`. Unique on `(ownerUserId, name)`.

**Auth:** All owner routes use `auth` + `roleGuard(['OWNER', 'ADMIN'])`. Team-management routes (team/overview, team/invitations, teams list/create/invite/invitations/members) also use **requireTeamOwner**: only users who own at least one OwnerTeam (or ADMIN) can access; delegates get 403. Selected write routes (e.g. PATCH/PUT/DELETE organizations/:id, branches/:id) use `requireOwnerPermission` so delegated users are limited by their scopes.

---

## 3. Permission engine & scope enforcement

- **auth/me:** For users with `OwnerDelegation` (delegates), the API returns scope-filtered permissions via `getPermissionsForOwnerPanel(userId)`. Owner panel sidebar uses these for menu filtering.
- **Scope middleware:** `requireOwnerScope.requireOwnerPermission(permissionKey, resourceType)` is applied on owner org/branch write routes; delegated users get 403 if they lack the required scope.
- **Read-only scopes:** `READ_ONLY_SCOPE_KEYS = ['finance_read']` in `delegationScopes.ts`; finance write handlers can block users who have only this scope.

---

## 4. Delegation Scopes & Permissions

- **Allowed keys:** products, clinics, inventory, staff, branches, finance_read.
- **Finance (Read Only):** Stored as `finance_read`; read-only enforcement is in the permission layer (SCOPE_TO_PERMISSIONS / scope checks).
- **Owner scope:** Owner can manage only their own teams; all queries filter by `ownerUserId` from `req.user.id`.
- **Team members:** Add/remove via POST/DELETE `.../teams/:teamId/members`; delegation scopes apply when assigning delegations (with optional `teamId`).

---

## 5. Error Handling & Edge Cases

| Case | Frontend | Backend |
|------|----------|---------|
| Empty team name | Inline validation error; no request | — |
| Duplicate team name | Error toast with backend message | 409, "A team with this name already exists." |
| Invalid scope | — | 400, "Invalid scope: &lt;key&gt;" |
| Server error | Generic error toast | 500, "Server error" |

---

## 6. Deploy Steps

1. **Backend**
   - Ensure migration applied: `npx prisma migrate deploy` (includes `owner_teams.scopes` and unique `(ownerUserId, name)`).
   - Run `npx prisma generate`.
   - Restart API; confirm POST `/api/v1/owner/teams` is behind auth and roleGuard.

2. **Frontend**
   - No extra env vars; uses existing `NEXT_PUBLIC_API_BASE_URL` and cookie auth.
   - Build and deploy as usual. Team dashboard at `/owner/team` (overview, invite by email, pending invites, members). Teams list at `/owner/teams`; team detail at `/owner/teams/[id]`.

3. **Smoke test**
   - Log in as Owner → open Teams & Delegation.
   - Create team with name only → success toast and list update.
   - Create team with same name → duplicate error toast.
   - Create team with name + scopes → team appears with scope badges.

---

## 7. Integration Test (Manual + Code)

| Test case | Expected | Code confirmation |
|-----------|----------|-------------------|
| Create team with valid name + scopes | 201, success toast, list refetches | createTeam → ownerPost → success → setSuccessMessage + load() |
| Create team with empty name | Blocked on UI, no request | if (!name) { setValidationError(...); return } |
| Create duplicate team (same owner, same name) | 409, error toast with backend message | P2002 → "A team with this name already exists."; frontend setError(msg) |
| Create team with invalid scope | 400, error toast | isValidScopeKey → 400; frontend shows e.response?.error |
| Owner isolation | Owner A cannot see Owner B's teams | getOwnerTeams(ownerUserId); listTeams uses req.user?.id only |

---

## 8. Phase 6 – Full lifecycle verification

End-to-end production verification (owner → team → staff → scope):

| Step | Action | Expected |
|------|--------|----------|
| 1 | Owner creates team (name + scopes) | 201, team in list |
| 2 | Owner adds member to team (userId) | 200, member in team |
| 3 | Owner assigns delegation (delegatedUserId, scopeKey, teamId) | 200, delegation created |
| 4 | Login as delegated user | auth/me returns scope-filtered permissions; panels.owner.hasDelegations true |
| 5 | Owner panel as delegate | Sidebar menu filtered by scope (buildMenu uses me.permissions) |
| 6 | Delegate calls owner write route without scope | 403 from requireOwnerPermission |
| 7 | Owner disables staff (PATCH …/staffs/:id/disable) | 200, BranchMember.status = DISABLED |
| 8 | Owner enables staff (PATCH …/staffs/:id/enable) | 200, BranchMember.status = ACTIVE |
| 9 | Owner revoke-all (POST …/delegations/revoke-all, delegatedUserId) | 200, all delegations for that user removed |
| 10 | Owner set-team (POST …/delegations/set-team, delegatedUserId, teamId) | 200, all that user’s delegations updated to team |

**Relevant code:** `scopePermission.service.ts` (`getPermissionsForOwnerPanel`), `auth.controller.ts` (getProfile + hasDelegations), `requireOwnerScope.ts`, `owner.controller.ts` (enableStaff/disableStaff), `ownerDelegation.service.js` (revokeAllDelegationsForUser, setTeamForUser).

---

## 9. Files Reference

- **Frontend:** `bpa_web/app/owner/teams/page.jsx`, `bpa_web/app/owner/staffs/page.jsx`, `bpa_web/app/owner/_lib/ownerApi.ts`, `bpa_web/src/lib/useMe.ts`
- **Backend:** `backend-api/src/api/v1/modules/owner/ownerDelegation.controller.ts`, `owner.controller.ts`, `ownerDelegation.service.js`, `owner.routes.ts`, `backend-api/src/api/v1/services/scopePermission.service.ts`, `backend-api/src/middlewares/requireOwnerScope.ts`
- **Constants:** `backend-api/src/api/v1/constants/delegationScopes.ts`
- **Schema:** `backend-api/prisma/schema.prisma` (OwnerTeam, OwnerDelegation), migration `20260207180001_owner_teams_scopes_and_unique_name`

**Unrelated dashboard files:** No other dashboard or shared components were modified for this feature.

---

## 10. Team detail page (complete flow)

**Location:** `bpa_web/app/owner/teams/[id]/page.jsx`

- **Team info:** Name, description, and scope badges (BPA card styling).
- **Members:** List with Remove per member (DELETE `/api/v1/owner/teams/:teamId/members/:userId`); Add member by User ID (POST `.../members` with `{ userId }`).
- **Assign delegation:** User ID + Scope dropdown; POST `/api/v1/owner/delegations` with `{ delegatedUserId, scopeKey, teamId }`.
- **UX:** Success/error alerts, loading states, BPA Design System (card radius-12, form-control, btn-primary).
- **API:** Uses `ownerDelete` for remove member; `ownerDelete` now surfaces `error` from response (same as `ownerPost`).
