# BulkSMSBD SMS Integration

Central SMS gateway for the BPA/WPA ecosystem using [BulkSMSBD](http://bulksmsbd.net).

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────┐
│ API modules     │────▶│ shared/services/sms  │────▶│  smsQueue   │
│ (auth, campaign)│     │ sms.service.ts       │     │  (BullMQ)   │
└─────────────────┘     └──────────┬───────────┘     └──────┬──────┘
                                     │                        │
                                     ▼                        ▼
                          ┌──────────────────────┐   notificationWorker
                          │ integrations/sms     │   processSmsQueueJob
                          │ smsGateway.service   │
                          └──────────┬───────────┘
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │ BulkSMSBD legacy API │
                          │ /api/smsapi          │
                          └──────────────────────┘
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │ sms_logs (PostgreSQL)│
                          └──────────────────────┘
```

## Environment

Set in `.env` (never expose in frontend):

```env
SMS_PROVIDER=bulksmsbd
SMS_API_KEY=your_api_key
SMS_SENDER_ID=8809617634446
SMS_BASE_URL=http://bulksmsbd.net/api
SMS_ENABLED=true
REDIS_ENABLED=true
```

Legacy aliases (`BULKSMSBD_API_KEY`, `BULKSMSBD_SENDER_ID`) are also supported.

When `SMS_PROVIDER=bulksmsbd`, the legacy GET API is used:

`GET {SMS_BASE_URL}/smsapi?api_key=...&senderid=...&number=...&message=...&type=text`

Balance check:

`GET {SMS_BASE_URL}/getBalanceApi?api_key=...`

## API flow

1. Caller invokes `sendSMS({ phone, message })` from `src/shared/services/sms/sms.service.ts`.
2. A row is inserted into `sms_logs` with status `QUEUED`.
3. If Redis is available, a job is added to BullMQ queue `smsQueue`.
4. `notificationWorker` calls `processSmsQueueJob`, which uses `sendSmsViaGateway`.
5. On success, log status becomes `SENT` with provider message ID.

Direct send (no queue) happens when Redis is disabled or `direct: true` is passed.

## Templates

| Key | Use case |
|-----|----------|
| `OTP` | Your BPA OTP is {OTP} |
| `BOOKING_REQUEST` | After booking creation |
| `PAYMENT_SUCCESS` | After successful payment |
| `PAYMENT_FAILED` | After failed payment |
| `SLOT_CONFIRMED` | Venue/slot assignment |
| `REMINDER_24H` | 24h before appointment |
| `CERTIFICATE_READY` | Vaccination certificate |

Campaign module also maintains per-campaign overrides in `campaign_sms_templates`.

## Retry logic

- Queue jobs: **3 attempts**, exponential backoff (default 5s base delay).
- Admin can retry failed rows: `POST /api/v1/admin/sms/retry/:id`.
- Stuck campaign SMS: `POST /api/v1/admin/campaigns/:id/sms/recover-stuck`.

## Admin usage

**SMS Center** (global): `/admin/sms-center` in the web panel.

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/admin/sms/dashboard` | Stats + queue counts |
| `GET /api/v1/admin/sms/balance` | BulkSMSBD balance |
| `GET /api/v1/admin/sms/logs` | Unified `sms_logs` |
| `POST /api/v1/admin/sms/send` | Single SMS |
| `POST /api/v1/admin/sms/bulk` | Bulk SMS |
| `POST /api/v1/admin/sms/campaign` | Campaign announcement |
| `POST /api/v1/admin/sms/retry/:id` | Retry failed log |

Per-campaign SMS tools remain under `/api/v1/admin/campaigns/:id/sms/*`.

## Worker

```bash
npm run worker:notifications
```

Requires `REDIS_ENABLED=true` and Redis running. Processes `smsQueue` and legacy `notif_sms`.

## Security

- API key and sender ID exist **only** in server `.env`.
- All SMS requests originate from the backend.
- Admin routes require authentication + admin role.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| SMS not sending | `SMS_ENABLED`, `SMS_API_KEY`, `SMS_SENDER_ID` in `.env` |
| Jobs stuck in QUEUED | Redis running, worker started, `REDIS_ENABLED=true` |
| Balance API fails | `SMS_BASE_URL` and API key; provider account active |
| OTP not received | Rate limit (3/min), phone format (BD MSISDN), gateway balance |
| Failed logs | Admin SMS Center → retry; check `response` column in `sms_logs` |

Run production check:

```bash
npx ts-node scripts/sms-production-check.ts
```
