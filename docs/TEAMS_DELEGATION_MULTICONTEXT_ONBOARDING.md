# Teams & Delegation + Multi-Context + Onboarding

## Overview

End-to-end implementation for BPA/WPA:

1. **Teams & Delegation** – Owner creates teams (name, description, scopes); members join via **email invitation**; token-based accept; revoke-all, set-team, enable/disable member.
2. **Multi-Context** – Single user can have multiple contexts (branch, team, roles, scopes); context selector in owner panel; menu and permissions from current context.
3. **Onboarding** – Detect missing org/branch; `/owner/onboarding` flow: org create → branch create → context created; invitation-first users skip unnecessary steps.
4. **Security** – Token one-time use, hashed; owner isolation; scope/role enforcement; audit logs (OwnerOverviewLog, TeamInvitation status).

---

## Database

### user_contexts

- `userId`, `ownerUserId?`, `branchId?`, `teamId?`, `roles` (Json), `scopes` (Json), `defaultDashboard`, `isDefault`
- Used for multi-context: list contexts, set default, drive menu/permissions.

### team_invitations

- `ownerUserId`, `teamId`, `email`, `tokenHash` (unique), `status` (PENDING | ACCEPTED | REVOKED | EXPIRED), `expiresAt`, `scopes?`, `branchIds?`, `invitedByUserId`, `acceptedByUserId?`
- Token: generated raw, stored as SHA256 hash; 72h expiry; one-time use on accept.

**Migration:** `20260207200000_add_user_contexts_and_team_invitations`

---

## Backend

### Team invitation (email)

- **POST /api/v1/owner/teams/:teamId/invite** – Body: `{ email, scopes?, branchIds? }`. Returns `{ inviteId, email, expiresAt, rawToken }`. Caller must send `rawToken` in invitation email (e.g. link `https://.../invite/accept?token=...`).
- **GET /api/v1/owner/team/overview** – Returns `{ teamsCount, membersCount, pendingInvitesCount }`. Protected by requireTeamOwner.
- **GET /api/v1/owner/team/invitations** – Returns all invitations for current owner (all teams). Optional `?status=PENDING`. Protected by requireTeamOwner.
- **GET /api/v1/auth/invites/verify?token=...** – Supports `inviteType: "TEAM"`; returns team, owner, email, scopes, branchIds, userExists, requiresRegistration.
- **POST /api/v1/auth/invites/accept** – Body: `{ token, password?, displayName? }`. For TEAM: creates user if new, adds OwnerTeamMember, creates OwnerDelegation per scope, creates UserContext, marks invite ACCEPTED.

### User context

- **GET /api/v1/me/contexts** – List contexts for current user.
- **PATCH /api/v1/me/contexts/:id/default** – Set default context (used for menu/permissions).

### Auth/me

- Response includes `contexts`, `defaultContext`, `onboarding: { needsOnboarding, hasOrg, hasBranch, contextCount }`.
- Permissions remain scope-filtered for delegates via existing `getPermissionsForOwnerPanel`.

### Onboarding

- **GET /api/v1/owner/onboarding/status** – `{ needsOnboarding, hasOrg, hasBranch, contextCount, step }`.
- **POST /api/v1/owner/onboarding/start** – Body: `{ organizationName?, branchName? }`. Creates org, branch, and a UserContext (owner); returns org/branch ids.

### Middleware

- **requireOwnerContext** – Optional: returns 403 with `needsOnboarding` when owner panel user has no context and no org. Not applied globally; use on specific routes if needed.
- **requireOwnerPermission** – Already applied on selected owner write routes (org/branch) for scope checks.
- **requireTeamOwner** – Team-management routes (GET/POST teams, invite, invitations, members): only users who own at least one OwnerTeam (or ADMIN) can access; delegates get 403. Used for `/owner/team/overview`, `/owner/team/invitations`, and all team CRUD/invite routes.

---

## Frontend

- **Context selector** – Shown in owner navbar when `me.contexts.length > 1`. Calls PATCH `/me/contexts/:id/default` and reloads to refresh menu.
- **useMe** – Merges `contexts`, `defaultContext`, `onboarding` from auth/me into `me`.
- **Onboarding** – `/owner/onboarding`: form (org name, branch name) → POST `/owner/onboarding/start` → redirect to dashboard. Layout redirects to `/owner/onboarding` when `onboarding.needsOnboarding` and not on onboarding/login/kyc.
- **Invite accept** – Existing `/invite/accept` works for TEAM; after success redirects to `/owner/dashboard` (cookie set by backend).
- **Dedicated Team dashboard** – `/owner/team`: overview (teams/members/pending counts), invite by email, pending invitations list, members list (email-based). No KYC or onboarding logic; layout skips KYC/onboarding redirect for this route. Sidebar: "Teams & Delegation" → "Team dashboard" (href `/owner/team`), "Teams", "Overview". Team members (delegates) get 403 from API and see "Team management is only available to team owners" on the page.

---

## Security

- **Token:** One-time use; stored as SHA256 hash; 72h expiry; status updated to ACCEPTED/EXPIRED on use or timeout.
- **Owner isolation:** All team/delegation/context queries scoped by `ownerUserId` or `userId`.
- **Scope enforcement:** Existing `requireOwnerPermission` and `getPermissionsForOwnerPanel`; backend verifies permissions on owner write routes.
- **Audit:** OwnerOverviewLog for delegation/team actions; TeamInvitation status and acceptedByUserId.

---

## Empty states

- No teams: Teams list empty; owner can create team.
- No context: Onboarding or context selector guides user.
- No branches: Onboarding creates first branch; owner can add more from organizations.

---

## Files (touch points)

**Backend:**  
`prisma/schema.prisma` (UserContext, TeamInvitation), `teamInvitation.service.js`, `userContext.service.js`, `ownerDelegation.controller.ts` (inviteToTeam), `auth.controller.ts` (verify/accept team invite, getProfile contexts/onboarding), `onboarding.controller.js`, `owner.routes.ts`, `me.controller.ts` (getContexts, setDefaultContext), `me.routes.ts`, `requireOwnerContext.ts`, `requireOwnerScope.ts`

**Frontend:**  
`useMe.ts`, `MasterLayout.jsx` (ContextSelector), `ContextSelector.jsx`, `owner/layout.jsx` (onboarding redirect), `owner/onboarding/page.jsx`, `invite/accept/page.jsx` (redirect to dashboard)

**Docs:**  
`TEAMS_DELEGATION_DEPLOYMENT.md`, `TEAMS_DELEGATION_MULTICONTEXT_ONBOARDING.md`
