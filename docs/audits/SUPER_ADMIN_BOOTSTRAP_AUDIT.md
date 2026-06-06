# Super Admin Bootstrap Audit (BPA / WPA)

**Date:** 2026-06-06  
**Repository:** `backend-api`  
**Scope:** Analysis only — no code changes  
**Related:** [PRODUCTION_SEED_EXECUTION_PLAN.md](../plans/PRODUCTION_SEED_EXECUTION_PLAN.md), [PRODUCTION_DEPLOY_AND_SEED_MASTER_REPORT.md](./PRODUCTION_DEPLOY_AND_SEED_MASTER_REPORT.md)

---

## 1. Executive summary

| Question | Answer |
|----------|--------|
| Does Prisma seed create admin **login** accounts? | **No** — only whitelist rows (if env set) and role **definitions** |
| Is `admin:bootstrap` mandatory? | **Yes** for Super Admin panel login on a fresh or recovered environment |
| Production command | `npm run admin:bootstrap` with required env vars |
| Password on re-run | **Reset** to `SUPER_ADMIN_PASSWORD` for matched identity |
| Safe to re-run? | **Yes** (idempotent upsert pattern) — but overwrites password for existing user |

---

## 2. Files inspected

| File | Role |
|------|------|
| `scripts/bootstrap-super-admin.ts` | Creates/updates Super Admin user, role, whitelist |
| `scripts/verify-super-admin.ts` | Read-only verification |
| `prisma/seeders/seedSuperAdminWhitelist.ts` | Whitelist-only seed (main chain step 7) |
| `prisma/seeders/seedGlobalCountryRoles.ts` | Defines `SUPER_ADMIN` role + may assign `PLATFORM_ADMIN` |
| `prisma/seeders/seedRolesPermissions.ts` | ORG/BRANCH RBAC (not Super Admin user) |

---

## 3. What Prisma seed does vs bootstrap

### 3.1 `prisma/seed.ts` (steps 6–7, 15)

| Step | Seeder | Creates user? | Creates login? |
|------|--------|---------------|----------------|
| 6 | `seedRolesPermissions` | No | No |
| 7 | `seedSuperAdminWhitelist` | No | No — whitelist rows only |
| 15 | `seedGlobalCountryRoles` | No | No — may assign `PLATFORM_ADMIN` to env-matched **existing** users |

**Conclusion:** Full `db:seed` does **not** create a Super Admin user with password. Admin panel login requires `admin:bootstrap`.

### 3.2 `scripts/bootstrap-super-admin.ts`

Creates or updates:

1. `permission` key `global.admin`
2. `role` key `SUPER_ADMIN` (GLOBAL scope)
3. `rolePermission` link
4. `superAdminWhitelist` rows for configured email/phone
5. `user` + `userAuth` (LOCAL provider, bcrypt password)
6. `userProfile` (upsert)
7. `wallet` (create if missing)
8. `userGlobalRole` → `SUPER_ADMIN`

---

## 4. Environment variables

| Variable | Required | Used by | Notes |
|----------|----------|---------|-------|
| `SUPER_ADMIN_PASSWORD` | **Yes** (bootstrap) | `bootstrap-super-admin.ts` | bcrypt hash written on every matching run |
| `SUPER_ADMIN_EMAIL` | One of email/phone | bootstrap, verify, whitelist seed | Normalized lowercase |
| `SUPER_ADMIN_PHONE` | One of email/phone | bootstrap, verify | Comma-separated supported; one user per phone |
| `SUPER_ADMIN_NAME` | No | bootstrap | Default: `"BPA Super Admin"` |
| `SUPER_ADMIN_WHITELIST_EMAILS` | No | bootstrap, whitelist seed, `seedGlobalCountryRoles` | Comma-separated |
| `SUPER_ADMIN_WHITELIST_PHONES` | No | bootstrap, whitelist seed, `seedGlobalCountryRoles` | Comma-separated |
| `ADMIN_EMAILS` | No | `seedGlobalCountryRoles` | Fallback for PLATFORM_ADMIN assign |
| `ADMIN_PHONES` | No | `seedGlobalCountryRoles` | Fallback for PLATFORM_ADMIN assign |
| `DATABASE_URL` | Yes | prisma client | Required for all scripts |

**Login caveat:** Use a **single** phone value at login — not the comma-separated `SUPER_ADMIN_PHONE` env string. See `docs/super-admin-login-investigation.md`.

---

## 5. Authentication dependencies

| Dependency | Usage |
|------------|-------|
| `bcrypt` (^5.1.1) | `bcrypt.hash(password, 10)` for `userAuth.passwordHash` |
| `src/infrastructure/db/prismaClient` | Prisma 7 client with pg adapter |
| `dotenv/config` | Loads `.env` |
| `userAuth` | LOCAL provider; email case-insensitive match |
| `userGlobalRole` | Links user to `SUPER_ADMIN` role |
| `superAdminWhitelist` | Admin panel access gate (also checked at login via `isAdminAllowed`) |
| API auth | `roleGuard(['ADMIN', 'SUPER_ADMIN'])` on admin routes |

Bootstrap does **not** call HTTP APIs — direct DB writes only.

---

## 6. Password reset behavior

When `findAuthForIdentity(email, phone)` finds an existing user:

```typescript
// scripts/bootstrap-super-admin.ts (behavior summary)
user.update({
  status: "ACTIVE",
  auth: { update: { passwordHash, passwordUpdatedAt: new Date(), ... } },
  ...
});
userGlobalRole.upsert({ ... SUPER_ADMIN ... });
```

| Case | Action | Password |
|------|--------|----------|
| User exists (email or phone match) | `action: "updated"` | **Overwritten** with `SUPER_ADMIN_PASSWORD` |
| User does not exist | `action: "created"` | Set from `SUPER_ADMIN_PASSWORD` |
| Re-run with same env | Idempotent role/whitelist; password reset again | Overwritten |

**Production implication:** Treat `admin:bootstrap` as a **credential rotation** tool as well as initial setup.

---

## 7. Safe re-run behavior

| Resource | Re-run behavior |
|----------|-----------------|
| `permission` / `role` | Upsert — updates labels |
| `rolePermission` | Upsert — no duplicate links |
| `superAdminWhitelist` | Upsert — sets `isActive: true` |
| `user` | Update if exists, create if not |
| `userGlobalRole` | Upsert — ensures SUPER_ADMIN link |
| `wallet` | Created only if missing |
| Other users | **Not touched** |

**Safe:** Yes — scoped to configured admin identities only.  
**Risk:** Password overwrite for matched user; accidental wrong `SUPER_ADMIN_PASSWORD` locks admin out until corrected.

---

## 8. Exact production commands

### 8.1 Initial bootstrap (email)

```powershell
cd D:\BPA_Data\backend-api
cross-env SUPER_ADMIN_EMAIL=admin@yourdomain.com SUPER_ADMIN_PASSWORD="<strong-password>" SUPER_ADMIN_NAME="BPA Super Admin" npm run admin:bootstrap
```

### 8.2 Initial bootstrap (phone)

```powershell
cross-env SUPER_ADMIN_PHONE=017XXXXXXXX SUPER_ADMIN_PASSWORD="<strong-password>" npm run admin:bootstrap
```

### 8.3 Verify

```powershell
npm run admin:verify
```

Expected: `hasPasswordHash: true`, `hasSuperAdminRole: true`, `superAdminRoleExists: true`, whitelist active.

### 8.4 Whitelist only (no user/password)

```powershell
cross-env SUPER_ADMIN_WHITELIST_EMAILS=admin@yourdomain.com SUPER_ADMIN_WHITELIST_PHONES=017XXXXXXXX TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const w=require('./prisma/seeders/seedSuperAdminWhitelist').default; (async()=>{ await w(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

---

## 9. Super Admin recovery procedure

1. Confirm `DATABASE_URL` and env vars on server.
2. Set `SUPER_ADMIN_EMAIL` or `SUPER_ADMIN_PHONE` to the identity to recover.
3. Set new `SUPER_ADMIN_PASSWORD`.
4. Run `npm run admin:bootstrap`.
5. Run `npm run admin:verify`.
6. Test login with **single** phone/email (not comma-separated env value).
7. If still blocked, check `superAdminWhitelist.isActive` and `isAdminAllowed` env allowlists.

If bootstrap cannot run (DB restore scenario): restore `user`, `user_auth`, `user_global_roles` from backup.

---

## 10. Classification

| Command | Class | Production safe? |
|---------|-------|------------------|
| `admin:bootstrap` | **WARNING** | Yes — intentional credential management |
| `admin:verify` | **SAFE** | Yes |
| `seedSuperAdminWhitelist` (step 7) | **SAFE/WARNING** | Yes — whitelist sync only |
| `seedGlobalCountryRoles` PLATFORM_ADMIN assign | **WARNING** | Yes — adds role to existing users |

---

*Audit complete. No application code was modified.*
