# MVP Global Launch Checklist

**Purpose:** Pre-launch checklist for going live with Global-Ready (Country-First) BPA.

*(Reference: [GLOBAL_READY_MASTER.md](./GLOBAL_READY_MASTER.md).)*

---

## Backend (backend-api)

- [ ] All Phase 1–4 migrations applied (`npx prisma migrate deploy`).
- [ ] Seed run: countries, policies, roles/permissions, BD policy with DONATION, PRODUCTS, ADS as desired (`npx prisma db seed`).
- [ ] Env: `COUNTRY_DEFAULT`, `POLICY_CACHE_TTL_SEC`, donation rate limit, govt reporting threshold/webhook (if used).
- [ ] Redis available for policy cache (or accept no-cache fallback).
- [ ] `GET /api/v1/meta/features?countryCode=BD` returns expected features.
- [ ] Donation flow: policy gate, idempotency, hold list, admin status update tested.
- [ ] Ads serve: `GET /api/v1/ads/serve` returns list (or empty) for BD.
- [ ] RBAC: global/country roles seeded; `GET /api/v1/me/permissions` returns permissions when authenticated.

---

## Web (bpa_web)

- [ ] `NEXT_PUBLIC_API_BASE_URL` set for target API.
- [ ] All API calls go through `lib/api.ts` (or attach `X-Country-Code` via `getApiHeaders()`).
- [ ] Country context: subdomain or localStorage `bpa_country_code` or default BD.
- [ ] Donation/ads UI hidden or disabled when policy features are off (e.g. `usePolicyFeatures()`).

---

## App (bpa_app)

- [ ] API base URL configured (dart-define or env).
- [ ] First launch: country picker shown; selection persisted; subsequent launches skip picker unless cleared.
- [ ] All API requests send `X-Country-Code` (ApiClient uses stored country).
- [ ] Donation/ads entry points hidden when policy disables DONATION/ADS (e.g. drawer, cause section).

---

## New Country Rollout

- [ ] Country row added; ACTIVE policy created with features and rules.
- [ ] Payment methods and donation limits configured.
- [ ] Policy cache invalidated or API restarted.
- [ ] Verified with `X-Country-Code` and `/meta/features`; donation/ads tested if enabled.

---

## Docs & Ops

- [ ] [GLOBAL_READY_MASTER.md](./GLOBAL_READY_MASTER.md) and [DEVELOPER_ONBOARDING_GLOBAL.md](./DEVELOPER_ONBOARDING_GLOBAL.md) reviewed.
- [ ] [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md) updated with Global-Ready section and links.
- [ ] Runbook or ops note for policy cache invalidation and govt reporting webhook.
