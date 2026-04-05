# Ops Runbook (Global-Ready)

Purpose: day-2 operational checklist for country-first rollout.

## 1) Policy cache invalidation

- Redis key: `policy:{countryCode}:active`
- On policy update:
  - Call `invalidatePolicyCache(countryCode)` in API, or
  - Manually delete Redis key.

## 2) Migrations + seed

Apply migrations in order and then run seed:

1. `npx prisma migrate deploy`
2. `npx prisma generate`
3. `npx prisma db seed`

## 3) Donation abuse protection

- `DONATION_FRAUD_MAX_PER_HOUR` controls velocity hold.
- When exceeded, donation status becomes `ON_HOLD_REVIEW`.
- Admin review endpoints:
  - `GET /api/v1/fundraising/admin/donations/hold`
  - `PATCH /api/v1/fundraising/admin/donations/:id/status`

## 4) MinIO readiness

- Use `STORAGE_USE_COUNTRY_PREFIX=true` for country prefixes.
- When scaling: create country buckets or prefix rules per country.

## 5) Jobs & monitoring (future)

- Background jobs queue (BullMQ/Redis) recommended for:
  - compliance review notifications
  - reporting exports
  - large media post-processing
- Monitoring:
  - Track API errors per country
  - Track policy cache hit/miss

