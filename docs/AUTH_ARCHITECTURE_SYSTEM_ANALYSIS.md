# BPA Auth Architecture – System Analysis

**Date:** 2025-02-07  
**Status:** Unification implemented – see [AUTH_UNIFICATION_IMPLEMENTATION.md](./AUTH_UNIFICATION_IMPLEMENTATION.md)  
**Purpose:** Document current state; identify inconsistencies and touch points (pre-refactor baseline).

---

## 1. Current Login & Registration Flow

### 1.1 Backend Login Endpoints

| Endpoint | Location | Purpose | Response Shape |
|----------|----------|---------|----------------|
| `POST /api/v1/auth/login` | `auth.controller.ts` | General login (Owner, Customer, Staff, Country) | `{ user, token }` with `user.redirectPath`, `user.role`, `user.organizations`, `user.branches`, `user.countryRoles` |
| `POST /api/v1/auth/staff/login` | `auth.controller.ts` | Staff-only gate; rejects non-staff | `{ user, token }` with `user.redirectPath`, `user.branches`, `user.userType` |
| `POST /api/v1/admin/auth/login` | `admin_auth.controller.ts` | Admin-only gate; rejects non-whitelisted | `{ user, token }` – no `redirectPath` |
| `POST /api/v1/producer/auth/login` | `producer.controller.ts` | Producer login via service | `{ data: { user } }` – no `redirectPath` |

### 1.2 Registration Endpoints

| Endpoint | Location | Purpose |
|----------|----------|---------|
| `POST /api/v1/auth/register` | `auth.controller.ts` | General registration; optional `isOwner` creates `OwnerProfile` + `OwnerKyc` |
| `POST /api/v1/auth/invites/accept` | `auth.controller.ts` | Staff/Access invite acceptance; creates user + assigns role |
| `POST /api/v1/producer/auth/register` | `producer.controller.ts` | Producer registration; creates User + ProducerOrg + ProducerOrgStaff |

### 1.3 Identity Model

- **Single `users` table** (Prisma `User` model)
- **Single `UserAuth`** per user (email, phone, passwordHash)
- **Profiles:** `OwnerProfile`, `ProducerOrg` (owner), `UserProfile` (display, username)

---

## 2. Authentication Logic Location

### 2.1 Auth Middlewares (Backend)

| Middleware | Path | Used By | Behavior |
|------------|------|---------|----------|
| `auth.middleware` | `middleware/auth.middleware.ts` | Most routes (auth/me, notifications, inventory, reports, etc.) | JWT from cookie or Bearer; sets `req.user`; optionally resolves perms |
| `auth` | `middlewares/auth.ts` | Owner, branches, branch_manager, branch_access, notifications | Same token source; infers `role` (ADMIN/OWNER/STAFF) from token or allowlist; fetches user existence |
| `roleGuard` | `middlewares/roleGuard.ts` | Owner routes | Checks `req.user.role` against allowed roles |
| `requireAdmin` | `middleware/admin.middleware.ts` | Admin routes | Validates user against SuperAdminWhitelist or env allowlists |
| `requireProducerPermission` | `middlewares/producerAuth` | Producer routes | ProducerOrg + role-based permission check |

### 2.2 Inconsistency: Two Auth Implementations

- **`middleware/auth.middleware.ts`** (singular): Does NOT infer role; sets `req.user` with id, permissions.
- **`middlewares/auth.ts`** (plural): Infers role (ADMIN/OWNER/STAFF); does DB lookup; used by owner/branch routes.

Some modules use `authenticateToken` from `auth.middleware`, others use `auth` from `middlewares/auth`. This can lead to `req.user.role` being absent when using `auth.middleware`.

---

## 3. Role Handling

### 3.1 Role Sources

| Source | Keys | Scope |
|--------|------|-------|
| **OrgMember** | `role` (legacy) | Per organization |
| **BranchMember** | `role` (BRANCH_MANAGER, BRANCH_STAFF, SELLER, DELIVERY_*) | Per branch |
| **UserCountryRole** | Role key from `Role` table | Per country |
| **UserStateRole** | Role key | Per state |
| **OwnerProfile** | Implicit OWNER | Global per user |
| **SuperAdminWhitelist** | Implicit ADMIN | Global |
| **ProducerOrgStaff** | PRODUCER_OWNER, etc. | Per ProducerOrg |

### 3.2 Login Response Role Logic (auth.controller.ts `login`)

1. If `orgMembers.length > 0` → `primaryRole` = orgMember.role or `ORG_OWNER`; `redirectPath` = `/owner`
2. Else if `branchMembers.length > 0` → role from branch; redirect by branch type (CLINIC→`/clinic`, SHOP→`/shop`, else `/owner`)
3. Else if `countryRoles.length > 0` → `primaryRole` = role key; `redirectPath` = `/country/dashboard`
4. Else → `primaryRole` = `CUSTOMER`; `redirectPath` = `/mother`

### 3.3 Staff Login Role Logic

- Rejects users without branch/org membership or OwnerProfile
- Returns `userType`: `OWNER` or `STAFF`
- `redirectPath` = `/staff` or `/staff/branch/{id}` if single branch

---

## 4. Redirect Logic After Login

### 4.1 Backend-Provided Redirect Path

- **`/auth/login`**: Returns `user.redirectPath` (e.g. `/owner`, `/clinic`, `/shop`, `/country/dashboard`, `/mother`)
- **`/auth/staff/login`**: Returns `user.redirectPath` (`/staff` or `/staff/branch/{id}`)
- **`/admin/auth/login`**: Does NOT return redirect path
- **`/producer/auth/login`**: Does NOT return redirect path

### 4.2 Frontend Redirect Logic (app/login/page.jsx)

1. If `returnTo` or `next` query param → use sanitized target
2. Else if `response.user.redirectPath` → use it (with special handling for owner app when path is mother)
3. Else if owner app (port 3104) → default `/owner/dashboard`
4. Else → `/`

**Issue:** Frontend has complex, port-based logic. Redirect is driven partly by backend, partly by frontend (`isOwnerApp`, `returnTo`, etc.).

### 4.3 Panel-Specific Login Pages

- **Owner** (`/owner/login`): Redirects to same-app `/login` with `next`/`returnTo`
- **Staff, Admin, Producer**: Use `AuthRedirectPage` → redirects to `getAuthRedirectUrl()` = `authBase/auth/login?app=X&returnTo=Y`
- `authBase` defaults to `NEXT_PUBLIC_AUTH_BASE_URL` or `http://localhost:3000` (API – no login UI)

---

## 5. KYC / Approval Checks

### 5.1 Owner KYC

| Middleware | File | When | Behavior |
|------------|------|------|----------|
| `ensureOwnerKyc` | `middlewares/ensureOwnerKyc.ts` | Partner onboarding, org/branch creation | Requires OwnerKyc with status SUBMITTED or VERIFIED; at least one document |
| `requireOwnerKycVerified` | `middlewares/requireOwnerKycVerified.ts` | Go-live, wallet withdraw, payouts, ads | Requires status VERIFIED |

### 5.2 Frontend KYC Guard

- **`app/owner/_lib/requireOwnerKyc.js`**: Redirects to `/owner/kyc` if status not SUBMITTED/VERIFIED
- **`app/owner/layout.jsx`**: Fetches `/api/v1/auth/me`; if no owner access → `/owner/kyc`; KYC check forces `/owner/kyc` when NOT_SUBMITTED/REJECTED

### 5.3 Staff Branch Access Approval

- `BranchAccessPermission`: Staff may have PENDING/APPROVED/EXPIRED
- Login flow checks/creates permissions; notifies manager on new request
- Frontend uses `useBranchContext`; blocks access until APPROVED

---

## 6. Dashboard & Report Access Control

### 6.1 Reports API

- **`/api/v1/reports/*`**: Protected by `authenticateToken` only
- Controller infers `orgId`/`branchId` from `OrgMember`/`BranchMember`
- No explicit permission check for `reports.read`; relies on membership

### 6.2 Permissions Service

- **`permissions.service.ts`**: Aggregates global, country, state, org, branch roles and permissions
- **`LEGACY_ROLE_PERMS`** (permissions.js): Maps OWNER, BRANCH_MANAGER, BRANCH_STAFF, etc. to permission keys (e.g. `reports.read`)
- Not all report endpoints enforce `reports.read` explicitly

### 6.3 Dashboard Access

- **Owner**: `roleGuard(['OWNER'])` on `/owner/*`
- **Admin**: `requireAdmin` after `authenticateToken` on `/admin/*`
- **Staff**: `auth` + branch membership / `requireBranchMemberRoles`
- **Producer**: `requireProducerPermission` (e.g. `producer.org.read`)

---

## 7. Inconsistencies and Duplicated Logic

### 7.1 Multiple Login Endpoints

| Issue | Detail |
|-------|--------|
| Four login entry points | `/auth/login`, `/auth/staff/login`, `/admin/auth/login`, `/producer/auth/login` |
| Different response shapes | General login has `redirectPath`, `organizations`, `branches`; admin and producer do not |
| Duplicated credential validation | Same UserAuth lookup + bcrypt in each controller |

### 7.2 Two Auth Middlewares

| Issue | Detail |
|-------|--------|
| `auth.middleware` vs `middlewares/auth` | Different behavior: one sets only `req.user.id`; the other infers `req.user.role` |
| Inconsistent `req.user` shape | Some routes expect `role`, others don’t |

### 7.3 Redirect Logic Split

| Issue | Detail |
|-------|--------|
| Frontend decides fallback | Port check (`isOwnerApp`), `returnTo` sanitization, default paths |
| Backend sometimes omits redirect | Admin and producer login responses have no `default_redirect` |
| AuthRedirectPage URL | Builds `/auth/login`; `authBase` may point to API (no UI) |

### 7.4 Role/Permission Fragmentation

| Issue | Detail |
|-------|--------|
| Role from multiple places | OrgMember, BranchMember, UserCountryRole, allowlists, OwnerProfile |
| Permissions from multiple systems | `permissions.service.ts`, `permissions.js` LEGACY_ROLE_PERMS, scopePermission.service |
| No single “contexts” structure | Each panel fetches different endpoints (e.g. `/auth/me`, `/auth/staff/context`) |

### 7.5 Admin Allowlist Duplication

- `isAdminAllowed` in `admin_auth.controller.ts`
- `isAdminUser` in `admin.middleware.ts`
- Both use SuperAdminWhitelist + env fallbacks

---

## 8. Touch Points for Refactor

### 8.1 Backend

| File | Change |
|------|--------|
| `src/api/v1/modules/auth/auth.controller.ts` | Extend login response with `contexts`, `default_redirect` |
| `src/api/v1/modules/admin_auth/admin_auth.controller.ts` | Align response shape; consider delegating to shared login |
| `src/api/v1/modules/producer/producer.controller.ts` | Add `default_redirect`; consider single login flow |
| `src/middleware/auth.middleware.ts` | Unify with `middlewares/auth.ts` or ensure consistent `req.user` |
| `src/middlewares/auth.ts` | Same as above |
| `src/api/v1/utils/permissions.js` | May feed into unified contexts |
| `src/api/v1/services/permissions.service.ts` | Same |

### 8.2 Frontend

| File | Change |
|------|--------|
| `app/login/page.jsx` | Consume `default_redirect` from response; simplify port logic |
| `lib/authRedirect.ts` | May need `authBase` to point to login host |
| `app/owner/layout.jsx` | Already uses `/auth/me` panels; minimal change |
| `app/staff/page.jsx` | Uses `/auth/staff/context`; could use unified context |
| Panel login pages | Use `default_redirect` instead of hardcoded paths |

### 8.3 Routes / Middleware

| Location | Change |
|----------|--------|
| `auth.routes.ts` | Single `/auth/login` or backward-compatible wrapper |
| Admin / producer routes | Optional: route through shared login |
| Middleware imports | Consolidate to single auth middleware where possible |

---

## 9. Standard Auth Model (Target)

Per task specification:

### 9.1 Identity

- Single `users` table
- Single `/auth/login` endpoint (or backward-compatible unification)

### 9.2 Authorization

- Role-based + scope-based access
- Permissions drive dashboards and reports

### 9.3 Login Response Shape (Target)

```json
{
  "user": {},
  "contexts": [],
  "default_redirect": "/role-specific-path"
}
```

### 9.4 Implementation Strategy

1. Add `contexts` and `default_redirect` to existing login responses without breaking current clients
2. Unify auth middlewares incrementally (alias or deprecate one)
3. Prefer backend-controlled redirect; frontend uses `default_redirect` when no `returnTo`/`next`
4. Keep admin/producer/staff gates; optionally refactor to shared login + post-check

---

## 10. Summary

- **Identity:** Single `User` / `UserAuth` model; one source of truth
- **Login endpoints:** Four separate endpoints with different behaviors and response shapes
- **Redirect:** Backend provides `redirectPath` for general and staff login; frontend adds port and query logic
- **Roles:** From OrgMember, BranchMember, CountryRole, OwnerProfile, allowlists; no unified “contexts”
- **Auth middlewares:** Two implementations with different `req.user` shapes
- **KYC:** OwnerKyc enforced for sensitive actions; frontend guards redirect to `/owner/kyc`
- **Reports:** Protected by auth only; org/branch inferred from membership; no explicit `reports.read` enforcement
- **Refactor approach:** Incremental; extend responses with `contexts` and `default_redirect`; unify middlewares; keep backward compatibility
