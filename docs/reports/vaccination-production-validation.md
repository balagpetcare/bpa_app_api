# Vaccination 2026 — Production Readiness Validation Report

**Date:** 2026-06-07  
**Scope:** EPS, BulkSMSBD, campaign checkout/booking/payment, callbacks, SMS, env, branch config, frontend  
**Method:** Automated scripts + live probes against local DB and production APIs  
**Validator:** `scripts/production-validation-snapshot.ts`, `verify-campaign-checkout-anchor.ts`, `validate-env.ts`, `sms-production-check.ts`, `test-eps-connection.ts`

---

## Go-live status: **NOT READY**

**Deployment readiness score: 38 / 100**

| Area | Score | Notes |
|------|-------|-------|
| Code & integration architecture | 78 | Checkout anchor passes; payment/SMS modules wired |
| Local environment | 12 | Wrong payment provider; missing credentials & public URLs |
| Production environment | 42 | EPS active; SMS disabled; callback URLs on stale deploy |
| End-to-end payment + SMS flow | 0 | Not completed (gateway credentials / callbacks blocked) |
| Database & branch anchor | 85 | Active branch + campaign configs present locally |

---

## 1. Validation summary

### What passed

| Check | Result |
|-------|--------|
| Campaign checkout anchor (local DB) | **PASS** — org, ACTIVE branch, session + order with correct `branchId` |
| Branch configuration | **PASS** — 1 ACTIVE branch (`BPA-CAMPAIGN-CHECKOUT`, orgId=1) |
| Campaign payment config (DB) | **PASS** — `onlinePaymentEnabled=true` for campaigns 1 & 2 |
| EPS network connectivity | **PASS** — `sandboxpgapi.eps.com.bd` / `pgapi.eps.com.bd` DNS + TLS OK |
| Production campaign API | **PASS** — `GET https://api.bangladeshpetassociation.com/api/v1/campaign/public/campaigns` → 200 |
| Production landing | **PASS** — `https://vaccination.bangladeshpetassociation.com` reachable |
| Production Redis (SMS queue) | **PASS** — queue health shows Redis enabled, 0 stuck jobs |
| Frontend integration pattern | **PASS** — `vaccination_2026` uses `checkout/init` + `paymentUrl` redirect (provider-agnostic) |
| Payment transaction logging (local DB) | **PASS** — 96 rows in `payment_transaction_logs` |

### What failed

| Check | Result |
|-------|--------|
| `PAYMENT_PROVIDER=eps` (local `.env`) | **FAIL** — set to `sslcommerz` |
| EPS credentials loaded (local) | **FAIL** — all EPS_* empty |
| SMS credentials loaded (local) | **FAIL** — `SMS_API_KEY`, `SMS_SENDER_ID` empty |
| `API_PUBLIC_BASE_URL` (local) | **FAIL** — empty → relative callback URLs |
| `CAMPAIGN_LANDING_URL` (local) | **FAIL** — empty → post-payment browser redirects broken |
| Production SMS gateway | **FAIL** — `/public/sms/health` → `bulkSmsBd: false`, `smsEnabled: false` |
| Production EPS callback routes (probed) | **FAIL** — all tested callback paths returned connection/HTTP errors |
| Production EPS URL registry | **WARN** — deployed API returns **old** paths (`/payments/payment/eps/...`) not fixed canonical paths |
| End-to-end: Booking → EPS → Callback → Confirmed → SMS | **NOT RUN** — blocked by credentials + callbacks |

---

## 2. Failed checks (detail)

### 2.1 Environment — local (`.env`)

```
NODE_ENV=development
PAYMENT_PROVIDER=sslcommerz          ← expected eps
SMS_PROVIDER=bulksmsbd               ← OK
SMS_ENABLED=true                     ← OK but no credentials
REDIS_ENABLED=false                  ← async SMS/OTP degraded
API_PUBLIC_BASE_URL=                 ← MISSING
CAMPAIGN_LANDING_URL=                ← MISSING
EPS_USERNAME/PASSWORD/HASH/MERCHANT/STORE ← all MISSING
SMS_API_KEY / SMS_SENDER_ID          ← MISSING
```

`npm run validate:env` with `NODE_ENV=production`: **5 critical failures**, 4 warnings.

### 2.2 Environment — production (live probes)

| Variable / signal | Observed |
|-------------------|----------|
| `PAYMENT_PROVIDER` | `eps` (via `/api/v1/payments/callback-urls`) |
| `API_PUBLIC_BASE_URL` | `https://api.petsmartsolution.com` (note: **different** from `api.bangladeshpetassociation.com`) |
| EPS `baseUrl` | `https://pgapi.eps.com.bd` (production gateway) |
| SMS BulkSMSBD | **Not configured** (`smsEnabled: false`) |
| EPS callback URLs (deployed) | `https://api.petsmartsolution.com/api/v1/payments/payment/eps/callback/success` (**legacy/wrong path**) |

### 2.3 EPS gateway

| Item | Local | Production |
|------|-------|------------|
| Provider selected | sslcommerz | eps |
| Credentials | Missing | Unknown (cannot verify without secrets) |
| Callback URL generation | Relative paths (no public base) | Absolute but **wrong path segment** on deployed build |
| Checkout payment intent | Fails: SSLCommerz not configured | Not tested live (no checkout call) |

### 2.4 BulkSMSBD

| Item | Local | Production |
|------|-------|------------|
| Provider | bulksmsbd | bulksmsbd (expected) |
| Configured | No | No |
| `sms_logs` rows | 0 | N/A |
| `campaign_sms_logs` | 1 | N/A |
| Redis queue | Disabled locally | Enabled; queue empty |

### 2.5 Campaign checkout / booking (local DB script)

```
organizationExists: true
activeBranchExists: true
checkoutSessionCreated: true
orderLinkedToSession: true
orderUsesActiveBranch: true
branchGatePassed: true
paymentIntentError: "SSLCommerz payment gateway is not configured..."
```

Branch gate **fixed** (no longer "Campaign payment setup not configured"). Payment fails at **gateway env** only.

### 2.6 Booking status transitions (local DB)

| paymentStatus | count |
|---------------|-------|
| PENDING | 3 |
| NOT_REQUIRED | 1 |

No `COMPLETED` bookings in snapshot — consistent with no successful EPS callback in this environment.

---

## 3. Warnings

1. **Dual API domains:** Campaign traffic uses `api.bangladeshpetassociation.com`; payment callbacks use `api.petsmartsolution.com`. Ensure EPS dashboard, CORS, and SSL cover both if intentional.
2. **Production deploy lag:** Repo has corrected EPS paths (`/api/v1/payments/eps/success`); production still advertises `/payments/payment/eps/...`. **Deploy latest backend-api** before go-live.
3. **REDIS_ENABLED=false** locally — SMS sends synchronously; production has Redis (good).
4. **Campaign `uat-paid-2026` status PAUSED** — only `uat-free-2026` is ACTIVE locally.
5. **No rows in `sms_logs`** locally — unified SMS audit trail empty; campaign SMS uses `campaign_sms_logs` (1 row).
6. **Frontend `.env` not committed** — production landing uses `vaccination.bangladeshpetassociation.com`; ensure `NEXT_PUBLIC_API_BASE_URL` points to live API.
7. **SMS validation bug fixed in this pass** — `getSmsConfigIssues()` previously skipped credential checks when keys were missing; now correctly fails validation when `SMS_ENABLED=true`.

---

## 4. Required environment variables (production checklist)

### Payment (EPS)

```env
PAYMENT_PROVIDER=eps
API_PUBLIC_BASE_URL=https://api.petsmartsolution.com
CAMPAIGN_LANDING_URL=https://vaccination.bangladeshpetassociation.com

EPS_BASE_URL=https://pgapi.eps.com.bd
EPS_SANDBOX=false
EPS_USERNAME=<secret>
EPS_PASSWORD=<secret>
EPS_HASH_KEY=<secret>
EPS_MERCHANT_ID=<secret>
EPS_STORE_ID=<secret>
# Optional overrides (defaults after deploy):
# EPS_SUCCESS_URL=https://api.petsmartsolution.com/api/v1/payments/eps/success
# EPS_FAIL_URL=...
# EPS_CANCEL_URL=...
# EPS_CALLBACK_URL=...
```

### SMS (BulkSMSBD)

```env
SMS_ENABLED=true
SMS_PROVIDER=bulksmsbd
SMS_API_KEY=<secret>
SMS_SENDER_ID=<secret>
SMS_API_URL=http://bulksmsbd.net/api/smsapi
SMS_BALANCE_API_URL=http://bulksmsbd.net/api/getBalanceApi
REDIS_ENABLED=true
```

### Campaign anchor

```env
# Optional if multiple branches — otherwise first ACTIVE branch is used
# CAMPAIGN_PAYMENT_BRANCH_ID=1
```

---

## 5. Database issues

| Issue | Severity | Status |
|-------|----------|--------|
| No ACTIVE branch | — | **Resolved** — branch id=1 exists |
| Campaigns missing organizerId | — | **OK** — organizerId=1 |
| Pending bookings without completion | Info | 3× `PENDING` — expected until live payment |
| Empty `sms_logs` | Warning | No unified SMS audit yet in this environment |

No schema migration required for go-live.

---

## 6. Missing production configuration

1. EPS merchant credentials on production server (unverified)
2. BulkSMSBD `SMS_API_KEY` + `SMS_SENDER_ID` on production (**confirmed missing** via SMS health)
3. Register **correct** EPS callback URLs in EPS merchant panel after backend deploy
4. `CAMPAIGN_LANDING_URL` on production API for browser redirects after payment
5. Notification worker running: `npm run worker:notifications`
6. Local/dev `.env` still targets SSLCommerz — not representative of production target state

---

## 7. End-to-end flow validation

**Target flow:** Booking → Checkout → EPS Payment → Callback → Booking Confirmed → SMS Sent

| Step | Local | Production |
|------|-------|------------|
| Checkout init | Session + order created | Not executed (avoid live charges) |
| `paymentUrl` returned | Blocked at SSLCommerz | Not verified |
| EPS redirect | Not reached | Not verified |
| Callback | Not reached | Callback routes not responding to probe |
| Booking CONFIRMED | No COMPLETED payments in DB | Not verified |
| SMS sent | 0 `sms_logs`; gateway not configured | `smsEnabled: false` |

**E2E result: NOT COMPLETED**

---

## 8. Frontend integration

| Check | Status |
|-------|--------|
| `vaccination_2026` calls `POST /campaign/public/checkout/init` | OK |
| Uses `paymentUrl` for redirect | OK |
| Success/fail pages `/book/payment/success`, `/book/payment/failed` | OK |
| Provider-specific logic in frontend | None (correct) |
| Production site live | OK |

**Frontend is ready** assuming backend payment + SMS are configured.

---

## 9. Fix applied during validation

| File | Change |
|------|--------|
| `src/shared/services/sms/sms.constants.ts` | `getSmsConfigIssues()` now validates credentials whenever `SMS_ENABLED` is not explicitly `false` (fixes false-positive “ready” when keys missing) |
| `scripts/production-validation-snapshot.ts` | Added reusable validation snapshot script |

No payment/booking logic changes (validation-only pass).

---

## 10. Exact remaining blockers (must resolve before go-live)

1. **Deploy latest `backend-api`** with corrected EPS routes (`/api/v1/payments/eps/*`) to production.
2. **Set EPS credentials** on production and register success/fail/cancel/webhook URLs in EPS dashboard.
3. **Set BulkSMSBD credentials** on production — currently `smsEnabled: false`.
4. **Verify EPS callback endpoints** respond after deploy (currently unreachable/wrong path).
5. **Run notification worker** on production with Redis.
6. **Set `CAMPAIGN_LANDING_URL`** on production API.
7. **Execute one sandbox/live payment test** and confirm: order `COMPLETED`, booking `CONFIRMED`, `sms_logs` or `campaign_sms_logs` row `SENT`.
8. **Align local `.env`** for QA: `PAYMENT_PROVIDER=eps`, public URLs, credentials (sandbox).

---

## 11. Recommended pre-launch commands

```bash
# Local / staging (after env filled)
cd backend-api
npm run validate:env                    # NODE_ENV=production
npx ts-node scripts/production-validation-snapshot.ts
npx ts-node scripts/verify-campaign-checkout-anchor.ts
npx ts-node scripts/test-eps-connection.ts
npx ts-node scripts/sms-production-check.ts --health-only
npx ts-node scripts/sms-production-check.ts --phone=017XXXXXXXX

# Production smoke (read-only)
curl https://api.bangladeshpetassociation.com/api/v1/campaign/public/campaigns
curl https://api.bangladeshpetassociation.com/api/v1/campaign/public/sms/health
curl https://api.bangladeshpetassociation.com/api/v1/campaign/public/payments/callback-urls
curl https://api.bangladeshpetassociation.com/api/v1/payments/callback-urls
```

---

## 12. Conclusion

The **codebase architecture is production-capable**: branch anchor, checkout session, order creation, EPS strategy, SMS queue, and campaign templates are in place. **Configuration and deployment are not ready**: production SMS is off, deployed EPS callback paths are stale/wrong, local env does not match target `PAYMENT_PROVIDER=eps`, and the full payment → callback → confirm → SMS chain was not verified end-to-end.

**Re-evaluate go-live after:** backend deploy + EPS/SMS secrets + one successful test transaction + confirmation SMS delivery.
