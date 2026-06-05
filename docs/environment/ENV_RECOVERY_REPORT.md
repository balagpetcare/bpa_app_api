# BPA Backend — Environment Recovery Report

**Date:** 2026-06-05  
**Project:** `backend-api`  
**Issue:** Missing `.env` — Prisma and services could not start

---

## Executive summary

A full static audit of `src/`, `scripts/`, `prisma/`, and `prisma.config.ts` discovered **244 environment variables**. The existing `.env.example` covered most production concerns but used dev-specific sample values and omitted several variables found in code.

**Deliverables created:**

| Artifact | Path |
|----------|------|
| Variable audit | `docs/environment/ENVIRONMENT_VARIABLE_AUDIT.md` |
| Local setup guide | `docs/environment/LOCAL_SETUP_GUIDE.md` |
| Complete template | `.env.example` (placeholders only) |
| Startup validator | `scripts/validate-env.ts` |
| Inventory generator | `scripts/_extract-env-vars.mjs` → `scripts/_env-inventory.json` |

---

## Totals

| Metric | Count |
|--------|-------|
| Variables discovered (code scan) | **244** |
| Documented in updated `.env.example` | **~120** (active + commented optional) |
| Critical for API process start | **1** (`DATABASE_URL`) |
| Critical for production-safe operation | **8+** (see below) |
| Payment gateways integrated | **5** (no SurjoPay) |
| SMS providers integrated | **2** (+ mock for dev/test) |

---

## Critical missing variables (typical fresh `.env`)

These block or severely degrade startup when absent:

| Variable | Impact |
|----------|--------|
| `DATABASE_URL` | **Blocks startup** — `prismaClient.ts` throws on import |
| `JWT_SECRET` | Auth/token signing fails in `lib/auth.ts`; insecure fallback elsewhere |
| `SHADOW_DATABASE_URL` | Blocks `prisma migrate dev` only |

---

## Services blocked by missing credentials

| Service | Blocked when | Dev behavior | Production behavior |
|---------|--------------|--------------|---------------------|
| **PostgreSQL / Prisma** | No `DATABASE_URL` | Cannot start | Cannot start |
| **JWT auth** | No `JWT_SECRET` | Weak fallback; some paths throw | Must set secret |
| **Payment checkout** | Active provider creds empty | Warns; API starts | **Exits** on bootstrap failure |
| **MinIO / B2 storage** | Invalid endpoint/creds | Warns; may continue | **Exits** on bootstrap failure |
| **SMS sending** | No API key/sender | Mock/dev fake if flags set | Sends fail unless `SMS_ALLOW_MOCK` |
| **BullMQ queues** | Redis unavailable | In-memory fallback | SMS/email queues degraded |
| **SMTP email** | No SMTP_* | Skipped silently | Worker marks delivery FAILED |
| **Google OAuth** | No `GOOGLE_CLIENT_ID` | Endpoint returns not configured | Same |
| **Wallet payout encryption** | No `WALLET_PAYOUT_DETAILS_KEY` | May fail on payout write | Security risk |

---

## Payment gateway audit

| Gateway | Status | Required env vars | Callback base |
|---------|--------|-------------------|---------------|
| **SSLCommerz** | Integrated | `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` | `{API_PUBLIC_BASE_URL}/api/v1/payments/webhook*` |
| **EPS** | Integrated | `EPS_USERNAME`, `EPS_PASSWORD`, `EPS_HASH_KEY`, `EPS_STORE_ID`, `EPS_MERCHANT_ID` | `{API_PUBLIC_BASE_URL}/api/v1/payments/payment/eps/callback/*` |
| **bKash** | Integrated | `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD` | `{API_PUBLIC_BASE_URL}/api/v1/payments/webhook` |
| **Nagad** | Integrated | `NAGAD_MERCHANT_ID`, `NAGAD_PUBLIC_KEY`, `NAGAD_PRIVATE_KEY` | Same webhook path |
| **AmarPay** | Integrated | `AMARPAY_STORE_ID`, `AMARPAY_SIGNATURE_KEY` | Same webhook path |
| **SurjoPay** | **Not found** | N/A | N/A |

**Missing credentials (expected on fresh `.env`):** All gateway store/API fields are empty placeholders until sandbox/production keys are supplied.

**Default active provider in code:** `eps` when `PAYMENT_PROVIDER` unset. `.env.example` documents `sslcommerz` as a common choice — set explicitly to avoid ambiguity.

---

## SMS gateway audit

| Provider | Env vars | Notes |
|----------|----------|-------|
| **BulkSMSBD** (primary) | `SMS_API_KEY` or `BULKSMSBD_API_*`, `SMS_SENDER_ID` / `BULKSMSBD_SENDER_ID` | Modes: `legacy`, `rest_v3` |
| **SSL Wireless** (fallback) | `SSL_WIRELESS_API_TOKEN`, `SSL_WIRELESS_SENDER_ID` | Used when primary fails |
| **Mock** | `SMS_ALLOW_MOCK=true` | Dev/test only; blocked in production unless explicitly enabled |

---

## Storage audit

| Mode | Provider value | Required vars |
|------|----------------|---------------|
| Local dev | `minio` | `AWS_ENDPOINT`, bucket, keys; run `npm run storage:init` |
| Production | `b2` | `S3_*`, `STORAGE_PUBLIC_URL` (CDN/download URL, not S3 API endpoint) |

Upload paths use country prefix when `STORAGE_USE_COUNTRY_PREFIX=true` (default): keys like `BD/...`.

---

## Prisma recovery status

| Component | Status |
|-----------|--------|
| `prisma.config.ts` | OK — reads `DATABASE_URL`, `SHADOW_DATABASE_URL` |
| `prisma/schema/` | OK — `env("DATABASE_URL")` in base schema |
| Migrations | OK — use `npm run prisma:migrate` after URL set |
| Client generation | OK — `postinstall` runs `prisma generate` |

**Recovery steps:** Set `DATABASE_URL` → `npm run setup:prisma` → `npm run prisma:migrate` → `npm run dev`

---

## Startup readiness checklist

| Step | Command | Expected |
|------|---------|----------|
| 1. Copy template | `cp .env.example .env` | File created |
| 2. Set DATABASE_URL + JWT_SECRET | edit `.env` | Values present |
| 3. Validate | `npm run validate:env` | Pass (warnings OK in dev) |
| 4. Infra | `npm run dev:infra` | Postgres, Redis, MinIO up |
| 5. Migrate | `npm run prisma:migrate` | Migrations applied |
| 6. Storage init | `npm run storage:init` | Bucket ready |
| 7. Start API | `npm run dev` | `Server running at http://0.0.0.0:3000/api/v1` |

**Current status (without `.env`):** Not ready — copy template and set `DATABASE_URL` first.

**Minimum viable local dev:** `DATABASE_URL`, `JWT_SECRET`, Docker infra, `npm run storage:init`.

**Production readiness additionally requires:** real `JWT_SECRET`, `API_PUBLIC_BASE_URL`, active payment provider credentials, B2 storage + `STORAGE_PUBLIC_URL`, Redis, SMS credentials, wallet/auth signing secrets.

---

## Security notes

- No secrets were invented or embedded in this recovery.
- `.env.example` uses **empty placeholders** for all credentials.
- Dev-only flags (`SMS_ALLOW_MOCK`, `SMS_ALLOW_DEV_FAKE_SENT`, `CAMPAIGN_TEST_OTP`) documented but not enabled by default.
- Validation script treats `change_me*` values as placeholders in production checks.

---

## Next steps for operators

1. Copy `.env.example` → `.env`
2. Obtain real credentials from team vault / hosting provider
3. Run `npm run validate:env` until critical checks pass
4. Follow [LOCAL_SETUP_GUIDE.md](./LOCAL_SETUP_GUIDE.md) for full stack
5. Re-run `node scripts/_extract-env-vars.mjs` after major code changes to refresh inventory
