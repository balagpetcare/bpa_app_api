# API Global-Ready Phases – 100% Checklist

**উদ্দেশ্য:** পরিকল্পনা অনুযায়ী API ফেজ ১–৪ সম্পূর্ণ; সারা বিশ্বে উন্মুক্ত করার জন্য API টাচ পয়েন্ট ভেরিফাই ও ডকুমেন্ট।

**রেফারেন্স:** [GLOBAL_READY_MASTER.md](./GLOBAL_READY_MASTER.md), [GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md)

---

## Phase 1: Foundation (Country + Policy + Context) – ✅ সম্পন্ন

| টাচ পয়েন্ট | লোকেশন | স্ট্যাটাস |
|-------------|---------|----------|
| Country + policy models | `prisma/schema.prisma` | ✅ |
| Migration | `prisma/migrations/20260129000000_add_country_and_policy_tables/` | ✅ |
| Seed: countries | `prisma/seeders/seedCountries.ts` | ✅ |
| Seed: BD policy | `prisma/seeders/seedCountryPolicies.ts` | ✅ |
| Policy Engine | `src/api/v1/services/policyEngine.service.ts` (getActivePolicy, Redis cache) | ✅ |
| Country context middleware | `src/middlewares/countryContext.ts` (X-Country-Code → default BD) | ✅ |
| Express types | `src/types/express.d.ts` (countryContext) | ✅ |
| App middleware | `src/app.ts` (countryContextMiddleware) | ✅ |
| Env | `.env.example`: COUNTRY_DEFAULT, POLICY_CACHE_TTL_SEC | ✅ |
| Public features API | `GET /api/v1/meta/features?countryCode=XX` | ✅ `src/api/v1/modules/meta/meta.controller.ts` |

**চেকপয়েন্ট:** `X-Country-Code: BD` বা হেডার ছাড়া কল করলে `req.countryContext` এ countryCode ও policy থাকে; `GET /api/v1/meta/features?countryCode=BD` → `{ success, data: { countryCode, features } }`।

---

## Phase 2: Donation + Compliance – ✅ সম্পন্ন

| টাচ পয়েন্ট | লোকেশন | স্ট্যাটাস |
|-------------|---------|----------|
| Response helpers | `src/api/v1/utils/policyResponses.ts` (sendPolicyDenied, sendPendingReview) | ✅ |
| Feature gate | `src/api/v1/middlewares/requireFeature.ts` (NO_COUNTRY_CONTEXT, NO_POLICY, FEATURE_DISABLED) | ✅ |
| Schema / Migration | Phase 2 donation compliance migration | ✅ |
| Donate: policy, idempotency, audit | `src/api/v1/modules/fundraising/fundraising.service.ts` | ✅ |
| Donate route order | `donationLimiter` → `auth` → `requireFeature('DONATION')` → `ctrl.donate` | ✅ `fundraising.routes.ts` |
| Rate limiter | `src/middleware/rateLimiters.ts` (donationLimiter) | ✅ |
| Admin hold list | `GET /api/v1/fundraising/admin/donations/hold` | ✅ |
| Admin status update | `PATCH /api/v1/fundraising/admin/donations/:id/status` | ✅ |
| Env | `.env.example`: RL_DONATION_WINDOW_MS, RL_DONATION_MAX | ✅ |

**চেকপয়েন্ট:** Policy OFF → 403 POLICY_DENIED; limit exceeded → reason_code LIMIT_EXCEEDED; Idempotency-Key একই রেসপন্স; Admin hold list + PATCH status।

---

## Phase 3: Storage + Payment + Location – ✅ সম্পন্ন

| টাচ পয়েন্ট | লোকেশন | স্ট্যাটাস |
|-------------|---------|----------|
| Schema / Migration | Phase 3 storage + location + payment | ✅ |
| Storage per country | `appConfig`, `media.service.ts`, `media.controller.ts` (countryCode prefix) | ✅ |
| Geocode + reverse | `GET /api/v1/locations/geocode?q=...`, `GET /api/v1/locations/reverse?lat=...&lng=...` | ✅ |
| Rate limit + cache | geocodeLimiter, Redis/in-memory cache in locations.controller | ✅ |
| Policy payment methods | `policyEngine.service.ts`: getActivePolicy includes paymentMethods, getPaymentMethods | ✅ |
| Payment gateway types | `src/api/v1/services/paymentGateway.types.ts` | ✅ |
| Env | `.env.example`: STORAGE_USE_COUNTRY_PREFIX, RL_GEOCODE_* | ✅ |

**চেকপয়েন্ট:** Geocode/reverse 200, cache; আপলোডে X-Country-Code: BD → key prefix BD/; BD policy এ paymentMethods।

---

## Phase 4: Ads + Govt Reporting + RBAC – ✅ সম্পন্ন

| টাচ পয়েন্ট | লোকেশন | স্ট্যাটাস |
|-------------|---------|----------|
| Ads model + serve | `GET /api/v1/ads/serve` (public, X-Country-Code); ADS disabled → [] | ✅ `ads.controller.ts`, `ads.routes.ts` |
| Admin ads CRUD | `GET/POST /api/v1/admin/ads`, `PATCH/DELETE /api/v1/admin/ads/:id` | ✅ |
| Govt reporting | `govtReporting.service.ts` – threshold → log + webhook | ✅ |
| Govt hook: donate | fundraising.service donate path এ notifyDonationThresholdExceeded | ✅ |
| Govt hook: admin approve | fundraising.service admin status SUCCESS path এ notifyDonationThresholdExceeded | ✅ |
| Permissions API | `GET /api/v1/me/permissions` (country-scoped roles) | ✅ `me.controller.ts`, permissions.service.ts |
| Admin user roles | global-roles, country-roles, users/:userId/global-roles, users/:userId/country-roles | ✅ `admin_user_roles.routes.ts` |
| Env | `.env.example`: GOVT_REPORTING_DONATION_THRESHOLD, GOVT_REPORTING_WEBHOOK_URL | ✅ |

**চেকপয়েন্ট:** `GET /api/v1/ads/serve` → { success, data }; `GET /api/v1/me/permissions` (auth) → { permissions, roles }; Admin assign global/country role।

---

## Env সারাংশ (.env.example)

| ভেরিয়েবল | ফেজ | ডিফল্ট / নোট |
|----------|-----|----------------|
| COUNTRY_DEFAULT | 1 | BD |
| POLICY_CACHE_TTL_SEC | 1 | 300 |
| RL_DONATION_WINDOW_MS | 2 | 60000 |
| RL_DONATION_MAX | 2 | 30 |
| STORAGE_USE_COUNTRY_PREFIX | 3 | true |
| RL_GEOCODE_WINDOW_MS | 3 | 60000 |
| RL_GEOCODE_MAX | 3 | 60 |
| GOVT_REPORTING_DONATION_THRESHOLD | 4 | 50000 |
| GOVT_REPORTING_WEBHOOK_URL | 4 | (optional) |

---

## রান অর্ডার (নতুন ডিপ্লয়)

1. `npx prisma migrate deploy` (Phase 1–4 মাইগ্রেশন)
2. `npx prisma generate`
3. `npx prisma db seed` (countries, policies, global/country roles, BD policy features)
4. `.env` এ প্রয়োজনীয় ভেরিয়েবল সেট (COUNTRY_DEFAULT, POLICY_CACHE_TTL_SEC, ইত্যাদি)
5. Redis চালু থাকলে policy cache কাজ করবে; না থাকলে DB fallback

---

## API 100% স্ট্যাটাস

- **Phase 1–4:** পরিকল্পনা অনুযায়ী সব টাচ পয়েন্ট ইমপ্লিমেন্ট ও চেকলিস্টে ভেরিফাই করা হয়েছে।
- **Phase 5–6:** Frontend (bpa_web/bpa_app) ও ডক/লঞ্চ প্রিপ – আলাদা ডক ও টাস্কে।

এই চেকলিস্ট অনুযায়ী API সারা বিশ্বে উন্মুক্ত করার জন্য (Country-First) ১০০% সম্পন্ন।
