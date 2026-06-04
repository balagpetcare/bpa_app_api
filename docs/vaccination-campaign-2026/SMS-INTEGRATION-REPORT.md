# SMS Integration Report — Backend API

**Project:** `D:\BPA_Data\backend-api`  
**Date:** June 2, 2026  
**Scope:** Production SMS provider integration reusing existing BullMQ `notif_sms` queue

---

## Executive Summary

The SMS system was audited and upgraded from a **log-only stub** to a **production-ready gateway layer** with SSL Wireless (primary) and BulkSMSBD (fallback). All outbound SMS continues through the existing `notif_sms` BullMQ queue and `notificationWorker` — no duplicate notification system was introduced.

---

## Audit Findings (Before)

| Area | Status |
|------|--------|
| BullMQ queue `notif_sms` | Existed; enqueue from platform + campaign bridge |
| `notificationWorker` SMS handler | **Stub** — `console.log` only |
| Campaign `CampaignSmsLog` | Created on send; **never updated by worker** |
| Campaign queue bridge | Used `notificationId: 0` → worker skipped platform delivery row (OK) but also never sent SMS |
| Providers SSL Wireless / BulkSMSBD | **Documented only** — no code |
| `src/api/v1/services/sms.service.ts` | **Missing** — referenced by broken fallbacks |
| `queueSmsDelivery` bug | Referenced undefined `input` variable — runtime error |
| Retry / failure logging | Queue had 3 attempts; no structured failure log |
| Delivery tracking | `handleDeliveryCallback` existed; **no HTTP route** |
| Tests | **None** for SMS |

---

## Architecture (After)

```
Campaign sms.service / otp.service
        ↓
campaign.smsQueue → enqueueSmsJob (notif_sms)
        ↓
notificationWorker.handleSmsJob
        ↓
smsGateway.service (primary → fallback)
   ├── sslWireless.provider
   ├── bulkSmsBd.provider
   └── mock.provider (dev/test)
        ↓
CampaignSmsLog / NotificationDelivery updates
```

**Platform notifications** (`notification.service.ts`) unchanged — still enqueue to `notif_sms`; worker now sends real SMS and updates `NotificationDelivery`.

---

## Providers Implemented

### SSL Wireless (primary)

- **File:** `src/integrations/sms/sslWireless.provider.ts`
- **Endpoint:** `POST {SSL_WIRELESS_BASE_URL}/api/v3/send-sms`
- **Default base URL:** `https://smsplus.sslwireless.com`
- **Payload:** `api_token`, `sid`, `msisdn`, `sms`, `csms_id`

### BulkSMSBD (fallback)

- **File:** `src/integrations/sms/bulkSmsBd.provider.ts`
- **REST v3 (default):** `POST {BULKSMSBD_BASE_URL}/api/v3/sms/send` with Bearer token
- **Legacy mode:** `GET BULKSMSBD_LEGACY_URL` with `api_key`, `senderid`, `number`, `message` (`BULKSMSBD_API_MODE=legacy`)

### Mock (dev/test)

- **File:** `src/integrations/sms/mock.provider.ts`
- Used when `NODE_ENV=test`, gateways unconfigured, or `SMS_ENABLED=false`

---

## Retry, Failure Logging, Delivery Tracking

| Feature | Implementation |
|---------|----------------|
| **Retry** | BullMQ `enqueueSmsJob`: 3 attempts (configurable `SMS_QUEUE_ATTEMPTS`), exponential backoff (`SMS_QUEUE_BACKOFF_MS`, default 5000ms) |
| **Failure logging** | `logSmsFailure()` in `smsGateway.service.ts` — structured JSON to console + in-memory ring buffer (`getRecentSmsFailures`) |
| **Campaign log updates** | Worker sets `SENDING` → `SENT` / `FAILED` on `CampaignSmsLog`; stores `externalId`, `errorMessage`, `sentAt` |
| **Platform delivery** | Updates `NotificationDelivery` status, `providerMessageId`, `attemptCount`, `error` |
| **Delivery webhook** | `POST /api/v1/campaign/public/sms/delivery-callback` → `handleDeliveryCallback()` marks `DELIVERED` / `FAILED` |

---

## Environment Variables

Added to `.env.example`:

| Variable | Purpose |
|----------|---------|
| `SMS_ENABLED` | Master switch (`false` uses mock) |
| `SMS_PRIMARY_PROVIDER` | `ssl_wireless` (default) |
| `SMS_FALLBACK_PROVIDER` | `bulksmsbd` (default) |
| `SMS_QUEUE_ATTEMPTS` | BullMQ retry count |
| `SMS_QUEUE_BACKOFF_MS` | Backoff base delay |
| `SMS_WORKER_CONCURRENCY` | SMS worker parallelism |
| `SSL_WIRELESS_*` | Token, sender ID, base URL |
| `BULKSMSBD_*` | Token/key, sender, base URL, API mode |
| `CAMPAIGN_SMS_SENDER_ID` | Shared sender fallback |

---

## Files Added

```
src/integrations/sms/types.ts
src/integrations/sms/phone.ts
src/integrations/sms/sslWireless.provider.ts
src/integrations/sms/bulkSmsBd.provider.ts
src/integrations/sms/mock.provider.ts
src/integrations/sms/smsGateway.service.ts
src/integrations/sms/*.test.ts
src/api/v1/services/sms.service.ts
src/api/v1/modules/campaign/sms.controller.ts
docs/vaccination-campaign-2026/SMS-INTEGRATION-REPORT.md
```

## Files Changed

- `src/common/jobs/notificationWorker.ts` — real SMS send + log/delivery updates
- `src/api/v1/services/notificationQueue.ts` — SMS retry/backoff tuning
- `src/api/v1/modules/campaign/campaign.smsQueue.ts` — static import, `useRawMessage`
- `src/api/v1/modules/campaign/sms.service.ts` — fixed `queueSmsDelivery` bug, direct send path
- `src/api/v1/modules/campaign/otp.service.ts` — direct send fallback via shared service
- `src/api/v1/modules/campaign/campaign.routes.ts` — delivery callback route
- `.env.example` — SMS configuration block

---

## Operations

### Start worker

```bash
REDIS_ENABLED=true npm run worker:notifications
```

### Configure production

1. Set `REDIS_ENABLED=true`
2. Set `SSL_WIRELESS_API_TOKEN`, `SSL_WIRELESS_SENDER_ID`
3. Set `BULKSMSBD_API_TOKEN`, `BULKSMSBD_SENDER_ID` (fallback)
4. Register webhook URL with providers:  
   `https://<api-host>/api/v1/campaign/public/sms/delivery-callback`

---

## Tests

```bash
npm test -- src/integrations/sms
```

Covers: phone formatting, gateway mock send, provider success/failure parsing, primary/fallback failure logging.

---

## Known Limitations

1. **Invite SMS** (`inviteNotifier.ts`) remains log-only — separate feature; can call `sendSmsViaGateway` later.
2. **Clinic reminder module** stub unchanged.
3. **Delivery webhook auth** — no HMAC yet; restrict by IP or add provider signature validation in production.
4. **Bulk admin broadcast** — not in scope; design doc tables only.

---

## Verification Checklist

- [x] Reuses `notif_sms` queue (no duplicate system)
- [x] SSL Wireless provider
- [x] BulkSMSBD provider + legacy mode
- [x] Retry via BullMQ
- [x] Failure logging
- [x] Delivery tracking + webhook route
- [x] Campaign `CampaignSmsLog` worker updates
- [x] Fixed `queueSmsDelivery` runtime bug
- [x] Unit tests passing
