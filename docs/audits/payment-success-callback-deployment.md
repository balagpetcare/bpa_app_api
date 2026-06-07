# EPS Payment Success Callback — Deployment Notes

**Date:** 2026-06-07  
**Related:** `docs/audits/payment-success-callback-root-cause.md`

---

## What changed

Production EPS success callbacks (`GET /api/v1/payments/eps/success`) now:

1. **Survive EPS verify HTTP 404** — falls back to signed browser callback params (`Status=Success`, `MerchantTransactionId`).
2. **Complete checkout fulfillment** — order → `COMPLETED`, session → `FULFILLED`, pending booking → `CONFIRMED`.
3. **Redirect with `checkoutId`** — resolved from order `CKO-*` even when EPS omits `ValueB` / `CustomerOrderId`.
4. **Send confirmation SMS once** — via `fulfillCheckoutSession` (not duplicated from `payment.service`).
5. **Log defensively** — `[EPS callback]` and `[EPS verify]` prefixes for production triage.

**No migration required.** Existing `orders`, `payment_transactions`, and `campaign_bookings` rows are preserved.

---

## Pre-deploy checklist

| Item | Action |
|------|--------|
| `CAMPAIGN_LANDING_URL` | Set to vaccination production URL (e.g. `https://vaccination.bangladeshpetassociation.com`) |
| `API_PUBLIC_BASE_URL` | Public API base used in EPS dashboard callbacks |
| `EPS_*` credentials | Match environment where payments are taken (sandbox vs `pgapi.eps.com.bd`) |
| EPS merchant panel | Success/fail/cancel/webhook URLs → `/api/v1/payments/eps/*` |
| SMS | `SMS_ENABLED=true`, BulkSMSBD keys, notification worker if `REDIS_ENABLED=true` |
| Redis | Running for SMS queue (optional; sync fallback exists) |

---

## Deploy steps

```bash
cd backend-api
git pull
npm ci
npm run build
# Review — no new Prisma migration in this fix
node scripts/check-migration-integrity.js   # if policy requires
pm2 restart bpa-api   # or your process manager
```

---

## Post-deploy verification

### 1. Callback route alive

```bash
curl -sI "https://<API_HOST>/api/v1/payments/eps/success?Status=Success&MerchantTransactionId=TEST"
```

Expect `302` redirect (or `200` JSON with `Accept: application/json`), not `500` axios error JSON.

### 2. Stuck production payment (optional recovery)

If order `CKO-EZTUBGCU` is still `PENDING` after deploy, replay the success URL:

```
GET /api/v1/payments/eps/success?Status=Success&MerchantTransactionId=CKO-EZTUBGCU&EPSTransactionId=<EPS_TXN_ID>
```

Idempotent: safe to call multiple times.

### 3. Database checks

After a test payment:

```sql
SELECT id, order_number, payment_status FROM orders WHERE order_number LIKE 'CKO-%' ORDER BY id DESC LIMIT 5;
SELECT id, status, booking_id FROM campaign_checkout_sessions ORDER BY created_at DESC LIMIT 5;
SELECT id, booking_ref, payment_status, status FROM campaign_bookings ORDER BY id DESC LIMIT 5;
SELECT id, template_code, status FROM campaign_sms_logs ORDER BY id DESC LIMIT 5;
```

Expect: order `COMPLETED`, session `FULFILLED`, booking `COMPLETED`/`CONFIRMED`, SMS log `SENT` or `QUEUED`.

### 4. User journey

1. Complete express checkout → EPS pay.
2. Land on `{CAMPAIGN_LANDING_URL}/book/success?checkoutId=<session-uuid>`.
3. Success page polls until `FULFILLED` → shows booking ref + verification.
4. SMS received on owner phone.

### 5. Logs

```bash
grep "\[EPS callback\]" /var/log/bpa-api.log
grep "\[EPS verify\]" /var/log/bpa-api.log
```

Look for `verify_fallback` (EPS API 404 but callback processed) vs `webhook_done` with `success: true`.

---

## Rollback

Revert to previous `backend-api` release and restart API. No schema rollback needed. Payments completed under the fix remain valid.

---

## Known limitations

- `/book/confirm/[ref]` remains legacy OTP flow; express checkout uses `/book/success?checkoutId=`.
- EPS verify 404 is logged; ops should still align `EPS_BASE_URL` with EPS support if verify should succeed.
- Browser unhandled errors redirect to generic `/book/success` or `/book/payment/failed` (not JSON).
