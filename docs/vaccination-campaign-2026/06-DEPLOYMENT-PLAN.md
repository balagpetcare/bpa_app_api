# 06 — Deployment Plan

**Campaign:** BPA 2026 Cat Flu + Rabies Vaccination  
**Systems:** backend-api · bpa_web · vaccination_2026 · bpa_app (optional)

---

## 1. Architecture overview

```
                    ┌─────────────────┐
                    │ vaccination_2026 │  Landing + /book
                    │   (Next.js)      │
                    └────────┬────────┘
                             │ HTTPS
                    ┌────────▼────────┐
                    │   backend-api    │  /api/v1/campaign/*
                    │   + Redis        │  /api/v1/campaign-link/*
                    │   + Worker       │
                    └────────┬────────┘
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼────┐  ┌──────▼──────┐  ┌───▼────────┐
     │   bpa_web   │  │ PostgreSQL  │  │ SMS GW     │
     │ admin/staff │  │             │  │ SSL/Bulk   │
     └─────────────┘  └─────────────┘  └────────────┘
              │
     ┌────────▼────┐
     │   bpa_app   │  Optional; campaign-link JWT
     │   (Flutter) │
     └─────────────┘
```

---

## 2. Environments

| Env | API | Campaign site | Marketing landing | Web admin/staff | Purpose |
|-----|-----|---------------|-------------------|-----------------|---------|
| **Local** | `:3000` | `:3110` (`vaccination_2026`) | `:3101` (`bpa-landing`) | `:3100`–`:3107` (`bpa_web`) | Dev |
| **Staging** | `api-staging.bpa…` | `vaccination-staging.bpa…` | `staging.bpa…` | `admin-staging.bpa…` | UAT, payment/SMS sandbox |
| **Production** | `api.bpa…` | `vaccination.bpa…` | `bangladeshpetassociation.com` | `admin.bpa…` / staff URL | Live |

Port and domain reference: [../infrastructure/PORT_AND_DOMAIN_MAP.md](../infrastructure/PORT_AND_DOMAIN_MAP.md)

All non-prod must use **separate** DB, Redis, SMS sender IDs (where provider allows), and payment sandbox keys.

---

## 3. Pre-deployment checklist

- [ ] All PRs merged to release branch  
- [ ] `03-BUG-LIST.md` P0 reviewed  
- [ ] Database backup confirmed (<24h)  
- [ ] Migration SQL reviewed: `prisma/migrations/20260602_add_vaccination_campaign_2026/`  
- [ ] Increase `max_locks_per_transaction` if needed for migration (see PHASE-2-AUDIT)  
- [ ] Secrets updated in vault (see §5)  
- [ ] Rollback tag identified (`git tag release-campaign-YYYY-MM-DD`)  

---

## 4. Deployment order

Deploy in this sequence to maintain API contract compatibility:

| Step | Component | Command / action | Verify |
|------|-----------|------------------|--------|
| **1** | PostgreSQL migration | `npm run prisma:migrate:deploy` (maintenance window) | Tables exist |
| **2** | Prisma client | `npx prisma generate` in API build | Build succeeds |
| **3** | **backend-api** | Deploy API + run migrations on start if automated | `GET /api/v1/campaign/public/campaigns` 200 |
| **4** | **Redis + worker** | Deploy `worker:notifications` | OTP test message |
| **5** | **vaccination_2026** | `npm run build` → deploy | Landing `/` + `/book` |
| **6** | **bpa_web** | Production build → deploy admin + staff | `/admin/campaigns`, `/staff/campaign` |
| **7** | **bpa_app** (optional) | `flutter build apk` with `--dart-define-from-file=env/prod.json` | Hub smoke |
| **8** | **Campaign activate** | Admin → set campaign ACTIVE, publish slots | Public list shows campaign |
| **9** | **Provider webhooks** | Register payment + SMS callback URLs | Test callback 200 |

**Downtime expectation:** Migration step may require 5–30 min read-only window if lock limits require it.

---

## 5. Environment variables (production minimum)

### backend-api

```env
# Core
DATABASE_URL=
APP_URL=https://api.example.com
JWT_SECRET=

# Campaign payment
CAMPAIGN_PAYMENT_WEBHOOK_SECRET=

# Redis + worker
REDIS_ENABLED=true
REDIS_URL=

# SMS
SMS_ENABLED=true
SMS_PRIMARY_PROVIDER=ssl_wireless
SMS_FALLBACK_PROVIDER=bulksmsbd
SSL_WIRELESS_API_TOKEN=
SSL_WIRELESS_SENDER_ID=
BULKSMSBD_API_TOKEN=
BULKSMSBD_SENDER_ID=
CAMPAIGN_SMS_SENDER_ID=

# Payment gateways (when live — replace mock)
# BKASH_*, NAGAD_*, SSLCOMMERZ_* per existing Order integration

# Certificate PDF
# Puppeteer bundled with API image or CHROME_PATH set
```

### vaccination_2026

```env
NEXT_PUBLIC_API_BASE_URL=https://api.example.com
NEXT_PUBLIC_CAMPAIGN_SLUG=2026-cat-flu-rabies
# Optional videos:
NEXT_PUBLIC_HERO_VIDEO_URL=
NEXT_PUBLIC_PROMO_VIDEO_URL=
```

### bpa_web

Uses same API base as existing admin/staff (`lib/api.ts` / env convention for deployment host).

### bpa_app

```json
{
  "API_BASE_URL": "https://api.example.com"
}
```

---

## 6. Database migration procedure

1. Announce maintenance window to ops  
2. Scale API to 0 or enable read-only mode (if available)  
3. Snapshot DB  
4. Run:

```bash
cd backend-api
npm run prisma:migrate:deploy
npx prisma generate
```

5. Verify:

```sql
SELECT COUNT(*) FROM campaign_bookings;
SELECT COUNT(*) FROM campaigns;
```

6. Seed production campaign (if not migrated from staging):

- 1 campaign row, locations, vaccine types, slots  
- CampaignStaff assignments  

7. Scale API up  

**If migration fails (locks):** Increase `max_locks_per_transaction`, retry; do not partial-apply without DBA review.

---

## 7. Worker deployment

SMS and platform notifications share the worker:

```bash
REDIS_ENABLED=true npm run worker:notifications
```

| Check | Command / observation |
|-------|----------------------|
| Worker connected | Log: worker started |
| Queue depth | Redis `LLEN bull:notif_sms:*` |
| Test OTP | Landing booking step 3 |

Run **at least 2 worker instances** in production for redundancy (same Redis).

---

## 8. Webhook registration

| Provider | URL | Auth |
|----------|-----|------|
| Payment (bKash/Nagad/SSL) | `POST {API}/api/v1/campaign/public/payments/webhook` | Header `x-campaign-payment-secret` |
| SMS delivery | `POST {API}/api/v1/campaign/public/sms/delivery-callback` | IP allowlist (recommended) |

Test with provider sandbox **before** setting campaign ACTIVE.

---

## 9. Post-deployment verification (30 min)

Run in order:

1. **API smoke** — public campaigns, availability, auth OTP (test phone)  
2. **Landing** — complete FREE test booking on staging phone  
3. **Staff** — check-in + mock vaccination in staging clinic  
4. **Admin** — dashboard metrics update  
5. **Payment** (if paid) — sandbox payment + webhook  
6. **Flutter** — login, import, view booking  
7. **Monitor** — error rate, SMS failures, queue lag  

Document results in `02-UAT-CHECKLIST.md`.

---

## 10. CI/CD recommendations (not yet fully automated)

| Repo | Suggested pipeline |
|------|-------------------|
| backend-api | Test `campaign|sms` → build → migrate deploy → deploy API → deploy worker |
| vaccination_2026 | `npm run build` on PR; deploy on tag |
| bpa_web | Build + lint; deploy on tag |
| bpa_app | `flutter analyze lib/features/campaign` on PR; manual store release |

---

## 11. Release tagging

```bash
# backend-api
git tag -a campaign-v1.0.0 -m "2026 vaccination campaign production"
git push origin campaign-v1.0.0
```

Record tag in deployment log with deployer, time, and migration version.

---

## 12. Related documents

| Doc | Purpose |
|-----|---------|
| `04-LAUNCH-CHECKLIST.md` | Go/no-go + readiness score |
| `05-ROLLBACK-PLAN.md` | Reverse deploy |
| `17-deployment-plan.md` | Original design doc (superseded operationally by this file) |
| `18-rollout-plan.md` | Phased rollout strategy |
| `PHASE-2-AUDIT.md` | Integration verification |

---

## 13. Deployment log (fill on launch)

| Field | Value |
|-------|-------|
| Date | |
| Deployer | |
| API tag | |
| Landing build | |
| Web build | |
| Migration version | |
| Campaign ID | |
| Issues | |
| Sign-off | |
