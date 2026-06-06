# EPS Payment Gateway — Full Repository Audit

**Repository:** `backend-api` (source of truth)  
**Date:** 2026-06-07 (updated)  
**Scope:** BPA/WPA Vaccination 2026 — payment architecture, EPS status, booking flow, gap analysis

---

## Executive Summary

| Question | Answer |
|----------|--------|
| **EPS status** | **B — Partially implemented** at audit start; **completed in this pass** with callback URL fixes, branch resolver, `/payments/eps/*` routes, and order lookup hardening |
| **Payment abstraction** | Strategy Pattern via `PAYMENT_PROVIDER` env; do not duplicate |
| **Frontend EPS-specific?** | No — provider-agnostic; uses `paymentUrl` from checkout API |
| **"Campaign payment setup not configured"** | **Backend** — missing `ACTIVE` branch for `orders.branchId` (not EPS credentials) |

---

# PHASE 1 — REPOSITORY AUDIT

## Search coverage

Terms searched across `backend-api`: `EPS`, `eps`, `payment`, `payment gateway`, `transaction`, `sslcommerz`, `bkash`, `nagad`, `webhook`, `callback`, `order payment`, `booking payment`.

Inspected: `src/api/v1/**`, `prisma/schema.prisma`, migrations, `.env.example`, `vaccination_2026` frontend.

---

## Existing Payment Architecture

### Providers (Strategy Pattern)

| Provider | Strategy | Config helper |
|----------|----------|---------------|
| EPS | `payments/strategies/eps.strategy.ts` | `getEpsConfig()` |
| SSLCommerz | `sslcommerz.strategy.ts` | `getSslCommerzConfig()` |
| bKash | `bkash.strategy.ts` | `getBkashConfig()` |
| Nagad | `nagad.strategy.ts` | `getNagadConfig()` |
| AmarPay | `amarpay.strategy.ts` | `getAmarPayConfig()` |

Active provider: `PAYMENT_PROVIDER` env (default `eps`).

### Service layers

```
Campaign checkout/booking
  → payment.service.ts (Order + CampaignBooking)
  → paymentOrchestrator.service.ts (unified create/verify/webhook)
  → eps.strategy.ts → eps.provider.ts → eps.gateway.ts

Direct EPS module (optional/testing)
  → eps.controller.ts → eps.service.ts → eps.gateway.ts
```

### Transaction models

| Model | Table | Purpose |
|-------|-------|---------|
| `PaymentTransaction` | `payment_transactions` | Gateway txn per booking (`gateway` + `transactionId` unique) |
| `PaymentTransactionLog` | `payment_transaction_logs` | Audit phases: CREATE, VERIFY, WEBHOOK |
| `Order` | `orders` | Campaign payment anchor (`CAMP-*`, `CKO-*`) |
| `OrderPayment` | `order_payments` | Completed payment reference |
| `CampaignBooking` | `campaign_bookings` | `paymentStatus`, `status`, `paymentOrderId` |

Migrations: `20260603140000_payment_transaction_log`, `20260605160000_payment_transactions`.

### Status flow

**Booking (paid campaign):**

| Stage | `CampaignBooking.status` | `paymentStatus` |
|-------|--------------------------|-----------------|
| Created (checkout) | `DRAFT` / `PENDING_ASSIGNMENT` | `PENDING` |
| Payment success | `CONFIRMED` | `COMPLETED` |
| Payment failed | unchanged / `DRAFT` | `FAILED` |
| Payment cancelled | unchanged | `FAILED` |
| Free campaign | `CONFIRMED` | `NOT_REQUIRED` |

**Order:**

| Event | `Order.paymentStatus` | `Order.status` |
|-------|----------------------|----------------|
| Initiated | `PENDING` | `PENDING` |
| Success | `COMPLETED` | `DELIVERED` |
| Failed/Cancelled | `FAILED` | `CANCELLED` |

Idempotency: `paymentReplay.guard`, Serializable transactions, duplicate `orderPayment` guard.

---

## EPS Status

### Verdict: **Partially implemented → Complete (after this pass)**

### Existing files (before changes)

**Core module**
- `src/api/v1/modules/payment/eps/eps.config.ts`
- `src/api/v1/modules/payment/eps/eps.gateway.ts`
- `src/api/v1/modules/payment/eps/eps.service.ts`
- `src/api/v1/modules/payment/eps/eps.controller.ts`
- `src/api/v1/modules/payment/eps/eps.routes.ts`
- `src/api/v1/modules/payment/eps/eps.types.ts`
- `src/api/v1/modules/payment/eps/eps.validation.ts`
- `src/api/v1/modules/payment/eps/eps.utils.ts`

**Unified layer**
- `src/api/v1/payments/paymentOrchestrator.service.ts`
- `src/api/v1/payments/payment.controller.ts`
- `src/api/v1/payments/payment.routes.ts`
- `src/api/v1/payments/strategies/eps.strategy.ts`
- `src/api/v1/payments/paymentProvider.registry.ts`
- `src/api/v1/payments/paymentProvider.bootstrap.ts`
- `src/api/v1/providers/paymentProvider.config.ts`
- `src/api/v1/providers/eps.provider.ts`
- `src/api/v1/providers/paymentReplay.guard.ts`

**Campaign integration**
- `src/api/v1/modules/campaign/payment.service.ts`
- `src/api/v1/modules/campaign/checkout.service.ts`
- `src/api/v1/modules/campaign/campaign.routes.ts`
- `src/api/v1/modules/payment/paymentTransaction.service.ts`

---

## Vaccination Flow Analysis

### Booking creation (express checkout)

1. `POST /api/v1/campaign/public/checkout/init` (`checkout.service.ts`)
2. Validates campaign, location, pricing
3. Creates `CampaignCheckoutSession` (PENDING)
4. If paid: creates **pending** `CampaignBooking` (`paymentStatus=PENDING`, `status=DRAFT`)
5. Calls `createCheckoutPaymentIntent` → `createUnifiedPayment` → EPS Initialize
6. Returns `paymentUrl` to frontend

### Payment expectation

- Frontend redirects to `paymentUrl` (EPS hosted page)
- No direct EPS API calls from `vaccination_2026`

### Confirmation timing

- **After** EPS success callback/webhook → `processPaymentWebhook`
- Order `COMPLETED` → Booking `CONFIRMED` + SMS

### Payment state attachment

- `CampaignBooking.paymentStatus` + `paymentOrderId`
- `Order` linked via notes: `campaign_checkout:{sessionId}` or `campaign_booking:{id}`
- `PaymentTransaction` / `PaymentTransactionLog` for gateway audit

---

## Frontend Expectations

| Check | Result |
|-------|--------|
| Expects EPS by name? | Label only (`StepPaymentGateway.tsx` — `EPS` in `METHOD_LABELS`) |
| Calls payment endpoints? | `POST .../checkout/init` → uses `paymentUrl` |
| EPS credentials in frontend? | No |
| "Campaign payment setup not configured" | **Backend only** — see below |

### Root cause: "Campaign payment setup not configured"

**Source:** `payment.service.ts` → `createCheckoutPaymentIntent` / `createPaymentIntent`

**Not EPS-related.** Thrown when no `ACTIVE` branch exists for `orders.branchId`:

```typescript
const defaultBranch = await resolveCampaignPaymentBranch(campaign);
if (!defaultBranch) {
  return { success: false, error: "Campaign payment setup not configured: ..." };
}
```

**Common causes:**
1. Zero rows in `branches` with `status = 'ACTIVE'`
2. Campaign `organizerId` set but no matching org branch
3. Local/dev DB not seeded with branches

**Fix:** Seed an active branch or set `CAMPAIGN_PAYMENT_BRANCH_ID` in `.env`.

See: `docs/debug/campaign-checkout-payment-setup-report.md`

---

# PHASE 2 — GAP ANALYSIS

## Implementation Requirements

| Item | Classification | Status |
|------|----------------|--------|
| EPS callback URLs wrong path (`/payments/payment/eps`) | **Critical** | Fixed → `/api/v1/payments/eps/*` |
| Webhook order lookup used merchant txn id not `CustomerOrderId` | **Critical** | Fixed |
| Missing `GET /payments/eps/verify/:transactionId` | **Recommended** | Added |
| Missing `/payments/eps/success|fail|cancel` aliases | **Recommended** | Added |
| Dual mount `/payment/eps` + `/payments/eps` | **Recommended** | Added |
| `EPS_CALLBACK_URL` env | **Recommended** | Added |
| EPS route fail-fast when not configured | **Recommended** | `requireEpsConfigured` middleware |
| Campaign callback registry missing EPS | **Recommended** | Fixed |
| Branch resolver too strict (organizer-only) | **Critical** (checkout blocker) | `resolveCampaignPaymentBranch` + fallback |
| `CAMPAIGN_PAYMENT_BRANCH_ID` env | **Recommended** | Added |
| Prisma migration for payment tables | **N/A** | Already exists |
| Duplicate payment abstraction | **Avoid** | Reused strategy + gateway |
| GET verify only (user spec) vs POST validate | **Optional** | Both supported |

---

# PHASE 3 — IMPLEMENTATION SUMMARY

## Environment variables

All supported with validation via `validateActivePaymentProviderConfig()` and `isEpsModuleConfigured()`:

- `EPS_MERCHANT_ID`, `EPS_STORE_ID`, `EPS_USERNAME`, `EPS_PASSWORD`, `EPS_HASH_KEY`
- `EPS_BASE_URL`, `EPS_CALLBACK_URL`, `EPS_SUCCESS_URL`, `EPS_FAIL_URL`, `EPS_CANCEL_URL`
- `CAMPAIGN_PAYMENT_BRANCH_ID` (checkout branch anchor)

## API routes (canonical)

| Method | Path |
|--------|------|
| POST | `/api/v1/payments/eps/initiate` |
| POST | `/api/v1/payments/eps/validate` |
| GET | `/api/v1/payments/eps/verify/:transactionId` |
| GET/POST | `/api/v1/payments/eps/webhook` |
| GET | `/api/v1/payments/eps/success` |
| GET | `/api/v1/payments/eps/fail` |
| GET | `/api/v1/payments/eps/cancel` |

**Backward-compatible aliases:** `/api/v1/payment/eps/*` and `/callback/success|fail|cancel`.

## Database changes

**None in this pass** — reuses existing `payment_transactions`, `payment_transaction_logs`, `orders`, `campaign_bookings`.

---

# PHASE 4 — VALIDATION

Run:

```bash
npm test -- --testPathPattern="eps|paymentProvider|payment\.service"
npx tsc --noEmit
npx prisma validate
```

---

## Related documentation

- Setup & deployment: [eps-gateway-setup.md](./eps-gateway-setup.md)
- Branch error deep-dive: [../debug/campaign-checkout-payment-setup-report.md](../debug/campaign-checkout-payment-setup-report.md)
- Prior payment audit: [../vaccination-campaign-2026/PAYMENT-AUDIT-REPORT.md](../vaccination-campaign-2026/PAYMENT-AUDIT-REPORT.md)
