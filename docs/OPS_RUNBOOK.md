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

## 5) Producer governance (Phase 3)

- **Metrics:** `GET /api/v1/admin/producers/:orgId/metrics` — use for dashboards/monitoring (counts, usage, last activity). Multi-tenant: only data for that `orgId`.
- **Audit:** Audit timeline supports `fromDate`, `toDate`, `entityType`, `actionKey`. Index on `producer_audit_logs(producerOrgId, action, createdAt)` for performance.
- **Print jobs:** `GET /api/v1/admin/producers/:orgId/print-jobs` — audit-derived view (actions BATCH_PRINTED, BATCH_REPRINTED). Optional date range.
- **Approvals:** Filter by producer with `?producerOrgId=:id`. No cross-org data.
- **Common tasks:** Suspend/unsuspend via POST to `/admin/producers/:orgId/suspend` or `unsuspend`. Quotas and feature flags via PUT to `/admin/producers/:orgId/quotas` and `/admin/producers/:orgId/flags`. All admin write actions are audited.

## 6) Producer governance — Perf checklist (Phase 4)

- **Caps:** Audit and print-jobs: `limit` default 50, max 200. Approvals: same. Enforced in service/controller.
- **Ordering:** Audit, print-jobs, and approvals use stable sort: `createdAt desc`, then `id desc` (avoids pagination drift).
- **Indexes:** `producer_audit_logs(producerOrgId, action, createdAt)`; `audit_events(orgId, createdAt)`. Use for date-range and filter queries.
- **N+1:** Producer list batches flags per org; approvals list batches orgs/products/batches; staff uses single include. No per-row DB calls in list flows.

## 7) Troubleshooting by traceId

- Every governance response includes a `traceId` (from header `X-Trace-Id` / `X-Request-Id` or server-generated). Use it to correlate logs and support tickets.
- Server logs for governance use the `[governance]` prefix and include `traceId`, `userId`, `orgId` (when applicable). Example: `{"level":"error","traceId":"trc_...","userId":1,"orgId":"42","message":"admin_producers.list failed",...}`.
- To find all logs for a request: grep logs for the traceId value. In production, ensure log aggregation (e.g. CloudWatch, Datadog) indexes `traceId` for fast lookup.

## 8) Jobs & monitoring (future)

- Background jobs queue (BullMQ/Redis) recommended for:
  - compliance review notifications
  - reporting exports
  - large media post-processing
- Monitoring:
  - Track API errors per country
  - Track policy cache hit/miss

