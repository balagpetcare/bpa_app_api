# Payment Production Readiness

**Project:** `D:\BPA_Data\backend-api`  
**Date:** June 2, 2026  
**Gateways:** bKash, Nagad, SSLCommerz  
**Scope:** Vaccination campaign booking payments + coupon alignment

---

## Executive summary

| Area | Status | Notes |
|------|--------|--------|
| Mock payment paths | **Removed** | No `/payment/mock` fallback; gateways must be configured |
| Production callback URLs | **Implemented** | Derived from `API_PUBLIC_BASE_URL`; see registry endpoint |
| Webhook signatures | **Implemented** | Nagad RSA, SSLCommerz IPN hash + validation API, bKash execute API |
| Replay protection | **Implemented** | Redis event keys + DB `orderPayment.reference` dedup |
| Duplicate transactions | **Implemented** | Serializable orders + idempotent webhook |
| Refunds | **Implemented** | bKash refund API; Nagad/SSL manual follow-up documented |
| Payment timeout | **Implemented** | `CAMPAIGN_PAYMENT_TIMEOUT_MINUTES` (default 30) |
| Failed payment recovery | **Implemented** | Retry intent resets FAILED → PENDING |
| Coupon amount alignment | **Fixed** | Server pricing = landing `bookingPricing.ts` |

---

## Callback URL registry

Set `API_PUBLIC_BASE_URL` to your public API host (HTTPS in production).

| Gateway | URL |
|---------|-----|
| bKash execute | `{API_PUBLIC_BASE_URL}/api/v1/campaign/public/payments/bkash/callback` |
| Nagad | `{API_PUBLIC_BASE_URL}/api/v1/campaign/public/payments/nagad/callback` |
| SSLCommerz IPN | `{API_PUBLIC_BASE_URL}/api/v1/campaign/public/payments/sslcommerz/ipn` |
| SSLCommerz success/fail/cancel | `{API_PUBLIC_BASE_URL}/api/v1/campaign/public/payments/sslcommerz/{success\|fail\|cancel}` |
| Generic relay (optional) | `{API_PUBLIC_BASE_URL}/api/v1/campaign/public/payments/webhook` |

**DevOps check:** `GET /api/v1/campaign/public/payments/callback-urls`

Register these exact URLs in each gateway merchant dashboard.

---

## Environment variables

See `.env.example` sections:

- `API_PUBLIC_BASE_URL`, `CAMPAIGN_LANDING_URL`
- `BKASH_*`, `NAGAD_*`, `SSLCOMMERZ_*`
- `CAMPAIGN_BOOKING_COUPONS` (must match `NEXT_PUBLIC_BOOKING_COUPONS` on landing)
- `CAMPAIGN_PAYMENT_WEBHOOK_SECRET`, `CAMPAIGN_PAYMENT_TIMEOUT_MINUTES`
- `REDIS_URL` (replay guard; recommended in production)

---

## Coupon system (three-way match)

| Layer | Source of truth |
|-------|-----------------|
| Landing UI | `vaccination_2026/lib/bookingPricing.ts` + `bookingCoupons.ts` |
| Backend charge | `campaignPricing.service.ts` + `campaignCoupon.service.ts` |
| Gateway | `order.totalAmount` from backend `createPaymentIntent` |

Flow:

1. User applies coupon on landing (client preview).
2. `POST /booking/:ref/payment` sends `couponCode` → server validates and sets `order.totalAmount`.
3. Gateway session uses that amount.
4. Webhook rejects `SUCCESS` if `payload.amount` ≠ `order.totalAmount` (±0.01).

Validate coupon without booking: `POST /api/v1/campaign/public/coupons/validate`

---

## Security controls

### Webhook signatures

- **bKash:** Server calls execute API with `paymentID` (do not trust query alone).
- **Nagad:** RSA-SHA256 verify on `sensitiveData` + `signature`.
- **SSLCommerz:** IPN `verify_sign` check + `validationserverAPI` with `val_id`.
- **Generic webhook:** Optional `x-campaign-payment-secret` header.

### Replay protection

1. Redis key `campaign:payment:event:{provider}:{eventId}` (7-day TTL).
2. `orderPayment.reference` unique per provider transaction id.

### Duplicate prevention

- Serializable transaction on order create.
- One active order per `campaign_booking:{id}` in notes.
- Webhook early-return when order already `COMPLETED`.

---

## Refunds

`processRefund` calls provider `refund` when available:

- **bKash:** Refund API wired.
- **Nagad / SSLCommerz:** Mark booking refunded in DB; initiate refund in merchant portal until provider adapters are extended.

---

## Payment timeout & recovery

| Scenario | Behavior |
|----------|----------|
| Pending > timeout | Order → `FAILED`/`CANCELLED`, booking → `FAILED` |
| User retries after FAILED | `createPaymentIntent` reopens order as `PENDING` and new gateway session |
| Duplicate SUCCESS webhook | `duplicate: true`, no second SMS |

---

## Pre-launch checklist

- [ ] `API_PUBLIC_BASE_URL` set to production API URL (HTTPS)
- [ ] `CAMPAIGN_LANDING_URL` set for bKash redirect after pay
- [ ] bKash, Nagad, SSLCommerz credentials (sandbox UAT first)
- [ ] Callback URLs registered in all three dashboards
- [ ] `CAMPAIGN_BOOKING_COUPONS` synced with landing env
- [ ] `REDIS_URL` reachable for replay guard
- [ ] `CAMPAIGN_PAYMENT_WEBHOOK_SECRET` set in production
- [ ] End-to-end test on sandbox for each method

---

## Tests

```bash
cd D:\BPA_Data\backend-api
npm test -- src/api/v1/modules/campaign/campaignPricing.service.test.ts src/api/v1/modules/campaign/campaign.paymentGuards.test.ts src/api/v1/modules/campaign/payment.service.test.ts src/api/v1/providers/paymentProvider.config.test.ts
```

---

## Files added/updated

```
src/api/v1/providers/bkash.provider.ts
src/api/v1/providers/nagad.provider.ts
src/api/v1/providers/sslcommerz.provider.ts
src/api/v1/providers/paymentProvider.config.ts
src/api/v1/providers/paymentReplay.guard.ts
src/api/v1/modules/campaign/campaignCoupon.service.ts
src/api/v1/modules/campaign/campaignPricing.service.ts
src/api/v1/modules/campaign/payment.webhooks.service.ts
src/api/v1/modules/campaign/payment.service.ts
src/api/v1/modules/campaign/campaign.routes.ts
vaccination_2026/lib/campaignApi.ts
vaccination_2026/components/booking/BookingWizard.tsx
```

---

## Known limitations

1. **Nagad refunds** — manual/portal until API adapter added.
2. **SSLCommerz refunds** — same as above.
3. **Redis unavailable** — replay guard degrades to DB reference dedup only.
4. **QR HMAC** — separate hardening item (see `PAYMENT-AUDIT-REPORT.md`).
