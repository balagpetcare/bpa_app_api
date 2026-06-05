# BPA Backend — Environment Variable Audit

**Generated:** 2026-06-05  
**Scope:** `backend-api` (243 runtime + 1 Prisma-config variables discovered via static scan)  
**Regenerate inventory:** `node scripts/_extract-env-vars.mjs` → `scripts/_env-inventory.json`

## Summary

| Category | Variables | Critical for startup |
|----------|-----------|----------------------|
| Database / Prisma | 2 | `DATABASE_URL` |
| Auth / JWT | 12+ | `JWT_SECRET` (production) |
| Storage (MinIO / B2) | 14 | Provider-dependent |
| Redis / Queues | 10 | When `REDIS_ENABLED=true` |
| SMS | 22 | When `SMS_ENABLED=true` (production) |
| Email (SMTP) | 6 | Optional (email worker) |
| Payment gateways | 40+ | Active `PAYMENT_PROVIDER` (production) |
| Campaign / booking | 12 | Optional |
| Public URLs | 18 | `API_PUBLIC_BASE_URL` (payments) |
| Feature flags / jobs | 50+ | Optional |
| Scripts / CI only | 40+ | N/A |

**SurjoPay:** Not present in codebase — no integration found.

---

## Critical variables (API will not start or is unsafe without these)

| Variable | Required | Purpose | Used in | Default if unset |
|----------|----------|---------|---------|------------------|
| `DATABASE_URL` | **Yes** | PostgreSQL connection for Prisma 7 + `pg` adapter | `prisma.config.ts`, `src/infrastructure/db/prismaClient.ts` | **Throws on import** |
| `JWT_SECRET` | **Yes (prod)** | JWT signing for auth, sockets, campaign OTP | `src/lib/auth.ts`, `src/config/appConfig.ts`, `src/realtime/socketio.gateway.ts` | Dev fallback `"super-secret-key"` (insecure) |
| `SHADOW_DATABASE_URL` | **Yes (migrate dev)** | Prisma shadow DB for `migrate dev` | `prisma.config.ts` | Prisma CLI error |

---

## Database & Prisma

| Variable | Required | Purpose | Used in | Default |
|----------|----------|---------|---------|---------|
| `DATABASE_URL` | Yes | Primary PostgreSQL URL | Prisma, all DB access | — |
| `SHADOW_DATABASE_URL` | Migrate dev only | Shadow database for drift detection | `prisma.config.ts` | — |

**Prisma recovery notes:**
- Config: `prisma.config.ts` (Prisma 7+ — URL not in schema)
- Schema: `prisma/schema/` (merged via `prisma/schema.prisma`)
- Migrations: `prisma/migrations/` — use `npm run prisma:migrate` (`migrate deploy`)
- Seed: `npm run seed` → `prisma/seed.ts`
- Once `DATABASE_URL` is set: `npm run setup:prisma && npm run prisma:migrate`

---

## Auth & Admin

| Variable | Required | Purpose | Used in | Default |
|----------|----------|---------|---------|---------|
| `JWT_SECRET` | Prod | Access/refresh token HMAC | `src/lib/auth.ts`, auth controllers | Weak dev default |
| `JWT_EXPIRES_IN` | No | Token TTL | `src/config/appConfig.ts` | `7d` |
| `COOKIE_DOMAIN` | No | Cross-subdomain auth cookies | Auth/producer/doctor controllers | `localhost` |
| `SUPER_ADMIN_PHONE` | Seed | Bootstrap super-admin phone(s) | `scripts/bootstrap-super-admin.ts` | — |
| `SUPER_ADMIN_PASSWORD` | Seed | Bootstrap password | `scripts/bootstrap-super-admin.ts` | — |
| `SUPER_ADMIN_WHITELIST_EMAILS` | No | Admin panel login whitelist | `src/middleware/admin.middleware.ts` | — |
| `SUPER_ADMIN_WHITELIST_PHONES` | No | Admin panel login whitelist | `src/middleware/admin.middleware.ts` | — |
| `ADMIN_EMAILS` | No | Alias for whitelist emails | Auth services | Falls back to super-admin list |
| `ADMIN_PHONES` | No | Alias for whitelist phones | Auth services | Falls back to super-admin list |
| `ADMIN_USER_IDS` | No | Hard-coded admin user IDs | `optionalAuth`, auth controller | — |
| `ADMIN_KEY` | No | Legacy admin API key | `src/middleware/adminMiddleware.ts` | — |
| `ADMIN_2FA_REQUIRED` | No | Require TOTP for admin | `src/middleware/admin2fa.middleware.ts` | `false` |
| `ADMIN_2FA_TOTP_SECRET` | If 2FA on | TOTP secret | `admin2fa.middleware.ts` | — |
| `GOOGLE_CLIENT_ID` | No | Google OAuth sign-in | `src/api/v1/modules/auth/oauth.controller.ts` | Disabled if empty |

---

## Storage (MinIO / Backblaze B2)

| Variable | Required | Purpose | Used in | Default |
|----------|----------|---------|---------|---------|
| `STORAGE_PROVIDER` | No | `minio` or `b2` | `src/infrastructure/storage/storage.config.ts` | `minio` |
| `AWS_ENDPOINT` / `S3_ENDPOINT` | Yes* | S3 API endpoint | Storage config, bootstrap | MinIO: `http://localhost:9000` |
| `AWS_BUCKET_NAME` / `S3_BUCKET` | Yes* | Bucket name | Storage config | `bpa-pets` / `bpa-production-media` |
| `AWS_ACCESS_KEY_ID` / `S3_ACCESS_KEY` | Yes* | Access key | Storage config | MinIO dev defaults in code |
| `AWS_SECRET_ACCESS_KEY` / `S3_SECRET_KEY` | Yes* | Secret key | Storage config | MinIO dev defaults in code |
| `AWS_REGION` / `S3_REGION` | No | AWS region string | Storage config | `us-east-1` / `us-east-005` |
| `AWS_FORCE_PATH_STYLE` / `S3_FORCE_PATH_STYLE` | No | Path-style URLs | Storage config | `true` |
| `STORAGE_PUBLIC_URL` | B2: **Yes** | Client-reachable media base | Storage config, file URLs | — |
| `MINIO_PUBLIC_URL` | No | Alias for public URL | Storage config | Falls back to endpoint |
| `STORAGE_USE_COUNTRY_PREFIX` | No | Key prefix `BD/`, `IN/` | Storage config | `true` |
| `STORAGE_USE_PRESIGNED_PRIVATE_URLS` | No | Presigned GET for KYC docs | `src/shared/storage/fileAccessUrl.ts` | `false` (minio), `true` (b2 prod) |
| `STORAGE_SKIP_STARTUP_CHECK` | No | Skip HeadBucket on boot | `storage.bootstrap.ts` | `false` |

\*Production B2 requires all credentials + `STORAGE_PUBLIC_URL`. Dev MinIO can use Docker defaults after `npm run storage:init`.

---

## Redis & Queues

| Variable | Required | Purpose | Used in | Default |
|----------|----------|---------|---------|---------|
| `REDIS_ENABLED` | No | Master switch for Redis | `src/infrastructure/redis/redisConnection.ts` | Enabled if URL set |
| `REDIS_URL` | If enabled | Single connection URL | Redis, BullMQ workers | — |
| `REDIS_HOST` | No | Host when no URL | Redis connection | `localhost` |
| `REDIS_PORT` | No | Port | Redis connection | `6379` |
| `REDIS_PASSWORD` | No | Auth password | Redis connection | — |
| `REDIS_USERNAME` | No | ACL username | Redis connection | — |
| `REDIS_DB` | No | Database index | Redis connection | `0` |
| `REDIS_TLS` | No | TLS connection | Redis connection | `false` |
| `REDIS_CONNECT_TIMEOUT_MS` | No | Connect timeout | Redis connection | `5000` |
| `REDIS_MAX_CONNECT_RETRIES` | No | Retry count | Redis connection | `10` |

When `REDIS_ENABLED=false`: in-memory cache, queues off, campaign OTP in-memory.

---

## SMS Gateways

**Providers:** BulkSMSBD (primary), SSL Wireless (fallback), mock (dev/test only)

| Variable | Required | Purpose | Used in | Default |
|----------|----------|---------|---------|---------|
| `SMS_ENABLED` | No | Master SMS switch | `sms.constants.ts`, `smsGateway.service.ts` | `true` |
| `SMS_PROVIDER` / `SMS_PRIMARY_PROVIDER` | No | Active provider | SMS integrations | `bulksmsbd` |
| `SMS_FALLBACK_PROVIDER` | No | Fallback on primary failure | `smsGateway.service.ts` | `ssl_wireless` |
| `SMS_API_KEY` | Prod | BulkSMSBD API key (alias) | BulkSMSBD provider | — |
| `SMS_SENDER_ID` | Prod | Sender ID (alias) | SMS services | — |
| `SMS_BASE_URL` | No | BulkSMSBD base URL | SMS constants | `http://bulksmsbd.net/api` |
| `BULKSMSBD_API_KEY` | Prod | Legacy API key | `bulkSmsBd.provider.ts` | — |
| `BULKSMSBD_API_TOKEN` | Prod | REST v3 token | `bulkSmsBd.provider.ts` | — |
| `BULKSMSBD_SENDER_ID` | Prod | Sender ID | BulkSMSBD | — |
| `BULKSMSBD_API_MODE` | No | `legacy` or `rest_v3` | BulkSMSBD | `rest_v3` (code), `.env.example` uses `legacy` |
| `BULKSMSBD_LEGACY_URL` | No | Legacy endpoint | BulkSMSBD | `{base}/smsapi` |
| `SSL_WIRELESS_API_TOKEN` | Fallback | SSL Wireless token | `sslWireless.provider.ts` | — |
| `SSL_WIRELESS_SENDER_ID` | Fallback | SSL Wireless sender | `sslWireless.provider.ts` | — |
| `SSL_WIRELESS_BASE_URL` | No | SSL Wireless API | `sslWireless.provider.ts` | `https://smsplus.sslwireless.com` |
| `CAMPAIGN_SMS_SENDER_ID` | No | Campaign sender override | SMS providers | — |
| `CAMPAIGN_SMS_WEBHOOK_SECRET` | No | Delivery callback header `x-campaign-sms-secret` | `campaign/sms.controller.ts` | — |
| `SMS_ALLOW_MOCK` | No | Allow mock provider (prod emergency) | `smsGateway.service.ts` | `false` |
| `SMS_ALLOW_DEV_FAKE_SENT` | No | Mark sent without gateway (dev) | `campaign/sms.service.ts` | `false` |
| `SMS_QUEUE_*`, `SMS_WORKER_*` | No | BullMQ retry/concurrency | Notification worker | See `.env.example` |

---

## Email (SMTP)

| Variable | Required | Purpose | Used in | Default |
|----------|----------|---------|---------|---------|
| `SMTP_HOST` | Email worker | SMTP server | `src/utils/smtpMailer.ts` | — (email skipped) |
| `SMTP_PORT` | No | SMTP port | `smtpMailer.ts` | `587` |
| `SMTP_USER` | Email worker | SMTP username | `smtpMailer.ts` | — |
| `SMTP_PASS` | Email worker | SMTP password | `smtpMailer.ts` | — |
| `SMTP_SECURE` | No | TLS (`true`/`false`) | `smtpMailer.ts` | `false` |
| `SMTP_FROM` | No | From header | `smtpMailer.ts` | `BPA <no-reply@localhost>` |

Worker: `npm run worker:email` (requires Redis).

---

## Payment Gateways

**Active provider:** `PAYMENT_PROVIDER` = `sslcommerz` | `amarpay` | `bkash` | `nagad` | `eps`  
**Config module:** `src/api/v1/providers/paymentProvider.config.ts`  
**SurjoPay:** Not integrated.

### Shared payment variables

| Variable | Required | Purpose | Default |
|----------|----------|---------|---------|
| `PAYMENT_PROVIDER` | No | Active gateway | `eps` (code default), `.env.example` uses `sslcommerz` |
| `API_PUBLIC_BASE_URL` | Prod | Base for callback/webhook URLs | — |
| `BACKEND_PUBLIC_URL` | Alt | Alias for public base | — |
| `APP_URL` | Alt | Alias for public base | — |
| `PAYMENT_WEBHOOK_SECRET` | No | Header `x-payment-webhook-secret` | — |
| `CAMPAIGN_PAYMENT_WEBHOOK_SECRET` | No | Campaign webhook secret | — |
| `PAYMENT_RECOVERY_INTERVAL_MS` | No | Stale pending order job | `600000` |
| `CAMPAIGN_PAYMENT_TIMEOUT_MINUTES` | No | Pending payment expiry | `30` |
| `CAMPAIGN_LANDING_URL` | No | Post-payment redirect | — |

### SSLCommerz

| Variable | Required | Callback / webhook URLs (auto-built from `API_PUBLIC_BASE_URL`) |
|----------|----------|----------------------------------------------------------------|
| `SSLCOMMERZ_STORE_ID` | Yes | Success: `{base}/api/v1/payments/webhook/redirect/success` |
| `SSLCOMMERZ_STORE_PASSWORD` | Yes | Fail: `.../redirect/fail` |
| `SSLCOMMERZ_SANDBOX` | No | Cancel: `.../redirect/cancel` |
| `SSLCOMMERZ_*_URL` | No overrides | IPN: `{base}/api/v1/payments/webhook` |

### EPS (Easy Payment System)

| Variable | Required | Callback URLs |
|----------|----------|---------------|
| `EPS_USERNAME` | Yes | Success: `{base}/api/v1/payments/payment/eps/callback/success` |
| `EPS_PASSWORD` | Yes | Fail / Cancel: `.../fail`, `.../cancel` |
| `EPS_HASH_KEY` (or `EPS_HASH`) | Yes | Webhook: `{base}/api/v1/payments/webhook` |
| `EPS_MERCHANT_ID` (or `EPS_MERCHANTID`) | Yes | |
| `EPS_STORE_ID` | Yes | |
| `EPS_BASE_URL` | No | Default sandbox: `https://sandboxpgapi.eps.com.bd` |
| `EPS_SANDBOX` | No | Default `true` |

### bKash

| Variable | Required | Callback |
|----------|----------|----------|
| `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD` | Yes | `{base}/api/v1/payments/webhook` |
| `BKASH_SANDBOX` | No | Default sandbox URL |
| `BKASH_CALLBACK_URL` | No override | |

### Nagad

| Variable | Required | Callback |
|----------|----------|----------|
| `NAGAD_MERCHANT_ID`, `NAGAD_PUBLIC_KEY`, `NAGAD_PRIVATE_KEY` | Yes | `{base}/api/v1/payments/webhook` |
| `NAGAD_MERCHANT_NUMBER` | No | |
| `NAGAD_SANDBOX` | No | |

### AmarPay

| Variable | Required | Callback |
|----------|----------|----------|
| `AMARPAY_STORE_ID`, `AMARPAY_SIGNATURE_KEY` | Yes | IPN: `{base}/api/v1/payments/webhook` |
| `AMARPAY_SANDBOX` | No | |

---

## Campaign / Vaccination booking

| Variable | Purpose | Default |
|----------|---------|---------|
| `CAMPAIGN_JWT_SECRET` | OTP session JWT | Falls back to `JWT_SECRET` |
| `CAMPAIGN_QR_SECRET` | QR ticket signing | Falls back to `JWT_SECRET` |
| `CAMPAIGN_BASE_URL` | Ticket/QR links | `https://vaccine.bpa.org.bd` |
| `CAMPAIGN_LANDING_URL` | Payment redirect | — |
| `CAMPAIGN_TEST_OTP` | Dev-only fixed OTP | `123456` (non-prod) |
| `CAMPAIGN_BOOKING_COUPONS` | JSON coupon array | — |
| `CAMPAIGN_SIMPLIFIED_BOOKING` | Payment-first checkout | — |

---

## Wallet & payouts

| Variable | Purpose | Default |
|----------|---------|---------|
| `WALLET_PAYOUT_DETAILS_KEY` | AES key for encrypted payout details | — |
| `WALLET_PAYOUT_MODE` | `auto` or `semi` | `semi` |
| `WALLET_PAYOUT_MAX_ATTEMPTS` | Retry limit | `5` |
| `WEBHOOK_SIGNATURE_REQUIRED` | Require signed payout webhooks | `false` |

---

## Product authenticity

| Variable | Purpose | Default |
|----------|---------|---------|
| `AUTH_SERIAL_SIGNING_SECRET` | HMAC for serial codes | `change_me_serial_secret` |
| `AUTH_CODE_HMAC_SECRET` | Producer auth codes HMAC | `change_me_auth_code_hmac` |
| `AUTH_CODE_ENC_SECRET` | Auth code encryption | `change_me_auth_code_encrypt` |

---

## Server, CORS, media, jobs

See `.env.example` for full list. Notable entries:

- `PORT` — default **3000** (project standard; do not change fixed ports)
- `CORS_ORIGINS` — comma-separated; empty allows all in dev
- `MAX_UPLOAD_BYTES`, `IMAGE_*`, `VIDEO_*` — upload pipeline
- `COUNTRY_DEFAULT` — default `BD` for country context middleware
- `VERIFICATION_HARD_LOCK` — KYC edit lock mode
- `POLICY_CACHE_TTL_SEC` — Redis/in-memory policy cache
- Rate limits: `RL_*` in `src/middleware/rateLimiters.ts`
- Job intervals: `EXPIRY_ENGINE_*`, `NOTIFICATION_*`, `OWNERS_*`, etc.

---

## Script-only variables (not required for API startup)

Used by maintenance scripts, E2E tests, or one-off jobs:

`FLOW_*`, `DRY_RUN`, `ORG_ID`, `REPAIR_*`, `UAT_*`, `SEED_*`, `WINDOW_DAYS`, `ADMIN_TOKEN`, `BASE_URL`, `API_BASE_URL`, `CAMPAIGN_SEED_SLUG`, `MEDICINE_IMPORT_*`, `PRODUCT_IMPORT_*`, etc.

Full file references: `scripts/_env-inventory.json`.

---

## Validation

```bash
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and JWT_SECRET

npm run validate:env              # Dev mode (DATABASE_URL critical)
VALIDATE_PAYMENT_CONFIG=true npm run validate:env
npm run validate:env -- --migrate-dev   # Also checks SHADOW_DATABASE_URL
```
