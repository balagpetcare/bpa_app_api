# Phase 4: Ads + Govt Reporting + RBAC – Apply Steps

**Reference:** [GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md) Phase 4.

## Summary of changes

- **4.1 Ads:** `Ad` model, `PolicyAdsRule`, public `GET /api/v1/ads/serve`, admin CRUD under `/api/v1/admin/ads`.
- **4.2 Govt reporting:** `govtReporting.service` – threshold exceeded → log + optional webhook; hooked in donate and admin donation approve.
- **4.3 RBAC:** `RoleScope` + GLOBAL/COUNTRY; `UserGlobalRole`, `UserCountryRole`; seed global/country roles and permissions.
- **4.4 Permissions API:** `GET /api/v1/me/permissions` (scope + action); admin assign/unassign global and country roles under `/api/v1/admin/user-roles`.

---

## 1. Database

Run migration (or apply SQL manually):

```bash
cd backend-api
npx prisma migrate deploy
# Or if using dev: npx prisma migrate dev --name phase4_ads_govt_rbac
```

Migration: `prisma/migrations/20260129130000_phase4_ads_govt_rbac/migration.sql`

- Adds `GLOBAL`, `COUNTRY` to enum `RoleScope`.
- Creates `policy_ads_rules`, `ads`, `user_global_roles`, `user_country_roles`.

---

## 2. Prisma client

```bash
npx prisma generate
```

---

## 3. Seed

```bash
npx prisma db seed
```

This runs `seedGlobalCountryRoles` (global/country roles + permissions) and adds `ADS` to BD policy features in `seedCountryPolicies`.

---

## 4. Environment (optional)

In `.env`:

```env
# Phase 4: Govt reporting
GOVT_REPORTING_DONATION_THRESHOLD=50000
GOVT_REPORTING_WEBHOOK_URL=https://your-govt-endpoint/report
```

If not set, only logging is done when threshold is exceeded.

---

## 5. API touch points

| Area | Change |
|------|--------|
| **Ads** | `GET /api/v1/ads/serve` (public, no auth; uses `X-Country-Code` / default BD). Returns `[]` if ADS disabled. |
| **Admin ads** | `GET/POST /api/v1/admin/ads`, `PATCH/DELETE /api/v1/admin/ads/:id` (auth + admin). |
| **Govt reporting** | After donate and after admin donation approve, if amount ≥ threshold: log + optional POST to `GOVT_REPORTING_WEBHOOK_URL`. |
| **Permissions** | `GET /api/v1/me/permissions` (auth) → `{ permissions: [{ key, scope }], roles: [...] }`. Uses `req.countryContext.countryCode` for country roles. |
| **Admin user roles** | `GET /api/v1/admin/user-roles/global-roles`, `GET /api/v1/admin/user-roles/country-roles`. `GET/POST/DELETE .../users/:userId/global-roles`, `.../users/:userId/country-roles` (body: `roleId` or `roleId`+`countryId`). |

---

## 6. New files

- `src/api/v1/services/govtReporting.service.ts`
- `src/api/v1/services/permissions.service.ts`
- `src/api/v1/modules/ads/` (ads.service, ads.controller, ads.routes)
- `src/api/v1/modules/admin_user_roles/` (controller, routes)
- `prisma/seeders/seedGlobalCountryRoles.ts`
- `prisma/migrations/20260129130000_phase4_ads_govt_rbac/migration.sql`

---

## 7. Checkpoint

1. Call `GET /api/v1/ads/serve` (with optional `X-Country-Code: BD`) → `{ success: true, data: [] }` or list of ads if any.
2. Call `GET /api/v1/me/permissions` (auth) → `{ permissions, roles }`.
3. Admin: list global/country roles, assign a global role to a user, then call `GET /api/v1/me/permissions` again and confirm permission appears.
