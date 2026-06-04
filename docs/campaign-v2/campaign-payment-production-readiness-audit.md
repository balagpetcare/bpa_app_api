# BPA Campaign Payment — Production Readiness Audit

**Date:** 2026-06-04  
**Scope:** Campaign express checkout + unified payments (`/api/v1/payments`) + EPS provider  
**Mode:** Audit only — no business-logic changes  
**Surfaces:** `backend-api`, `vaccination_2026`

---

## Executive summary

| Area | Rating | Summary |
|------|--------|---------|
| Provider configuration | **Good** | `PAYMENT_PROVIDER` + env-driven credentials; production boot fails fast |
| EPS integration | **Good (QA)** | GetToken, Initialize, verify API, callbacks wired; sandbox defaults overridable |
| Checkout + orders | **Good** | Branch gate, idempotent orders, session linkage |
| Webhooks + verification | **Good** | Server-side verify (EPS), amount match, serializable DB updates |
| Idempotency / duplicates | **Good** | Order replay, booking `@unique checkoutSessionId`, Redis replay (when enabled) |
| Callback → UX | **Gap** | Post-payment browser redirect often loses `checkoutId` on success page |
| Security | **Medium** | Optional webhook secret; EPS query fallback if verify API fails; Redis off = weaker replay guard |
| Documentation drift | **Low** | Legacy `PAYMENT-PRODUCTION-READINESS.md` omits EPS; campaign `callback-urls` omits EPS |

**Verdict:** Architecture is **production-capable** for gateway switching via env. **Go-live** requires live credentials, HTTPS public URLs, Redis, webhook secret, EPS merchant panel registration, and fixing the success-page `checkoutId` handoff (operational/config, not audited as code change here).

---

## 1. Production readiness report

### 1.1 EPS provider

| Capability | Implementation | Production-ready? |
|------------|----------------|-----------------|
| GetToken | `eps.provider.ts` → `POST {base}/v1/Auth/GetToken` + `x-hash` (username) | Yes |
| Payment Initialize | `POST .../InitializeEPS` + Bearer + `x-hash` (merchantTransactionId) | Yes |
| Redirect URL | `RedirectURL` from EPS → `paymentUrl` in checkout | Yes |
| Status check | `GET .../CheckMerchantTransactionStatus` | Yes |
| Success / fail / cancel callbacks | Unified routes → `eps.strategy.handleWebhook` → verify API first | Yes |
| Credentials | `EPS_USERNAME`, `EPS_PASSWORD`, `EPS_HASH`, `EPS_MERCHANT_ID`, `EPS_STORE_ID` | Yes |
| Base URL | `EPS_BASE_URL` or `EPS_SANDBOX` default hosts | Yes (see §2.1) |

**Order reference:** `merchantTransactionId` = `order.orderNumber` (`CKO-...`), matching `processPaymentWebhook` lookup by `orderNumber`.

**Note:** `successUrl` / `failUrl` sent to EPS are **API** redirect handlers (`{API_PUBLIC_BASE_URL}/api/v1/payments/webhook/redirect/...`), not the landing `returnUrl` built in `checkout.service.ts`. Only `cancelUrl` can inherit `req.cancelUrl` from checkout (includes `checkoutId` on cancel path).

### 1.2 Campaign checkout

| Check | Status | Evidence |
|-------|--------|----------|
| Campaign validation | Pass | `validateCampaignForBooking`, config `bookingEnabled` |
| Pricing server-side | Pass | `computeCampaignPriceBreakdown` in `initCheckout` |
| Rate limit | Pass | `assertCheckoutRateLimit(ownerPhone)` |
| Session `PENDING` gate | Pass | Rejects non-pending sessions |
| Paid path | Pass | `createCheckoutPaymentIntent` after session create |
| Branch resolution | Pass | ACTIVE branch for `campaign.organizerId` |
| Free path | Pass | `requiresPayment: false` / `confirmFreeCheckout` |

### 1.3 Payment callbacks

| Route | Handler | EPS use |
|-------|---------|---------|
| `GET /api/v1/payments/webhook/redirect/success` | `sslRedirectHandler("success")` → `handleUnifiedWebhook` | Yes |
| `GET /api/v1/payments/webhook/redirect/fail` | `sslRedirectHandler("fail")` | Yes |
| `GET /api/v1/payments/webhook/redirect/cancel` | `sslRedirectHandler("cancel")` → lands on **failed** UI path | Yes |
| `POST /api/v1/payments/webhook` | `webhookPostHandler` (optional secret) | Optional relay |
| Legacy `/campaign/public/payments/*` | bKash/Nagad/SSLCommerz | Parallel; not used when `PAYMENT_PROVIDER=eps` |

After handler runs, user is redirected to `CAMPAIGN_LANDING_URL` + `/book/success` or `/book/payment/failed` **without** `checkoutId` query param.

### 1.4 Payment status verification

| Layer | Behavior |
|-------|----------|
| EPS strategy | `checkTransactionStatus` before accepting webhook |
| Fallback | `parseCallbackQuery` if API verify returns null (**audit concern**) |
| Unified verify API | `POST /api/v1/payments/verify` |
| Recovery job | `paymentRecovery.service.ts` → `verifyUnifiedPayment` |
| Amount integrity | `amountsMatch` on SUCCESS (±0.01 BDT) |

### 1.5 Order creation

| Control | Status |
|---------|--------|
| One active order per checkout | Pass — `notes` contains `campaign_checkout:{sessionId}` |
| Reuse PENDING order | Pass — avoids duplicate order rows |
| Completed short-circuit | Pass — returns existing txn if already paid |
| `branchId` on order | Pass |
| Idempotency key in notes | Pass — `buildCheckoutOrderNotes` |
| Serializable webhook txn | Pass — `payment.service.ts` |

### 1.6 Campaign booking flow

| Step | Status |
|------|--------|
| Payment SUCCESS → order `COMPLETED` | Pass |
| Checkout session → `PAID` / `FULFILLED` | Pass — `fulfillCheckoutFromOrder` |
| Booking create | Pass — `fulfillCheckoutSession` in transaction |
| Duplicate booking per session | Pass — `checkoutSessionId` **@unique** on `CampaignBooking` |
| Zone-interest SMS | Pass — `sendZoneInterestConfirmation` on fulfill |
| Legacy booking payment SMS | Pass — when `bookingId` path without checkout session |

### 1.7 Frontend payment redirect

| Item | Status |
|------|--------|
| `initCheckout` → `paymentUrl` | Pass — `BookingWizard` / `StepPaymentGateway` `window.location.href` |
| API base | Env — `NEXT_PUBLIC_API_URL` |
| Return URLs sent to API | Pass — `siteUrl("/book/success")`, `siteUrl("/book/payment/failed")` + server appends `checkoutId` |
| User return after EPS | **Gap** — browser lands on landing `/book/success` without `checkoutId` (see §1.3) |

### 1.8 Success page (`/book/success`)

| Behavior | Status |
|----------|--------|
| Polls `getCheckoutStatus(checkoutId)` | Pass when `?checkoutId=` present |
| Without `checkoutId` | Shows generic wizard — **weak post-payment UX** |
| FULFILLED → `BookingWizard` success | Pass |

### 1.9 Failed payment page (`/book/payment/failed`)

| Behavior | Status |
|----------|--------|
| Retry link | `/book/payment?ref=` (legacy booking ref flow) |
| `checkoutId` on URL | Only if user cancelled via path that preserved it |
| Express checkout retry | **Weak** — no `checkoutId`-based retry |

### 1.10 Cancelled payment

| Behavior | Status |
|----------|--------|
| API cancel redirect | Same handler path as **fail** → `/book/payment/failed` |
| Dedicated cancel copy | **None** — treated as failed |
| Session status | `FAILED` on CANCELLED webhook payload |

---

## 2. Security findings

| ID | Severity | Finding | Recommendation |
|----|----------|---------|----------------|
| SEC-01 | **High** (prod) | `PAYMENT_WEBHOOK_SECRET` / `CAMPAIGN_PAYMENT_WEBHOOK_SECRET` optional — `POST /payments/webhook` open if unset | Set secret in production; register only server-side relays |
| SEC-02 | **High** (prod) | Redis replay guard **no-ops** when `REDIS_ENABLED=false` or Redis down | Enable Redis in production for `paymentReplay.guard` |
| SEC-03 | **Medium** | EPS `parseCallbackQuery` fallback trusts query `status` if verify API fails | Monitor verify failures; alert; prefer fail-closed in future |
| SEC-04 | **Medium** | GET redirect callbacks are unauthenticated (by design); security relies on EPS verify API | Ensure verify always runs (current primary path) |
| SEC-05 | **Low** | Placeholder PII: `guest@bpa.com.bd`, `01700000000` in providers | Acceptable; replace via metadata when available |
| SEC-06 | **Low** | `paymentMethod` in checkout body ignored for gateway selection — always `PAYMENT_PROVIDER` | Document for ops; prevents client-side provider spoofing (good) |
| SEC-07 | **Info** | Production `bootstrapPaymentProvider` **throws** if provider misconfigured | Keep enabled for deploy pipeline |
| SEC-08 | **Info** | No credentials in source | Pass — env only |
| SEC-09 | **Medium** (ops) | Success redirect drops `checkoutId` — users may poll wrong state / retry | Configure `CAMPAIGN_LANDING_URL` + fix redirect query (future) or document manual “My booking” |

---

## 3. Hardcoded URLs and credentials audit

### 3.1 Credentials

| Check | Result |
|-------|--------|
| Store passwords / hash keys in code | **None found** |
| EPS/SSL/bKash keys in repo | **None** — `.env` / secrets manager only |

### 3.2 URL defaults (vendor fallbacks — not secrets)

These are **default hosts** when env overrides are absent; production should set explicit env:

| Provider | Default sandbox host | Override env |
|----------|---------------------|--------------|
| EPS | `https://sandboxpgapi.eps.com.bd` | `EPS_BASE_URL`, `EPS_SANDBOX=false` + live `https://pgapi.eps.com.bd` |
| SSLCommerz | `https://sandbox.sslcommerz.com/...` | `SSLCOMMERZ_*_URL`, `SSLCOMMERZ_SANDBOX=false` |
| bKash | `https://tokenized.sandbox.bka.sh/...` | `BKASH_BASE_URL`, `BKASH_SANDBOX=false` |
| Nagad | `http://sandbox.mynagad.com:10080/...` | `NAGAD_BASE_URL`, `NAGAD_SANDBOX=false` |
| AmarPay | `https://sandbox.aamarpay.com` | `AMARPAY_BASE_URL`, `AMARPAY_SANDBOX=false` |

**Not hardcoded:** EPS `RedirectURL` comes from EPS API response.

**Tests only:** `https://api.bpa.com.bd` in `paymentProvider.config.test.ts`.

### 3.3 Environment-driven provider configuration

| Mechanism | Status |
|-----------|--------|
| `PAYMENT_PROVIDER=eps\|sslcommerz\|...` | Pass |
| `validateActivePaymentProviderConfig()` | Pass |
| `isActiveProviderReady()` | Pass |
| `GET /api/v1/payments/callback-urls` | Pass (includes `eps`) |
| `GET /api/v1/campaign/public/payments/callback-urls` | **Missing `eps` block** — ops should use unified endpoint |

---

## 4. Duplicate protection and idempotency

| Mechanism | Location | Effective when |
|-----------|----------|----------------|
| Checkout order dedup | `createCheckoutPaymentIntent` | Same session, same notes marker |
| Order `COMPLETED` short-circuit | `processPaymentWebhook` | Replay SUCCESS |
| `orderPayment` by `reference` | Webhook txn | Duplicate payment rows |
| Serializable transaction | `processPaymentWebhook` | Concurrent webhooks |
| Redis event key | `paymentReplay.guard` | Redis available |
| `checkoutSessionId` unique | Prisma `CampaignBooking` | Duplicate booking rows |
| Session `FULFILLED` guard | `fulfillCheckoutFromOrder` | Second fulfill |
| Idempotency in order notes | `campaign.paymentGuards` | Traceability |

**Gap:** With Redis disabled, duplicate EPS redirect hits still safe at DB layer for completed orders; race before `COMPLETED` relies on serializable isolation.

---

## 5. Order and booking status synchronization

| Event | Order | Checkout session | Booking |
|-------|-------|------------------|---------|
| initCheckout paid | `PENDING` / `PENDING` payment | `PENDING` | — |
| Payment SUCCESS | `COMPLETED` / `DELIVERED` | → fulfill → `FULFILLED` | `CONFIRMED` or `PENDING_ASSIGNMENT` + `paymentStatus COMPLETED` |
| Payment FAILED/CANCELLED | `FAILED` / `CANCELLED` | `FAILED` | `FAILED` if exists |
| initCheckout payment error | — | `FAILED` | — |
| Free confirm | — | `FULFILLED` | per pricing |

**Amount sync:** Webhook SUCCESS rejected if gateway amount ≠ `order.totalAmount`.

---

## 6. Missing environment variables

### 6.1 Required for all paid campaign checkout (any provider)

| Variable | Purpose |
|----------|---------|
| `API_PUBLIC_BASE_URL` | HTTPS API host for gateway callbacks (or `BACKEND_PUBLIC_URL` / `APP_URL`) |
| `CAMPAIGN_LANDING_URL` | User-facing redirects after API callback |
| `PAYMENT_PROVIDER` | Active gateway (`eps` for QA) |
| `REDIS_URL` + `REDIS_ENABLED=true` | Replay guard (strongly recommended prod) |
| `PAYMENT_WEBHOOK_SECRET` or `CAMPAIGN_PAYMENT_WEBHOOK_SECRET` | POST webhook hardening |
| Campaign anchor data | Org + ACTIVE branch + `campaign.organizerId` (see seed script) |

### 6.2 Required when `PAYMENT_PROVIDER=eps`

| Variable | In user checklist | Required by code |
|----------|-------------------|------------------|
| `EPS_BASE_URL` | Yes | Recommended (defaults to sandbox if unset) |
| `EPS_USERNAME` | Yes | Yes |
| `EPS_PASSWORD` | Yes | Yes |
| `EPS_HASH` | Yes | Yes |
| `EPS_STORE_ID` | Yes | Yes |
| `EPS_MERCHANT_ID` | Not in user list | **Yes** (Initialize API) |
| `EPS_SANDBOX` | Optional | Default `true` |
| `API_PUBLIC_BASE_URL` | Yes | Yes |

### 6.3 Frontend (`vaccination_2026`)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API |
| `NEXT_PUBLIC_SITE_URL` | `siteUrl()` for return/cancel URLs |
| `NEXT_PUBLIC_BOOKING_COUPONS` | Must match `CAMPAIGN_BOOKING_COUPONS` if coupons used |

### 6.4 Audit method

Compare live `.env` against `.env.example` sections (lines 73–143). Do not commit secrets. Confirm boot log: `[Payment] Active provider: eps | ... | configured: yes`.

---

## 7. Required live credential steps (EPS)

1. Obtain **live** EPS merchant credentials (username, password, hash, merchant UUID, store UUID).
2. Set production env:
   - `PAYMENT_PROVIDER=eps`
   - `EPS_BASE_URL=https://pgapi.eps.com.bd`
   - `EPS_SANDBOX=false`
   - Live `EPS_*` credentials
   - `API_PUBLIC_BASE_URL=https://api.<production-domain>` (HTTPS)
   - `CAMPAIGN_LANDING_URL=https://<vaccination-landing-domain>`
3. Register in EPS merchant panel (exact URLs from `GET /api/v1/payments/callback-urls`):
   - Success: `.../webhook/redirect/success`
   - Fail: `.../webhook/redirect/fail`
   - Cancel: `.../webhook/redirect/cancel`
4. Smoke test: init checkout → EPS redirect → pay → verify booking `FULFILLED` via `GET /checkout/:id/status`.
5. Enable Redis + webhook secret before traffic.

**Switching from SSLCommerz:** Change `PAYMENT_PROVIDER` and credential set only; no deploy of payment module required.

---

## 8. Go-live checklist

### Infrastructure and config

- [ ] `API_PUBLIC_BASE_URL` is public HTTPS (not `localhost`, not `0.0.0.0`)
- [ ] `CAMPAIGN_LANDING_URL` matches vaccination site production URL
- [ ] `PAYMENT_PROVIDER` set to intended live gateway (`eps` or other)
- [ ] All provider credential env vars set in secrets manager
- [ ] `EPS_SANDBOX=false` and `EPS_BASE_URL` live host (if using EPS)
- [ ] `REDIS_ENABLED=true` and Redis reachable
- [ ] `PAYMENT_WEBHOOK_SECRET` set (min 32 random bytes)
- [ ] `npm run seed:campaign-checkout-anchor` (or equivalent) on production DB
- [ ] API boot succeeds without `[Payment] NOT ready` in production

### Gateway dashboard

- [ ] Callback URLs registered match `GET /api/v1/payments/callback-urls`
- [ ] EPS store / merchant IDs match env
- [ ] Test transaction in sandbox/staging end-to-end before live keys

### Application flows

- [ ] Paid campaign: checkout init → redirect → success → booking `FULFILLED`
- [ ] Failed payment: order/session `FAILED`, user sees failed page
- [ ] Cancelled payment: same failure UX; session not fulfilled
- [ ] Duplicate webhook: second call does not double-charge or double-book
- [ ] Amount mismatch webhook rejected
- [ ] Coupon (if enabled): server total matches gateway charge

### Frontend

- [ ] `NEXT_PUBLIC_API_URL` → production API
- [ ] `NEXT_PUBLIC_SITE_URL` → production landing
- [ ] Post-payment: confirm success path (ideally `checkoutId` on `/book/success` — known gap)

### Monitoring

- [ ] Log alerts on `[CampaignPayment] Amount mismatch`
- [ ] Payment recovery job running (`PAYMENT_RECOVERY_INTERVAL_MS`)
- [ ] EPS verify API errors monitored

### Documentation

- [ ] Update ops runbook: EPS section in `eps-payment-provider.md`
- [ ] Refresh `PAYMENT-PRODUCTION-READINESS.md` to include EPS (currently bKash/Nagad/SSL only)

---

## 9. Verification matrix (audit commands)

| Test | Command / endpoint |
|------|-------------------|
| Provider config | `GET /api/v1/payments/callback-urls` |
| Campaign anchor | `npm run verify:campaign-checkout-anchor` |
| Unit tests | `npm test -- --testPathPattern="paymentProvider.config\|eps.utils"` |
| Direct checkout | `scripts/verify-checkout-init-direct.ts` (with EPS env) |
| Checkout status | `GET /api/v1/campaign/public/checkout/:checkoutId/status` |

---

## 10. References

| Doc / code | Path |
|------------|------|
| EPS integration guide | `docs/vaccination-campaign-2026/eps-payment-provider.md` |
| Unified payments architecture | `docs/vaccination-campaign-2026/payment-gateway-architecture.md` |
| Legacy payment readiness | `PAYMENT-PRODUCTION-READINESS.md` |
| Checkout anchor | `docs/campaign-v2/campaign-checkout-anchor-report.md` |
| EPS provider | `src/api/v1/providers/eps.provider.ts` |
| Config | `src/api/v1/providers/paymentProvider.config.ts` |
| Orchestrator | `src/api/v1/payments/paymentOrchestrator.service.ts` |
| Campaign payment | `src/api/v1/modules/campaign/payment.service.ts` |
| Checkout | `src/api/v1/modules/campaign/checkout.service.ts` |
| Frontend API | `vaccination_2026/lib/campaignApi.ts` |

---

**Audit conclusion:** Payment stack is **structurally production-ready** with env-only provider switching and strong server-side verification for EPS. **Before live traffic:** set all production env vars, enable Redis + webhook secret, register EPS callbacks, and plan around the **success-page `checkoutId` redirect gap** for express checkout UX.
