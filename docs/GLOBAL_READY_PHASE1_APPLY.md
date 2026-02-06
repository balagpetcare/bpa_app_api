# Global-Ready Phase 1 – Apply Steps

**Reference:** [GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md), BPA_STANDARD.md, PROJECT_CONTEXT.md.

## Touch points (Phase 1 Foundation)

| Item | Location |
|------|----------|
| Country + policy models | `prisma/schema.prisma` |
| Migration SQL | `prisma/migrations/20260129000000_add_country_and_policy_tables/migration.sql` |
| Seed: countries | `prisma/seeders/seedCountries.ts` |
| Seed: BD policy | `prisma/seeders/seedCountryPolicies.ts` |
| Seed entry | `prisma/seed.ts` |
| Policy Engine | `src/api/v1/services/policyEngine.service.ts` |
| Country context middleware | `src/middlewares/countryContext.ts` |
| Express types | `src/types/express.d.ts` |
| App middleware | `src/app.ts` |
| Env example | `.env.example` (COUNTRY_DEFAULT, POLICY_CACHE_TTL_SEC) |

## Apply steps (merge-only; no overwrite)

1. **Migration**
   - From repo root:
     `npx prisma migrate deploy`
     (or `npx prisma migrate dev` if you want to create a new migration from schema).
   - If your project uses a different migrations folder, copy
     `prisma/migrations/20260129000000_add_country_and_policy_tables/migration.sql`
     into your migration pipeline.

2. **Generate Prisma client**
   `npx prisma generate`

3. **Seed**
   `npx prisma db seed`
   - Seeds countries BD, IN, US and BD ACTIVE policy (DONATION=true, PRODUCTS=true + donation rules).

4. **Env (optional)**
   - In `.env`: `COUNTRY_DEFAULT=BD` (default when `X-Country-Code` is missing).
   - Optional: `POLICY_CACHE_TTL_SEC=300` (Redis cache TTL for policy).

5. **Checkpoint**
   - Call any API with header `X-Country-Code: BD` (or omit for default BD).
   - Verify `req.countryContext` in a route: `countryCode` and `policy` (BD should have DONATION + PRODUCTS enabled).

## Runtime behaviour

- **Country resolution:** `X-Country-Code` header → (future: user profile) → (future: org) → default BD.
- **Policy cache:** Redis key `policy:{code}:active`, TTL from `POLICY_CACHE_TTL_SEC` (default 300s).
- **No country header:** `countryContext.countryCode = BD`, `countryContext.policy` = active BD policy or `null` if not seeded.

## Ports (unchanged)

- API: 3000
- Next.js: 3100–3104
(BPA_STANDARD.md)
