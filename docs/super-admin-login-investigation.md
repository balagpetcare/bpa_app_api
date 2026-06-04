# Super Admin Login Investigation

## Root Cause

`POST /api/v1/admin/auth/login` returned `User not found` because the admin login flow checks the `user_auth` table before it checks any super-admin whitelist.

The whitelist configuration and `SuperAdminWhitelist` table allow admin access for an existing authenticated user. They do not, by themselves, create a `users` / `user_auth` login record.

An additional configuration issue was found: `SUPER_ADMIN_PHONE` is set to a comma-separated list. The login credential field expects one phone value. Lists belong in `SUPER_ADMIN_WHITELIST_PHONES`.

## Login Flow

Route:

`POST /api/v1/admin/auth/login`

Files:

- Route: `src/api/v1/modules/admin_auth/admin_auth.routes.ts`
- Controller: `src/api/v1/modules/admin_auth/admin_auth.controller.ts`
- Service: `src/api/v1/services/authUnified.service.ts`
- Admin middleware for protected routes: `src/middleware/admin.middleware.ts`

Flow:

1. `admin_auth.routes.ts` registers `router.post("/login", ctrl.login)` as public.
2. `admin_auth.controller.ts` calls `performUnifiedLogin({ email, phone, password, options: { adminOnly: true } })`.
3. `authUnified.service.ts` runs `verifyCredentials()`.
4. `verifyCredentials()` queries `user_auth` by email or phone and includes the related `users` row.
5. If no `user_auth` + `users` row exists, it throws `User not found`.
6. If a row exists, bcrypt verifies `passwordHash`.
7. `resolveAuthContexts()` calls `isAdminAllowed(userId)`.
8. `isAdminAllowed()` checks `super_admin_whitelist`, then env allowlists (`ADMIN_EMAILS`, `ADMIN_PHONES`, `SUPER_ADMIN_WHITELIST_EMAILS`, `SUPER_ADMIN_WHITELIST_PHONES`, `ADMIN_USER_IDS`).
9. With `adminOnly: true`, login succeeds only if an ADMIN context is resolved.

## Bootstrap / Whitelist Findings

Environment variables found in code:

- `SUPER_ADMIN_WHITELIST_EMAILS`
- `SUPER_ADMIN_WHITELIST_PHONES`
- `SUPER_ADMIN_PHONE`
- `SUPER_ADMIN_PASSWORD`

Usage:

- `SUPER_ADMIN_WHITELIST_EMAILS` and `SUPER_ADMIN_WHITELIST_PHONES` are used by `prisma/seeders/seedSuperAdminWhitelist.ts`.
- That seeder only upserts rows into `super_admin_whitelist`.
- `seedGlobalCountryRoles.ts` can assign roles only to existing users found through `user_auth`.
- Before this fix, no seed script created a missing super-admin login user from `SUPER_ADMIN_PHONE` / `SUPER_ADMIN_PASSWORD`.

## Tables Involved

Admin login credentials:

- `user_auth`

User record:

- `users`

Admin allowlist:

- `super_admin_whitelist`

Role assignment:

- `roles`
- `user_global_roles`
- `permissions`
- `role_permissions`

## Records Found Before Fix

Queried:

- Phones: `017777889994`, `01701022274`
- Emails: `balag@bangladeshpetassociation.com`, `admin@bangladeshpetassociation.com`

Before fix:

- `user_auth`: 1 matching row existed.
- Existing login user: `01701022274`
- Existing user email: `null`
- Password hash existed: yes
- SUPER_ADMIN role link: no
- `balag@bangladeshpetassociation.com`: whitelist row existed, no login user.
- `admin@bangladeshpetassociation.com`: whitelist row existed, no login user.
- `017777889994`: no `user_auth` or whitelist match was found.
- Environment whitelist contained `01777889994`, not `017777889994`.
- `01701022274`: whitelist row existed.
- `SUPER_ADMIN` role existed.

## Fix Applied

Added:

- `scripts/bootstrap-super-admin.ts`
- `scripts/verify-super-admin.ts`
- npm scripts:
  - `npm run admin:bootstrap`
  - `npm run admin:verify`

Bootstrap behavior:

- Idempotent and safe to run multiple times.
- Ensures `global.admin` permission exists.
- Ensures `SUPER_ADMIN` role exists.
- Ensures `SUPER_ADMIN` has `global.admin`.
- Ensures whitelist rows from `SUPER_ADMIN_WHITELIST_EMAILS`, `SUPER_ADMIN_WHITELIST_PHONES`, and primary super-admin env values are active.
- Creates user if missing.
- Updates existing user if found by primary email/phone.
- Sets password from `SUPER_ADMIN_PASSWORD`.
- Creates/updates profile and wallet as needed.
- Assigns `SUPER_ADMIN` through `user_global_roles`.

Applied result:

- Existing user `userId=2` was updated.
- Email set to `balag@bangladeshpetassociation.com`.
- Phone remains `01701022274`.
- Password hash updated from `SUPER_ADMIN_PASSWORD`.
- `SUPER_ADMIN` role assigned.
- Whitelist rows active for:
  - `balag@bangladeshpetassociation.com`
  - `admin@bangladeshpetassociation.com`
  - `01777889994`
  - `01701022274`

## Verification Results

`npm run admin:verify` showed:

- `user_auth` row exists for `balag@bangladeshpetassociation.com` / `01701022274`.
- User status is `ACTIVE`.
- Password hash exists.
- User has `SUPER_ADMIN` role.
- Whitelist rows exist and are active.

Direct service login test passed for:

- `01701022274`
- `balag@bangladeshpetassociation.com`

Both returned:

- `contexts`: ADMIN / GLOBAL / ACTIVE
- `default_redirect`: `/admin`

Login with `process.env.SUPER_ADMIN_PHONE` failed because the env value is comma-separated. Use one phone at login, not the comma-separated value.

## Commands

Create or update super admin:

```bash
npm run admin:bootstrap
```

Re-run seed:

```bash
npm run db:seed
```

Verify super admin exists:

```bash
npm run admin:verify
```

Test login through the service:

```bash
node -r dotenv/config -r ts-node/register -e "const {performUnifiedLogin}=require('./src/api/v1/services/authUnified.service'); (async()=>{ const r=await performUnifiedLogin({phone:'01701022274',password:process.env.SUPER_ADMIN_PASSWORD,options:{adminOnly:true}}); console.log({success:true,userId:r.user.id,contexts:r.contexts,default_redirect:r.default_redirect}); })().catch(e=>{console.error({success:false,message:e.message,statusCode:e.statusCode}); process.exit(1);})"
```

Test login through HTTP:

```bash
curl -i -X POST http://localhost:3000/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"01701022274\",\"password\":\"$SUPER_ADMIN_PASSWORD\"}"
```

Use one of the actual login identifiers:

- `01701022274`
- `balag@bangladeshpetassociation.com`

Do not submit the comma-separated `SUPER_ADMIN_PHONE` env value as a login phone.
