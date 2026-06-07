# Payment Success Production — Deployment Checklist

**Date:** 2026-06-07  
**Fixes:** EPS redirect `checkoutId` resolution, frontend recovery, SMS dedup, structured logging  
**Related:** `production-payment-success-bug.md`, `payment-success-callback-root-cause.md`

---

## Pre-deploy

| # | Check | Owner |
|---|--------|-------|
| 1 | `backend-api` branch includes EPS redirect resolver + `payment.controller` ssl redirect fix | Dev |
| 2 | `vaccination_2026` includes `/book/success` sessionStorage recovery | Dev |
| 3 | `CAMPAIGN_LANDING_URL` = production vaccination site (e.g. `https://vaccination.bangladeshpetassociation.com`) | Ops |
| 4 | `API_PUBLIC_BASE_URL` = production API host | Ops |
| 5 | EPS merchant panel success URL = `{API}/api/v1/payments/eps/success` (**not** `/webhook/redirect/success`) | Ops |
| 6 | `SMS_ENABLED=true`, BulkSMSBD credentials set | Ops |
| 7 | Notification worker running if `REDIS_ENABLED=true` | Ops |
| 8 | No new Prisma migration in this release | Dev |

---

## Deploy order

### 1. Backend API

```bash
cd backend-api
git pull
npm ci
npm run build
node scripts/check-migration-integrity.js   # policy check; no new migration expected
# restart API (pm2/systemd/docker)
```

### 2. Vaccination landing

```bash
cd vaccination_2026
git pull
npm ci
npm run build
# restart Next.js / redeploy static host
```

---

## Post-deploy smoke tests

### API callback (no charge)

```bash
curl -sI "https://<API_HOST>/api/v1/payments/eps/success?Status=Success&MerchantTransactionId=CKO-TEST0001"
```

Expect: `302` to `{CAMPAIGN_LANDING_URL}/book/success?checkoutId=...` **or** `/book/payment/failed` — **not** `500` JSON.

### Live payment (sandbox or low-value)

1. Start express checkout on production landing.
2. Complete EPS payment.
3. Confirm browser URL: `/book/success?checkoutId=<cuid>`.
4. Confirm success UI shows booking ref (not "No campaign was selected").
5. Confirm SMS received (or `campaign_sms_logs` row).

### Stuck order recovery (optional)

Replay success URL for a paid-but-unfulfilled `CKO-*` order:

```
GET /api/v1/payments/eps/success?Status=Success&MerchantTransactionId=CKO-XXXXXXXX&EPSTransactionId=<EPS_ID>
```

Idempotent — safe to repeat.

---

## Database verification

```sql
-- Latest checkout order
SELECT id, order_number, payment_status, notes
FROM orders
WHERE order_number LIKE 'CKO-%'
ORDER BY id DESC LIMIT 5;

-- Session + booking
SELECT id, status, booking_id, order_id
FROM campaign_checkout_sessions
ORDER BY created_at DESC LIMIT 5;

SELECT id, booking_ref, payment_status, status, checkout_session_id
FROM campaign_bookings
ORDER BY id DESC LIMIT 5;

-- SMS
SELECT id, template_code, status, booking_id, created_at
FROM campaign_sms_logs
ORDER BY id DESC LIMIT 10;
```

**Pass:** `orders.payment_status = COMPLETED`, session `FULFILLED`, booking `CONFIRMED`/`COMPLETED`, SMS `SENT` or `QUEUED`.

---

## Log verification

```bash
grep "\[EPS callback\]" /var/log/bpa-api.log | tail -20
grep "\[EPS redirect\]" /var/log/bpa-api.log | tail -20
grep "\[CampaignPayment\] fulfill_checkout" /var/log/bpa-api.log | tail -10
grep "\[checkout\] sms_dispatch" /var/log/bpa-api.log | tail -10
```

**Pass patterns:**

- `[EPS redirect] context_resolved` with `checkoutId`
- `[EPS redirect] callback_redirect` with `redirectPath` containing `checkoutId=`
- `[CampaignPayment] fulfill_checkout_done`
- `[checkout] sms_dispatch` (once per booking)
- `[CampaignPayment] sms_skip_duplicate` when checkout path already sent SMS

---

## Rollback

| Component | Action |
|-----------|--------|
| API | Redeploy previous `backend-api` image/release |
| Landing | Redeploy previous `vaccination_2026` build |
| Data | No rollback needed — fulfillment is forward-only |

---

## Sign-off

| Role | Name | Date | OK |
|------|------|------|-----|
| Dev | | | ☐ |
| Ops | | | ☐ |
| QA | | | ☐ |
