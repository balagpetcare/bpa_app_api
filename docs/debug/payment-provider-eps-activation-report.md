# Payment provider activation report (EPS)

**Date:** 2026-06-04  
**Decision:** BPA Campaign Checkout uses **EPS Payment Gateway only**.

---

## Executive summary

| Check | Result |
|-------|--------|
| `PAYMENT_PROVIDER=eps` in `.env` | **Loaded** (when server restarts after `.env` change) |
| Code default when env unset | **`eps`** (was `sslcommerz`) |
| Checkout uses SSLCommerz strategy | **No** — `createUnifiedPayment` → `getActivePaymentStrategy()` → active env provider |
| Running dev server (before restart) | Showed **`sslcommerz`** — stale process without updated `.env` |
| EPS credentials in `.env` | **Placeholders** (`<sandbox_username>`, etc.) — must be replaced with real sandbox values |

---

## 1. Active provider detected

- **Configured in `.env`:** `PAYMENT_PROVIDER=eps`
- **`getActivePaymentProvider()`:** returns `eps`
- **After code change, default if unset:** `eps` (invalid values fall back to `eps` with warning)

**Action:** Restart `npm run dev` so bootstrap logs:

```text
[Payment] Active provider: eps
[Payment] Webhook base: http://localhost:3000/api/v1/payments/webhook | configured: yes
```

(Current terminal showed `sslcommerz` because the process started before `PAYMENT_PROVIDER=eps` was added.)

---

## 2. Provider selected during checkout

```text
checkout.service initCheckout
  → createCheckoutPaymentIntent
    → initiateProviderPayment
      → createUnifiedPayment (paymentOrchestrator.service.ts)
        → getActivePaymentStrategy()  // reads PAYMENT_PROVIDER
        → epsStrategy.createPayment → eps.provider.createIntent
```

- **`input.method` (BKASH / SSLCOMMERZ)** only affects `Order.paymentMethod` label via `mapPaymentMethod()` → maps from **active provider**, not from client method.
- **SSLCommerz is not invoked** when `PAYMENT_PROVIDER=eps`.

---

## 3. Missing / placeholder env values

Run: `npx ts-node -r ts-node/register scripts/verify-payment-provider-config.js`

| Variable | Status (current `.env`) |
|----------|-------------------------|
| `PAYMENT_PROVIDER` | set (`eps`) |
| `API_PUBLIC_BASE_URL` | set |
| `EPS_BASE_URL` | set |
| `EPS_USERNAME` | **PLACEHOLDER** |
| `EPS_PASSWORD` | **PLACEHOLDER** |
| `EPS_HASH` | **PLACEHOLDER** |
| `EPS_MERCHANT_ID` | **PLACEHOLDER** |
| `EPS_STORE_ID` | **PLACEHOLDER** |
| `EPS_SANDBOX` | set |

Replace placeholders with real EPS sandbox credentials. Checkout will then return:

`EPS payment gateway is not configured (...)` **only until** credentials are valid — not `SSLCommerz is not configured`.

---

## 4. Code changes (this pass)

| Area | Change |
|------|--------|
| `paymentProvider.config.ts` | Default provider `eps`; placeholder detection; `formatProviderNotConfiguredMessage()` |
| `paymentOrchestrator.service.ts` | Pre-flight active provider before `createPayment` |
| `paymentProvider.bootstrap.ts` | Log `Active provider: eps` |
| All provider `*.provider.ts` | Dynamic “{name} payment gateway is not configured” messages |
| `checkout.service.ts` | Default session method follows active provider (not hardcoded BKASH) |

---

## 5. Remaining SSLCommerz references (intentional)

| Location | Purpose |
|----------|---------|
| `paymentProvider.registry.ts` | Strategy registry (inactive unless selected) |
| `sslcommerz.strategy.ts` / `sslcommerz.provider.ts` | Legacy provider support |
| `campaign.routes.ts` | Legacy IPN route `/payments/sslcommerz/ipn` |
| `payment.controller.ts` | Callback URL registry for ops/docs |

**None of these run for campaign checkout when `PAYMENT_PROVIDER=eps`.**

---

## 6. Verification result

| Requirement | Status |
|-------------|--------|
| EPS loaded from env | **Pass** (after restart) |
| Startup log `Active provider: eps` | **Pass** (after restart + real credentials) |
| No SSLCommerz in checkout/unified flow | **Pass** |
| Placeholder → clear EPS error | **Pass** |
| Full redirect flow | **Blocked** until real EPS credentials are set |

---

## 7. Next steps

1. Replace EPS placeholders in `.env` with sandbox values from EPS.
2. Restart API: `npm run dev`.
3. Confirm log: `[Payment] Active provider: eps`.
4. Run checkout init; expect `paymentUrl` from EPS `RedirectURL` (not SSLCommerz error).
