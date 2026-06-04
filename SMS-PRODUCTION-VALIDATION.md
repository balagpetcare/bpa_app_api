# SMS Production Validation

**Project:** `D:\BPA_Data\backend-api`  
**Date:** June 2, 2026  
**Stack:** Redis · BullMQ (`notif_sms`) · SSL Wireless · BulkSMSBD

---

## Executive summary

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Real SMS send test | **Ready** | `scripts/sms-production-check.ts` + provider adapters |
| OTP delivery test | **Ready** | `otp.service` → queue or direct gateway fallback |
| Retry logic test | **Verified** | BullMQ `SMS_QUEUE_ATTEMPTS` + exponential backoff |
| Failure handling test | **Verified** | `logSmsFailure` + `CampaignSmsLog` FAILED + unit tests |
| Queue recovery test | **Ready** | `recoverStuckCampaignSmsLogs` + admin route |
| Delivery report logging | **Ready** | `POST /public/sms/delivery-callback` + optional webhook secret |
| SMS cost monitoring | **Ready** | `segmentCount` / `estimatedCostBdt` on `campaign_sms_logs` |

---

## Architecture

```
OTP / Campaign SMS
       ↓
campaign.smsQueue → enqueueSmsJob (notif_sms)
       ↓                    ↘ (if Redis off → direct sendSms)
notificationWorker
       ↓
smsGateway.service
  ├─ SSL Wireless (primary)
  ├─ BulkSMSBD (fallback)
  └─ mock (test / SMS_ALLOW_MOCK only)
       ↓
CampaignSmsLog + cost fields
```

**Worker command:** `npm run worker:notifications`

---

## Redis & BullMQ

| Check | How to validate |
|-------|-----------------|
| Redis reachable | `GET /api/v1/campaign/public/sms/health` → `redisEnabled: true` |
| OTP Redis | `checkOtpRedisHealth()` (used in validation script) |
| Unified config | `REDIS_URL` **or** `REDIS_HOST` + `REDIS_PORT` via `src/infrastructure/redis/redisConnection.ts` |
| Queue depth | Health payload: `queue.waiting`, `active`, `failed` |

**Fix applied:** BullMQ and OTP previously used different Redis config; now both use `getRedisConnectionOptions()`.

**Fix applied:** `enqueueSmsJob` returned silently when Redis was off — OTP could succeed without sending. Queue now returns `false`; OTP and campaign SMS fall back to **direct gateway send**.

---

## Providers

### SSL Wireless (primary)

- Env: `SSL_WIRELESS_API_TOKEN`, `SSL_WIRELESS_SENDER_ID`
- API: `POST {SSL_WIRELESS_BASE_URL}/api/v3/send-sms`

### BulkSMSBD (fallback)

- Env: `BULKSMSBD_API_TOKEN` or `BULKSMSBD_API_KEY`, `BULKSMSBD_SENDER_ID`
- Modes: `BULKSMSBD_API_MODE=rest_v3` (default) or `legacy`

### Production safety

- Unconfigured gateways in **production** no longer silently use mock unless `SMS_ALLOW_MOCK=true`.
- Dev fake “mark as SENT” requires `SMS_ALLOW_DEV_FAKE_SENT=true` (removed silent fake send).

---

## Test matrix

### 1. Real SMS send

```bash
# Configure .env with live credentials + REDIS_URL
npm run worker:notifications   # separate terminal
npx ts-node scripts/sms-production-check.ts --phone=017XXXXXXXX
```

### 2. OTP delivery

```bash
curl -X POST http://localhost:8080/api/v1/campaign/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"01712345678"}'
```

Verify SMS received; then `verify-otp` with the code.

**Unit tests:** `otp.service.test.ts` (queue path + direct fallback).

### 3. Retry logic

- Env: `SMS_QUEUE_ATTEMPTS=3`, `SMS_QUEUE_BACKOFF_MS=5000`
- Worker rethrows on gateway failure → BullMQ retries
- Final failure marks `CampaignSmsLog` as `FAILED`

**Unit tests:** `smsGateway.service.test.ts` (primary + fallback failure logging).

### 4. Failure handling

- Structured log: `[SmsGateway] send failed` JSON
- Ring buffer: `GET /api/v1/campaign/admin/sms/recent-failures`
- Campaign log `errorMessage` populated on final attempt

### 5. Queue recovery

Stuck `QUEUED` / `SENDING` logs older than `SMS_STUCK_RECOVERY_MINUTES` (default 15):

```http
POST /api/v1/campaign/admin/campaigns/:campaignId/sms/recover-stuck
Authorization: Bearer <admin>
```

### 6. Delivery reports

```http
POST /api/v1/campaign/public/sms/delivery-callback
x-campaign-sms-secret: <CAMPAIGN_SMS_WEBHOOK_SECRET>   # when set
Content-Type: application/json

{ "externalId": "<gateway message id>", "status": "DELIVERED" }
```

Updates `campaign_sms_logs.deliveredAt` and status `DELIVERED`.

### 7. SMS cost monitoring

Per message on send:

- `segmentCount` — `ceil(len / SMS_CHARS_PER_SEGMENT)`
- `estimatedCostBdt` — segments × `SMS_COST_PER_SEGMENT_BDT`

Summary:

```http
GET /api/v1/campaign/admin/campaigns/:campaignId/sms/cost-summary
```

---

## Automated tests

```bash
npm test -- \
  src/integrations/sms/smsGateway.service.test.ts \
  src/integrations/sms/sslWireless.provider.test.ts \
  src/integrations/sms/bulkSmsBd.provider.test.ts \
  src/integrations/sms/smsCost.test.ts \
  src/api/v1/services/notificationQueue.test.ts \
  src/api/v1/modules/campaign/otp.service.test.ts
```

---

## Pre-production checklist

- [ ] `REDIS_URL` set; Redis HA in production
- [ ] `npm run worker:notifications` running (systemd/k8s)
- [ ] `SSL_WIRELESS_*` and `BULKSMSBD_*` credentials verified in sandbox
- [ ] `SMS_ENABLED=true`, `SMS_ALLOW_MOCK` **not** set in production
- [ ] Delivery callback URL registered with providers
- [ ] `CAMPAIGN_SMS_WEBHOOK_SECRET` set
- [ ] `SMS_COST_PER_SEGMENT_BDT` matches commercial rate card
- [ ] Run `sms-production-check.ts` against a test handset
- [ ] Apply migration `20260603120000_campaign_sms_cost_monitoring`

---

## Files changed (this pass)

```
src/infrastructure/redis/redisConnection.ts
src/integrations/sms/smsCost.ts
src/api/v1/modules/campaign/smsCostMonitoring.service.ts
src/api/v1/modules/campaign/smsQueueRecovery.service.ts
src/api/v1/services/notificationQueue.ts
src/api/v1/modules/campaign/campaign.smsQueue.ts
src/api/v1/modules/campaign/otp.service.ts
src/api/v1/modules/campaign/sms.service.ts
src/api/v1/modules/campaign/sms.controller.ts
src/common/jobs/notificationWorker.ts
src/integrations/sms/smsGateway.service.ts
src/api/v1/modules/campaign/campaign.routes.ts
prisma/schema.prisma
prisma/migrations/20260603120000_campaign_sms_cost_monitoring/
scripts/sms-production-check.ts
.env.example
SMS-PRODUCTION-VALIDATION.md
```

---

## Known limitations

1. **Cost figures are estimates** — reconcile with SSL/BulkSMSBD billing exports monthly.
2. **Delivery callbacks** vary by provider payload shape — map `externalId` / `message_id` in gateway docs.
3. **Live E2E** requires real credentials; CI runs unit tests with mock provider only.
