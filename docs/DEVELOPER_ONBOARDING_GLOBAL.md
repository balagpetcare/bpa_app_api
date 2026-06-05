# Developer Onboarding – Global-Ready (Country-First)

**Audience:** New developers on BPA / WorldPetsAssociation. Env, DoD, and error standards for Global-Ready work.

*(See [GLOBAL_READY_MASTER.md](./GLOBAL_READY_MASTER.md) for philosophy and rules.)*

---

## 1. Environment

### Backend (backend-api)

```env
# Required
DATABASE_URL=postgresql://...
JWT_SECRET=...

# Global-Ready
COUNTRY_DEFAULT=BD
POLICY_CACHE_TTL_SEC=300

# Phase 2
RL_DONATION_WINDOW_MS=60000
RL_DONATION_MAX=30

# Phase 3
STORAGE_USE_COUNTRY_PREFIX=true
RL_GEOCODE_WINDOW_MS=60000
RL_GEOCODE_MAX=60

# Phase 4
GOVT_REPORTING_DONATION_THRESHOLD=50000
GOVT_REPORTING_WEBHOOK_URL=https://...
```

### Web (bpa_web)

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
```

- Country is resolved from subdomain (bd., in.) or `localStorage` key `bpa_country_code` or default BD.
- All API calls via `lib/api.ts` send `X-Country-Code`.

### App (bpa_app)

- Country is set on first launch (CountryPickerScreen) and stored in SharedPreferences `bpa_country_code`.
- `ApiClient` adds header `X-Country-Code` to all requests.

---

## 2. Definition of Done (Global-Ready)

- New API that depends on country: use `req.countryContext` (set by middleware); do not assume BD in code.
- New feature that is country-gated: add/use `PolicyFeature` and `requireFeature('XXX')` or check policy in service.
- New frontend flow that shows donation/ads: check policy features (e.g. `usePolicyFeatures()` or `/api/v1/meta/features`) and hide/disable when off.
- Migrations: additive only; document in Phase apply doc and run in order.
- Errors: use standard codes (e.g. `POLICY_DENIED`, `FEATURE_DISABLED`) and reason_code where specified.

---

## 3. Error Standards

| Scenario | HTTP | Body / Code |
|---------|------|-------------|
| Feature disabled for country | 403 | `code: "POLICY_DENIED"`, `reason_code: "FEATURE_DISABLED"` |
| Donation limit exceeded | 403 | `code: "POLICY_DENIED"`, `reason_code: "LIMIT_EXCEEDED"` |
| Donation pending review | 202 | `code: "PENDING_REVIEW"` |
| No country context | 403 | `code: "POLICY_DENIED"`, `reason_code: "NO_COUNTRY_CONTEXT"` |

Helpers: `sendPolicyDenied(res, reason_code, message)` in `src/api/v1/utils/policyResponses.ts`.

---

## 4. Key Repos / Ports

- **backend-api:** 3000 (API), Prisma, Redis (policy cache), MinIO
- **bpa_web:** Next.js 3100–3107 (mother/staff, shop, clinic, admin, owner, producer, country, doctor)
- **bpa-landing:** 3101 · **vaccination_2026:** 3110 · **API:** 3000 — see [infrastructure/PORT_AND_DOMAIN_MAP.md](./infrastructure/PORT_AND_DOMAIN_MAP.md)
- **bpa_app:** Flutter (Riverpod), uses same API base URL

---

## 5. First-Time Setup (Global-Ready)

1. Clone backend-api, bpa_web, bpa_app.
2. Backend: copy `.env.example` → `.env`, set `DATABASE_URL`, `JWT_SECRET`, `COUNTRY_DEFAULT=BD`.
3. Run migrations: `npx prisma migrate deploy` (or `migrate dev`).
4. Run seed: `npx prisma db seed`.
5. Start API (e.g. `npm run dev`).
6. Web: set `NEXT_PUBLIC_API_BASE_URL`, run Next.js.
7. App: set API base via env/dart-define; first launch will show country picker, then normal flow.
8. Verify: `GET /api/v1/meta/features?countryCode=BD` returns `{ data: { countryCode: "BD", features: { ... } } }`.
