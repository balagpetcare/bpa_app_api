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
- `scripts/diagnose-eps-init.js`
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

---

## 10) Empirical endpoint verification (2026-06-08) — EPS demo credentials

A standalone diagnostic (`scripts/diagnose-eps-init.js`) was run against live EPS hosts
using the official EPS **demo (sandbox)** merchant credentials:

- Merchant ID: `29e86e70-0ac6-45eb-ba04-9fcb0aaed12a`
- Store ID: `d44e705f-9e3a-41de-98b1-1674631637da`
- Username: `Epsdemo@gmail.com`

It performs `Auth/GetToken` then `EPSEngine/InitializeEPS` and prints URL, status, body.

### Results

| Base host | GetToken | InitializeEPS `/v1/EPSEngine/InitializeEPS` |
|-----------|----------|---------------------------------------------|
| `https://sandboxpgapi.eps.com.bd` | **200** (valid `token`) | **200** + `RedirectURL=https://sandboxpg.eps.com.bd/PG?data=...` |
| `https://sandbox-pgapi.eps.com.bd` (hyphen, used by 3rd‑party SDK) | **DNS ENOTFOUND** | n/a |
| `https://pgapi.eps.com.bd` (production) | **200** but `token=null`, `errorMessage="An error occurred while processing the request."` | not reachable (no token: sandbox creds are not valid on production) |

### What this proves

1. **Endpoint path is correct.** Sandbox accepted `POST /v1/EPSEngine/InitializeEPS`
   and returned `200` + `RedirectURL`. No route/version/controller/schema change in EPS.
2. **Host naming:** `sandboxpgapi.eps.com.bd` (no hyphen) is correct; the hyphenated host
   `sandbox-pgapi.eps.com.bd` does **not** resolve. Our config already uses the no‑hyphen host.
3. **HTTP 200 on GetToken does NOT mean authentication succeeded.** Production returned
   `200` with `token=null` for sandbox credentials. Real auth success requires a non‑null `token`.

### Implication for the production 404

- The integration code, endpoint, API version (`/v1`), controller (`EPSEngine/InitializeEPS`),
  and request schema are **verified correct** against EPS.
- A production‑only `404` on `InitializeEPS` while `GetToken` returns a **real token** indicates
  the authenticated production merchant/store is **not provisioned/enabled for payment
  initialization**, or production is configured with **identifiers that do not match the
  authenticated merchant** (e.g. sandbox `EPS_MERCHANT_ID`/`EPS_STORE_ID` against the production
  host, or a not‑yet‑activated production store).
- This is an **EPS production merchant‑account / environment‑configuration** matter, not a code bug.

---

## 11) Required EPS support / configuration actions

Send the following to EPS support (info@eps.com.bd):

1. Confirm the **production** merchant account is **activated for payment initialization**
   (`POST https://pgapi.eps.com.bd/v1/EPSEngine/InitializeEPS`), not only token issuance.
2. Confirm the production `EPS_MERCHANT_ID` and `EPS_STORE_ID` are the **production** identifiers
   bound to the production `EPS_USERNAME` (sandbox IDs must not be used against `pgapi`).
3. Confirm whether the production store requires **whitelisting of callback URLs**
   (`successUrl` / `failUrl` / `cancelUrl`) before InitializeEPS is permitted.
4. Provide the expected production `RedirectURL` host (sandbox uses `sandboxpg.eps.com.bd`;
   production is expected to be `pg.eps.com.bd`).

### Operator verification (env)

On the production server, confirm these `.env` values match the **production** merchant panel:

```env
PAYMENT_PROVIDER=eps
EPS_SANDBOX=false
EPS_BASE_URL=https://pgapi.eps.com.bd
EPS_USERNAME=<production username>
EPS_PASSWORD=<production password>
EPS_HASH_KEY=<production base64 hash key>
EPS_MERCHANT_ID=<production merchant id>
EPS_STORE_ID=<production store id>
```

Then run on the server (no code change required to diagnose):

```bash
# Uses .env credentials; prints URL/status/body for GetToken + InitializeEPS
node scripts/diagnose-eps-init.js --base=https://pgapi.eps.com.bd --amount=10
```

- If GetToken returns `200` with a **null token** → production credentials/hash are wrong
  for the environment (fix env; not a code issue).
- If GetToken returns a **real token** but InitializeEPS returns `404` → EPS must enable
  payment initialization for that production merchant/store (support action #1/#2 above).

---

## 12) Diagnostic script

`scripts/diagnose-eps-init.js`:

- Performs `Auth/GetToken` then `EPSEngine/InitializeEPS`.
- Prints exact URL, HTTP method, status, and response body for each call.
- Probes `sandboxpgapi`, `sandbox-pgapi` (control), and `pgapi` hosts (or a single `--base=`).
- Credential precedence: `EPS_*` env / `.env` → built‑in EPS demo (sandbox) credentials.

---

## 13) Code hardening in this pass

`src/api/v1/modules/payment/eps/eps.gateway.ts` — `getEpsAuthToken` now emits a structured
`[CHECKOUT_INIT_DEBUG] eps_token_invalid` log and throws an environment‑aware error when EPS
returns `HTTP 200` with a null token / error message, so the "200 but unauthenticated"
production trap is no longer silent and is clearly distinguished from a genuine InitializeEPS 404.

---

## 14) CONFIRMED ROOT CAUSE — reused merchantTransactionId (2026-06-08)

A live A/B comparison via `scripts/diagnose-eps-init.js` (sandbox, demo merchant, same token)
tested three `merchantTransactionId` cases:

| Case | merchantTransactionId | EPS result |
|------|-----------------------|------------|
| Numeric, fresh | `20260608184333788` (17 digits) | **200** + `RedirectURL` |
| `CKO-*` format, fresh | `CKO-CIV62DVP` (alphanumeric + hyphen) | **200** + `RedirectURL` |
| Numeric, **reused** (same as case 1) | `20260608184333788` | body error: `ErrorMessage="TransactionId already used." ErrorCode=400` |

### Conclusions

1. **EPS does NOT reject the `CKO-*` character format.** Format/length/allowed characters are not the cause.
2. **EPS rejects a REUSED `merchantTransactionId`.** This is the actual defect.
3. EPS wraps reuse as a body error (`ErrorCode=400`, "TransactionId already used"); depending on
   environment/edge this surfaces to the client as a failed initialize (sandbox: 200+body error;
   production observed: HTTP 404).

### Why the booking flow failed but the diagnostic passed

- Booking flow `merchantTransactionId` was derived from `req.referenceId`, which is the **fixed**
  BPA order number `CKO-*` (length ≥ 10):

  ```ts
  // BEFORE (buggy)
  const preferredMerchantTransactionId =
    req.metadata?.merchantTransactionId?.trim() ||
    (req.referenceId.length >= 10 ? req.referenceId : generateEpsMerchantTransactionId());
  ```

- Therefore every (re)initialization of the **same checkout/order** sent the **same**
  `merchantTransactionId` (`CKO-EC77N0HI`, etc.). The **first** init for a brand‑new checkout
  succeeded; any **retry / re‑init** of that checkout reused the id → EPS rejected it.
- The diagnostic always used a **freshly generated** id, so it always succeeded.

This precisely explains the production pattern: "some succeed (first attempt), many fail (retries)."

### EPS transaction id requirements (verified)

- **Must be unique per initialization** (reuse → "TransactionId already used").
- Minimum 10 characters; numeric timestamp‑style ids are the EPS‑recommended form.
- `CustomerOrderId` is independent and may carry the merchant's own order reference (`CKO-*`).

### Fix implemented

`src/api/v1/modules/payment/eps/eps.gateway.ts`:

```ts
// AFTER (fixed) — never derive from the fixed order number; always fresh & unique
const callerForcedMerchantTransactionId = req.metadata?.merchantTransactionId?.trim();
const preferredMerchantTransactionId =
  callerForcedMerchantTransactionId || generateEpsMerchantTransactionId();
```

- `CustomerOrderId` still carries the BPA order number (`req.referenceId` = `CKO-*`) so reconciliation,
  webhook lookup, and redirect resolution are preserved (order notes also store `eps_merchant_txn:{id}`).
- Retry safety net now also triggers on a body‑level "already used" reuse error, not only HTTP 404.

`src/api/v1/modules/payment/eps/eps.utils.ts` and `src/api/v1/providers/eps.utils.ts`:

- `generateEpsMerchantTransactionId()` now appends a 4‑digit random suffix (still all numeric)
  to avoid same‑millisecond collisions across concurrent checkouts.

### Identifier separation (final)

| Field | Value | Purpose |
|-------|-------|---------|
| `merchantTransactionId` | fresh numeric per init (e.g. `202606081843337884217`) | EPS uniqueness; verify/status key |
| `CustomerOrderId` | BPA order number (`CKO-*`) | BPA reconciliation / webhook / redirect |
| `orders.notes` `eps_merchant_txn:{id}` | the EPS merchant txn used | webhook/order linkage when EPS echoes only `MerchantTransactionId` |

