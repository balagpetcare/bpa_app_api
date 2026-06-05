# Super Admin Login Audit

**Date:** 2026-06-05  
**Endpoint:** `POST /api/v1/admin/auth/login`  
**Database:** `bpa_pet_db` @ localhost:5432

---

## Executive summary

Super Admin **users exist**, roles are assigned, and the whitelist is configured. Login failed because **`SUPER_ADMIN_PASSWORD` in `.env` did not match the bcrypt hash stored in `user_auth`** — not because of missing users or permissions.

**Root cause:** `npm run seed` seeds roles, whitelist rows, and `PLATFORM_ADMIN` assignment but **does not set login passwords**. Passwords are applied only by `npm run admin:bootstrap` (or manual registration). After changing `.env` or restoring a database backup, bootstrap must be re-run to sync the password hash.

**Fix applied during audit:** `npm run admin:bootstrap` updated user **#2** password from current `SUPER_ADMIN_PASSWORD`. Login for that account now succeeds.

---

## 1. Authentication system

### Login identifier

| Identifier | Supported | Notes |
|------------|-----------|-------|
| **Email** | Yes | Case-insensitive match on `user_auth.email` |
| **Phone** | Yes | Digits only; supports `880…` → last 11 digits (BD) |
| **Username** | **No** | Not used for admin login |

### Flow

1. `POST /api/v1/admin/auth/login` → `admin_auth.controller.ts`
2. `performUnifiedLogin({ email?, phone?, password, options: { adminOnly: true } })` → `authUnified.service.ts`
3. **`verifyCredentials`** — lookup `user_auth` by email or phone; bcrypt compare `passwordHash`
4. **`isAdminAllowed`** — must match `super_admin_whitelist` (active) **or** env allowlists (`ADMIN_EMAILS`, `ADMIN_PHONES`, `SUPER_ADMIN_WHITELIST_*`, `ADMIN_USER_IDS`)
5. On success: JWT + `access_token` cookie

**Important:** Whitelist alone does **not** create a login user. A row in `users` + `user_auth` with a password hash is required before step 3.

### Files

| File | Role |
|------|------|
| `src/api/v1/modules/admin_auth/admin_auth.controller.ts` | Admin login handler |
| `src/api/v1/services/authUnified.service.ts` | Credential verify + admin gate |
| `src/middleware/admin.middleware.ts` | Protected admin routes |
| `scripts/bootstrap-super-admin.ts` | Create/update super admin + password |
| `prisma/seeders/seedSuperAdminWhitelist.ts` | Whitelist rows only |
| `prisma/seeders/seedGlobalCountryRoles.ts` | Roles + `PLATFORM_ADMIN` auto-assign |

---

## 2. Bootstrap & seed behavior

| Env variable | Purpose |
|--------------|---------|
| `SUPER_ADMIN_EMAIL` | Primary email for bootstrap user |
| `SUPER_ADMIN_PHONE` | Primary phone (single value at login; lists → use `SUPER_ADMIN_WHITELIST_PHONES`) |
| `SUPER_ADMIN_PASSWORD` | Password written to `user_auth.passwordHash` by **bootstrap only** |
| `SUPER_ADMIN_WHITELIST_EMAILS` | Whitelist + seed; used to resolve `PLATFORM_ADMIN` target |
| `SUPER_ADMIN_WHITELIST_PHONES` | Whitelist + seed |
| `ADMIN_EMAILS` / `ADMIN_PHONES` | Fallback allowlists for `isAdminAllowed` |

| Step | Creates user? | Sets password? | Assigns SUPER_ADMIN? | Assigns PLATFORM_ADMIN? |
|------|---------------|----------------|----------------------|-------------------------|
| `npm run seed` | No | No | No | Yes (existing matching users) |
| `seedSuperAdminWhitelist` | No | No | No | No |
| `npm run admin:bootstrap` | Yes if missing | **Yes** | Yes | No (seed handles PLATFORM_ADMIN) |

---

## 3. Current `.env` configuration (structure)

```
SUPER_ADMIN_EMAIL=balag@bangladeshpetassociation.com
SUPER_ADMIN_PHONE=01777889994
SUPER_ADMIN_PASSWORD=<set in local .env — not committed>
SUPER_ADMIN_WHITELIST_EMAILS=balag@bangladeshpetassociation.com
SUPER_ADMIN_WHITELIST_PHONES=01777889994
ADMIN_EMAILS=balag@bangladeshpetassociation.com
ADMIN_PHONES=01777889994
```

---

## 4. Admin users found in database

| User ID | Name | Email | Phone | Global roles | Status | Password set | Whitelist |
|--------:|------|-------|-------|--------------|--------|--------------|-----------|
| **2** | Bala G 74 | balag@bangladeshpetassociation.com | 01777889994 | `SUPER_ADMIN`, `PLATFORM_ADMIN` | ACTIVE | Yes | Email + phone |
| **3** | BPA Super Admin | admin@bangladeshpetassociation.com | 01701022274 | `SUPER_ADMIN` | ACTIVE | Yes (stale*) | Email + phone |

\* User **#3** password does **not** match current `SUPER_ADMIN_PASSWORD` until bootstrap is run with that email/phone in env (see below).

### PLATFORM_ADMIN assignment

Seed log: `PLATFORM_ADMIN assigned to 1 user(s).`  
**Assigned to user #2** — matched `ADMIN_EMAILS` / `ADMIN_PHONES` against existing `user_auth` at seed time.

---

## 5. Why login failed

| Check | Result |
|-------|--------|
| User exists in `user_auth` | Yes (user #2 for configured email/phone) |
| User status ACTIVE | Yes |
| SUPER_ADMIN role | Yes (user #2) |
| Whitelist active | Yes |
| Password matches `SUPER_ADMIN_PASSWORD` | **No** (before bootstrap) |

**Failure mode:** `Invalid credentials` (bcrypt mismatch) — not `User not found`, not `Forbidden`.

Common triggers:

1. Ran `seed` but not `admin:bootstrap` after setting/changing `SUPER_ADMIN_PASSWORD`
2. Restored DB from backup with old password hashes
3. `.env` password changed without re-running bootstrap
4. Logging in as user **#3** while only user **#2** credentials are in primary env vars

---

## 6. Expected login format

**Request:**

```http
POST /api/v1/admin/auth/login
Content-Type: application/json

{
  "email": "balag@bangladeshpetassociation.com",
  "password": "<SUPER_ADMIN_PASSWORD from .env>"
}
```

**Or:**

```json
{
  "phone": "01777889994",
  "password": "<SUPER_ADMIN_PASSWORD from .env>"
}
```

**Rules:**

- Provide **either** `email` **or** `phone` (not username)
- Phone: digits only, e.g. `01777889994` (not comma-separated lists)
- Password: exact value of `SUPER_ADMIN_PASSWORD` after bootstrap sync
- Admin panel port: typically **3103** (CORS/cookie domain `localhost`)

---

## 7. Recovery commands (no auth bypass)

Super Admin **already exists**. Use existing RBAC bootstrap:

```bash
# Sync password + SUPER_ADMIN role + whitelist from .env (idempotent, safe to re-run)
npm run admin:bootstrap

# Aliases (same script)
npm run create:super-admin
npm run bootstrap:admin

# Verify users, whitelist, SUPER_ADMIN role
npm run admin:verify
```

**After audit bootstrap:** User **#2** login verified (`passwordMatches: true`, `performUnifiedLogin` succeeds).

### To also sync user #3 (`admin@…` / `01701022274`)

Add both identities to env and re-run bootstrap, e.g.:

```env
SUPER_ADMIN_WHITELIST_EMAILS=balag@bangladeshpetassociation.com,admin@bangladeshpetassociation.com
SUPER_ADMIN_WHITELIST_PHONES=01777889994,01701022274
```

Then: `npm run admin:bootstrap` (creates/updates one row per paired index; see `configuredSuperAdmins()` in bootstrap script).

---

## 8. Validation performed

| Test | Result |
|------|--------|
| `npm run admin:verify` | User #2 found, `hasSuperAdminRole: true` |
| Password bcrypt vs `.env` (user #2) | **Match** after bootstrap |
| `performUnifiedLogin` adminOnly (user #2) | **Success** |
| Password bcrypt vs `.env` (user #3) | No match until bootstrap includes that identity |

---

## 9. Status

| Item | Status |
|------|--------|
| Super Admin user exists | Yes (#2 primary, #3 secondary) |
| Login method understood | Email or phone + password |
| Root cause | Password hash out of sync with `.env` |
| Fix | `npm run admin:bootstrap` |
| Auth bypass | Not used |
| Permissions modified | No |

**Recommended:** After any `.env` password change or DB restore, run `npm run admin:bootstrap` then log in with user **#2** credentials above.
