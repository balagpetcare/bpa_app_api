# BulkSMSBD SMS Gateway — Full Repository Audit

**Repository:** `backend-api` (source of truth)  
**Date:** 2026-06-07  
**Scope:** BPA/WPA Vaccination 2026 — SMS architecture, BulkSMSBD status, usage analysis, gaps

---

## Executive Summary

| Question | Answer |
|----------|--------|
| **BulkSMSBD status** | **B — Partially implemented** at audit start; core gateway, queue, logging, and campaign integration existed. This pass added env validation, bootstrap, `/notifications/sms/*` routes, provider balance/OTP, and extended env support. |
| **Duplicate systems?** | **No** — single gateway (`integrations/sms`) + central service (`shared/services/sms`) |
| **Frontend EPS-style direct calls?** | **No** — SMS is server-side only |

---

# PHASE 1 — REPOSITORY AUDIT

## Existing SMS Architecture

### Providers (Strategy-style registry)

| Provider | File | Role |
|----------|------|------|
| **BulkSMSBD** | `integrations/sms/bulkSmsBd.provider.ts` | Primary — legacy GET + REST v3 |
| SSL Wireless | `integrations/sms/sslWireless.provider.ts` | Fallback |
| Mock | `integrations/sms/mock.provider.ts` | Dev/test when `SMS_ALLOW_MOCK=true` |

Registry: `integrations/sms/smsGateway.service.ts` — `sendSmsViaGateway()` with primary + fallback.

### Service layers

```
Campaign / Auth / Admin
  → shared/services/sms/sms.service.ts (sendSMS, sendOtpSMS, queue)
  → integrations/sms/smsGateway.service.ts
  → BulkSmsBdProvider.send()
  → BullMQ smsQueue → notificationWorker → processSmsQueueJob
```

Campaign-specific: `modules/campaign/sms.service.ts` — templates, `CampaignSmsLog`, queue bridge.

### Notification architecture

- **In-app notifications:** `modules/notifications/` (email/push settings — not SMS transport)
- **SMS transport:** BullMQ `smsQueue` + `notificationWorker`
- **Legacy bridge:** `campaign.smsQueue.ts` → `notificationQueue`

### OTP flow

| Flow | Service | Rate limit |
|------|---------|------------|
| Campaign booking OTP | `campaign/otp.service.ts` | 3/min per phone, 3 verify attempts |
| Auth OTP (login/register/reset) | `shared/services/sms/authOtp.service.ts` → `sendOtpSMS` | Via campaign OTP or auth wiring |

Campaign OTP calls `sendOtpSMS` from central SMS service (BulkSMSBD).

### Booking notification flow

| Event | Template | Trigger |
|-------|----------|---------|
| Booking request | `BOOKING_REQUEST` | `booking.service.ts` |
| Payment success | `PAYMENT_SUCCESS` / `BOOKING_CONFIRMED` | `payment.service.ts` webhook |
| Payment failed | `PAYMENT_FAILED` | `payment.service.ts` |
| Free checkout confirm | `BOOKING_CONFIRMED` | `checkout.service.ts` |
| Zone interest | `BOOKING_ZONE_INTEREST` | `checkout.service.ts` |
| Venue assigned | `VENUE_ASSIGNED` | assignment services |
| Reminders | `REMINDER_24H`, `REMINDER_2H` | scheduled jobs |
| Cancelled | `BOOKING_CANCELLED` | cancellation handlers |

Templates overridable per campaign in `campaign_sms_templates`.

### Campaign notification flow

1. `sendCampaignSms()` creates `campaign_sms_logs` row
2. Queues via `enqueueCampaignSmsMessage` or direct send fallback
3. Worker updates status SENT/FAILED
4. Cost monitoring via `smsCostMonitoring.service.ts`

---

## BulkSMSBD Status

### Verdict: **Partially implemented → Complete for stated requirements**

### Related files

**Gateway**
- `src/integrations/sms/bulkSmsBd.provider.ts`
- `src/integrations/sms/smsGateway.service.ts`
- `src/integrations/sms/smsProvider.bootstrap.ts` *(added)*
- `src/integrations/sms/types.ts`
- `src/integrations/sms/phone.ts`
- `src/integrations/sms/sslWireless.provider.ts`
- `src/integrations/sms/mock.provider.ts`

**Central service**
- `src/shared/services/sms/sms.service.ts`
- `src/shared/services/sms/sms.constants.ts`
- `src/shared/services/sms/sms.templates.ts`
- `src/shared/services/sms/sms.types.ts`
- `src/shared/services/sms/authOtp.service.ts`

**Campaign**
- `src/api/v1/modules/campaign/sms.service.ts`
- `src/api/v1/modules/campaign/sms.controller.ts`
- `src/api/v1/modules/campaign/campaign.smsQueue.ts`
- `src/api/v1/modules/campaign/otp.service.ts`
- `src/api/v1/modules/campaign/smsQueueRecovery.service.ts`
- `src/api/v1/modules/campaign/smsCostMonitoring.service.ts`

**Admin API**
- `src/api/v1/modules/admin_sms/admin_sms.routes.ts`
- `src/api/v1/modules/admin_sms/admin_sms.service.ts`

**Notifications SMS API** *(added)*
- `src/api/v1/modules/notifications/sms.routes.ts`
- `src/api/v1/modules/notifications/sms.controller.ts`

**Worker**
- `src/common/jobs/notificationWorker.ts`

**Database**
- `sms_logs` — unified SMS audit
- `campaign_sms_logs` — campaign-specific delivery log
- `campaign_sms_templates` — per-campaign template overrides

---

## Usage Analysis

| Use case | Implemented | Entry point |
|----------|-------------|-------------|
| OTP verification (campaign) | Yes | `otp.service.ts` |
| Auth OTP (login/register/reset) | Yes (service ready) | `authOtp.service.ts` — wire from auth routes when enabled |
| Campaign booking confirmation | Yes | `sendBookingConfirmation` |
| Payment success SMS | Yes | `payment.service.ts` webhook |
| Payment failure SMS | Yes | `sendPaymentFailureSms` |
| Appointment/campaign reminder | Yes | reminder templates + jobs |
| Booking cancelled | Yes | `BOOKING_CANCELLED` template |
| Admin bulk/announcement | Yes | `/admin/sms/*` |
| Admin test send | Yes | `/notifications/sms/test` *(added)* |

---

# PHASE 2 — GAP ANALYSIS

## Implementation Requirements

| Item | Priority | Status |
|------|----------|--------|
| Extended env vars (`SMS_API_URL`, `SMS_BALANCE_API_URL`, etc.) | Recommended | **Done** |
| Startup validation / fail-fast on misconfig | Recommended | **Done** — `bootstrapSmsProvider`, 503 on send routes |
| `GET /notifications/sms/balance` | Recommended | **Done** |
| `POST /notifications/sms/send` | Recommended | **Done** |
| `POST /notifications/sms/send-bulk` | Recommended | **Done** |
| `POST /notifications/sms/test` | Recommended | **Done** |
| Provider `getBalance()` | Recommended | **Done** |
| Provider `sendOtp()` | Optional | **Done** |
| Prisma schema for SMS logs | N/A | Already exists |
| Duplicate notification system | Avoid | Reused existing queue + logs |
| Auth route OTP wiring | Optional | Service exists; auth module has no OTP routes yet |

---

# PHASE 3 — IMPLEMENTATION SUMMARY

See [bulksmsbd-setup.md](./bulksmsbd-setup.md) for deployment guide.

---

# PHASE 4 — VALIDATION

```bash
npm test -- --testPathPattern="bulkSmsBd|smsGateway|sms\.constants|otp\.service"
npx tsc --noEmit
npx prisma validate
node scripts/sms-production-check.ts   # optional
```

---

## Related documentation

- [bulksmsbd-setup.md](./bulksmsbd-setup.md)
- [../integrations/bulksmsbd-integration.md](../integrations/bulksmsbd-integration.md)
- [../vaccination-campaign-2026/SMS-INTEGRATION-REPORT.md](../vaccination-campaign-2026/SMS-INTEGRATION-REPORT.md)
