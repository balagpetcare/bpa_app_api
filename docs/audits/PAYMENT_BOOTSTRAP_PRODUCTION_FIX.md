# Payment Bootstrap Production Fix

**Date:** 2026-06-06  
**Project:** `backend-api`  
**Symptom:** `[PAYMENT_INIT] bootstrap failed` — API exits in production when `PAYMENT_PROVIDER=eps` but EPS credentials are unset.

---

## Bootstrap flow (before fix)

1. `src/index.ts` calls `bootstrapPaymentProvider()` during startup (before `server.listen`).
2. `paymentProvider.bootstrap.ts` runs `validateActivePaymentProviderConfig()`:
   - Checks `API_PUBLIC_BASE_URL` (or fallbacks)
   - Checks provider-specific env (`EPS_USERNAME`, `EPS_PASSWORD`, `EPS_STORE_ID`, `EPS_HASH_KEY`, `EPS_MERCHANT_ID`, …)
3. If validation fails **and** `NODE_ENV === "production"` → **throws**
4. `index.ts` catch block → `process.exit(1)`

Payment was **required at startup** (fail-fast). It is **optional until first payment request** at the orchestrator layer.

---

## Runtime behavior at request time (unchanged)

`paymentOrchestrator.service.ts` → `createUnifiedPayment()`:

```typescript
if (!isProviderConfigured(provider)) {
  return { success: false, message: formatProviderNotConfiguredMessage(provider), provider };
}
```

Missing credentials block **payment create/verify**, not API boot.

---

## Changes

### `paymentProvider.bootstrap.ts`

- Removed production `throw` on misconfiguration
- Logs `console.warn` with: `API will start; payment create/verify will fail until configured`
- Returns `ready: false` and populates `warnings` / `errors`

### `index.ts`

- Removed `process.exit(1)` on `[PAYMENT_INIT]` failure
- Logs `[PAYMENT_INIT] Provider "…" unavailable at startup — payment APIs disabled until credentials are set` when `!paymentBoot.ready`

---

## Verification

```bash
npm run build

PAYMENT_PROVIDER=eps \
EPS_USERNAME= EPS_PASSWORD= EPS_STORE_ID= EPS_HASH_KEY= EPS_MERCHANT_ID= \
NODE_ENV=production PORT=3096 \
node dist/index.js
```

```text
[Payment] Active provider: eps | NOT ready: … EPS_USERNAME is missing; … — API will start; payment create/verify will fail until configured.
[PAYMENT_INIT] Provider "eps" unavailable at startup — payment APIs disabled until credentials are set
🚀 Server running at http://0.0.0.0:3096/api/v1
```

No `process.exit`. No uncaught bootstrap exception.

---

## Production guidance

| State | API boot | Payment endpoints |
|-------|----------|-------------------|
| EPS creds missing | ✅ Starts | ❌ Returns 400 / not-configured message on create |
| EPS creds + `API_PUBLIC_BASE_URL` set | ✅ Starts | ✅ Ready |

Set credentials in `.env` or host env when enabling live payments. Until then, non-payment routes (health, auth, clinic, etc.) operate normally.

---

## Files modified

| File | Change |
|------|--------|
| `src/api/v1/payments/paymentProvider.bootstrap.ts` | Warn-only bootstrap; no production throw |
| `src/index.ts` | No exit on payment init failure |
| `docs/audits/PAYMENT_BOOTSTRAP_PRODUCTION_FIX.md` | This report |
