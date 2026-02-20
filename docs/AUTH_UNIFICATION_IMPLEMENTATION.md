# Auth Architecture Unification – Implementation Summary

**Date:** 2025-02-07  
**Status:** Implemented (Phases 1–5)  
**See also:** [AUTH_ARCHITECTURE_SYSTEM_ANALYSIS.md](./AUTH_ARCHITECTURE_SYSTEM_ANALYSIS.md)

---

## 1. Canonical Auth Response

All login endpoints return this structure (alongside legacy fields):

```json
{
  "user": {
    "id": number,
    "email": string | null
  },
  "contexts": [
    {
      "role": "ADMIN | OWNER | STAFF | PRODUCER",
      "scopeType": "GLOBAL | OWNER | BRANCH | ORG",
      "scopeId": number | null,
      "status": "PENDING | APPROVED | ACTIVE"
    }
  ],
  "default_redirect": "/role-specific-path"
}
```

**Frontend must follow `default_redirect`** when no explicit `returnTo`/`next` is provided.

---

## 2. Login Endpoints (All Canonical)

| Endpoint | Purpose | Gate | Response Shape |
|----------|---------|------|----------------|
| `POST /api/v1/auth/login` | General login | None | canonical + legacy |
| `POST /api/v1/auth/staff/login` | Staff panel | Staff-only | canonical + legacy |
| `POST /api/v1/admin/auth/login` | Admin panel | Admin whitelist | canonical + legacy |
| `POST /api/v1/producer/auth/login` | Producer panel | Producer-only | canonical + legacy |

All use **authUnified.service** internally for credentials, contexts, and redirect.

---

## 3. Shared Auth Service

**Location:** `src/api/v1/services/authUnified.service.ts`

- `verifyCredentials({ email?, phone?, password })` – verifies identity
- `resolveAuthContexts(userId)` – builds `AuthContext[]` from DB
- `decideRedirect(userId, contexts, options)` – backend-driven redirect (KYC, status, etc.)
- `performUnifiedLogin(params)` – full login flow (verify + gate + contexts + redirect)
- `attachAuthContexts(req, userId)` – sets `req.contexts` and legacy `req.user.role`
- `isAdminAllowed(userId)` – SuperAdminWhitelist + env fallback

---

## 4. Auth Middleware (Context Normalization)

**Both auth middlewares now populate:**

- `req.user` – identity (`id`, `role` for legacy, `permissions`, `userType`)
- `req.contexts` – `AuthContext[]` (canonical authorization model)

**Files:**

- `middleware/auth.middleware.ts` – used by most routes (reports, inventory, etc.)
- `middlewares/auth.ts` – used by owner, branches, branch_manager, branch_access

---

## 5. Redirect Rules (Backend-Driven)

| Scenario | Redirect |
|----------|----------|
| Admin | `/admin` |
| Owner + KYC UNSUBMITTED/REJECTED | `/owner/kyc` |
| Owner + KYC SUBMITTED/VERIFIED | `/owner/dashboard` |
| Producer + PENDING | `/producer/kyc` |
| Producer + VERIFIED | `/producer` |
| Staff + APPROVED branch | `/staff/branch/{id}` |
| Staff + PENDING access | `/staff` |
| Country admin | `/country/dashboard` |
| Customer | `/mother` |

---

## 6. Report & Dashboard Security

- **Reports routes** require `reports.read`, `org.read`, or `branches.read` (via `requirePermission`).
- **Admin users** receive `reports.read`, `dashboard.view`, `finance.read` via `ADMIN_PERMISSIONS` in `permissions.js`.
- **LEGACY_ROLE_PERMS** updated with `dashboard.view`, `finance.read` for OWNER, ORG_ADMIN, BRANCH_MANAGER.
- Reports controller filters by org/branch from membership (scope-based).

---

## 7. Legacy vs Canonical

| Item | Legacy | Canonical |
|------|--------|-----------|
| Redirect field | `user.redirectPath` | `default_redirect` |
| Role | `user.role` | `contexts[].role` |
| Scope | Implicit in org/branch | `contexts[].scopeType`, `scopeId`, `status` |
| Auth middleware | `req.user.role` inferred | `req.contexts` + legacy `req.user.role` |

**Backward compatibility:** Legacy fields retained; new clients should use canonical.

---

## 8. Touch Points

- `src/api/v1/services/authUnified.service.ts` – shared auth logic
- `src/api/v1/modules/auth/auth.controller.ts` – login, staffLogin
- `src/api/v1/modules/admin_auth/admin_auth.controller.ts` – admin login
- `src/api/v1/modules/producer/producer.controller.ts` – producer login
- `src/middleware/auth.middleware.ts` – auth + contexts
- `src/middlewares/auth.ts` – auth + contexts
- `src/api/v1/utils/permissions.js` – LEGACY_ROLE_PERMS, ADMIN_PERMISSIONS, isAdminAllowed
- `src/api/v1/modules/reports/reports.routes.ts` – requirePermission
- `bpa_web/app/login/page.jsx` – uses `default_redirect` from backend
