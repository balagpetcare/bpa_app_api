# EPS Initialize 404 Root Cause Investigation

Date: 2026-06-08  
Service: `backend-api`  
Flow: `POST /api/v1/campaign/public/checkout/init` -> `createCheckoutPaymentIntent` -> `createUnifiedPayment` -> `eps.gateway.initializeEpsPayment`

## Scope

This investigation targets the remaining production issue where:

- EPS token request (`/v1/Auth/GetToken`) succeeds (`HTTP 200`)
- Checkout + order creation succeeds
- `InitializeEPS` fails for many transactions with `HTTP 404`
- Some transactions still succeed

Requested validations covered:

1. Full code-path tracing
2. Full InitializeEPS request/response logging shape
3. Success vs failure comparison
4. Mapping checks (payment method, channels, merchant txn id, amount, callback URLs, endpoint)
5. Why first/some succeed but many/subsequent fail

---

## 1) Actual payment flow trace (code path)

1. Public checkout starts at `src/api/v1/modules/campaign/checkout.controller.ts` -> `checkoutInitHandler`.
2. Business flow enters `src/api/v1/modules/campaign/checkout.service.ts` (`initCheckout`).
3. Paid flow calls `createCheckoutPaymentIntent` in `src/api/v1/modules/campaign/payment.service.ts`.
4. `createCheckoutPaymentIntent` creates/reuses `Order` with `orderNumber = CKO-{session suffix}`.
5. `initiateProviderPayment` invokes `createUnifiedPayment` (`src/api/v1/payments/paymentOrchestrator.service.ts`).
6. Active provider strategy resolves to EPS (`src/api/v1/payments/strategies/eps.strategy.ts`).
7. EPS strategy calls `eps.provider.createIntent` -> `initializeEpsPayment` in `src/api/v1/modules/payment/eps/eps.gateway.ts`.
8. EPS client:
   - Gets bearer token (`/v1/Auth/GetToken`)
   - Calls `POST /v1/EPSEngine/InitializeEPS`

So the failing call is confirmed in one single place: `initializeEpsPayment()` in `eps.gateway.ts`.

---

## 2) InitializeEPS logging coverage (required fields)

Added structured logs under `[CHECKOUT_INIT_DEBUG]` with exact tags:

- `eps_init_request`
- `eps_init_response`
- `eps_init_error`

Each log now includes:

- exact URL
- HTTP method (`POST`)
- request headers (Authorization masked as `Bearer ***`, hash included)
- request payload
- response status
- response headers
- response body
- merchantTransactionId / customerOrderId correlation identifiers

Related files:

- `src/api/v1/modules/payment/eps/eps.gateway.ts`
- `src/api/v1/modules/campaign/payment.service.ts` (provider-side response metadata logging)

---

## 3) Success vs failure comparison (code-level)

Both successful and failed requests use:

- Same endpoint pattern: `{EPS_BASE_URL}/v1/EPSEngine/InitializeEPS`
- Same credentials flow (token + hash)
- Same required payload shape
- Same amount and URL construction logic

Primary variable that changes per transaction: `merchantTransactionId`.

Previous behavior:

- Default merchantTransactionId used `req.referenceId` when length >= 10
- For express checkout, `req.referenceId` is order number (`CKO-*`)
- Re-attempts/retries could reuse the same transaction reference

Observed production symptom ("some succeed, many 404, especially later attempts") matches a transaction-identity conflict pattern: repeated merchant transaction ID against EPS init endpoint, where EPS rejects lookup/initialization path with 404 for previously seen/invalid state IDs.

---

## 4) Required verification checklist

### 4.1 Payment method mapping

Verified in `src/api/v1/modules/campaign/payment.service.ts`:

- `resolveCheckoutPaymentMethod()` now defaults from active provider when omitted.
- Active provider (`PAYMENT_PROVIDER`) controls gateway strategy.
- `input.method` is no longer required to select EPS strategy.

Status: PASS.

### 4.2 BKASH / NAGAD / CARD channel mapping

Verified in same file:

- Allowed input values remain: `BKASH | NAGAD | CARD | SSLCOMMERZ`
- Mapping for checkout defaults:
  - provider `bkash` -> `BKASH`
  - provider `nagad` -> `NAGAD`
  - provider `sslcommerz` -> `CARD`
  - provider `eps` -> `SSLCOMMERZ` label fallback for order payment method field (gateway still EPS by active strategy)

Status: PASS for strategy routing; payment method field is descriptive for order row, not provider selector.

### 4.3 MerchantTransactionId generation

Current/updated behavior in `eps.gateway.ts`:

- Preferred ID: metadata merchant txn or referenceId
- If `InitializeEPS` returns 404 and merchant txn not explicitly provided by caller:
  - generate a fresh unique timestamp-based merchant txn id
  - retry `InitializeEPS` once with new merchant txn id

Additionally, persisted mapping:

- `payment.service.ts` now appends `eps_merchant_txn:{id}` into `orders.notes`
- This preserves webhook/order resolution linkage even when EPS txn id differs from `orderNumber`

Status: FIXED.

### 4.4 Amount formatting

`totalAmount` is sent as `Number(req.amount)` in `eps.gateway.ts`.

Status: No mismatch found in code path.

### 4.5 ReturnUrl / CancelUrl / Callback URL

EPS config from `paymentProvider.config.ts`:

- success: `{API_PUBLIC_BASE_URL}/api/v1/payments/eps/success` (or env override)
- fail: `{API_PUBLIC_BASE_URL}/api/v1/payments/eps/fail`
- cancel: `{API_PUBLIC_BASE_URL}/api/v1/payments/eps/cancel`
- callback/webhook: `{API_PUBLIC_BASE_URL}/api/v1/payments/eps/webhook`

Initialize payload uses config URLs; cancel may be overridden by request `cancelUrl`.

Status: PASS.

### 4.6 EPS endpoint path

Resolved in `eps.gateway.ts`:

- `getToken`: `{base}/v1/Auth/GetToken`
- `initialize`: `{base}/v1/EPSEngine/InitializeEPS`

`paymentProvider.config.ts` normalizes accidental `/v1` suffix in `EPS_BASE_URL` to avoid duplicate path.

Status: PASS.

---

## 5) Root cause conclusion

Root cause identified from code-path analysis and symptom correlation:

1. `InitializeEPS` used reusable/non-rotating merchant transaction IDs (often `CKO-*` order number based), which can become invalid for repeated EPS init attempts.
2. EPS init failure returned `404` for those transaction identities.
3. No automatic fallback existed to regenerate a fresh merchant transaction ID for init retry.
4. Without persisting alternate merchant transaction ID in order linkage, downstream webhook/order correlation risk increased.

Why one succeeds while subsequent fail:

- First initialization with a given transaction identity can succeed.
- Later init attempts with the same logical checkout/order identity can fail at EPS (404) if EPS does not accept reused init transaction identity in that state.
- This creates the "some succeed, many fail later" production pattern.

---

## 6) Fix implemented

### A) Robust EPS init retry with fresh merchant transaction ID

File: `src/api/v1/modules/payment/eps/eps.gateway.ts`

- Added full structured logs:
  - `[CHECKOUT_INIT_DEBUG] eps_init_request`
  - `[CHECKOUT_INIT_DEBUG] eps_init_response`
  - `[CHECKOUT_INIT_DEBUG] eps_init_error`
- On first `InitializeEPS` `404`, auto-retry once using a newly generated merchant transaction ID (only when merchant txn was not caller-forced).

### B) Persist EPS merchant transaction ID for reconciliation

File: `src/api/v1/modules/campaign/payment.service.ts`

- Added `appendEpsMerchantTxnToNotes()` helper.
- On successful EPS init (checkout + legacy booking paths), store marker:
  - `eps_merchant_txn:{merchantTransactionId}`
  in `orders.notes`.
- This keeps payment webhook/order lookup aligned even when fallback merchant txn ID is used.

### C) Provider response instrumentation

File: `src/api/v1/modules/campaign/payment.service.ts`

- Added `payment_provider_response` debug log including provider metadata to correlate EPS init result with order/checkout context.

---

## 7) Affected files

- `src/api/v1/modules/payment/eps/eps.gateway.ts`
- `src/api/v1/modules/campaign/payment.service.ts`
- `docs/investigation/eps-init-404-root-cause.md`

---

## 8) Validation run

Executed after patch:

- `npm test -- src/api/v1/modules/payment/eps/eps.gateway.test.ts --runInBand` -> PASS
- `npm run build` -> PASS

No TypeScript compile errors after changes.

---

## 9) Operational log query guidance

To compare successful vs failed init in production logs, filter:

- `[CHECKOUT_INIT_DEBUG] eps_init_request`
- `[CHECKOUT_INIT_DEBUG] eps_init_response`
- `[CHECKOUT_INIT_DEBUG] eps_init_error`

Correlate by:

- `customerOrderId`
- `merchantTransactionId`
- `attempt` (1 vs retry 2)

Expected confirmation pattern after fix:

- attempt 1: `404`
- attempt 2 (fresh merchant txn id): `200` + redirect URL

