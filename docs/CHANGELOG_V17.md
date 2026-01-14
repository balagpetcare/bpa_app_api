# API v17 Security & Correctness Patch

## Money safety
- Withdraw create now locks the wallet row (`SELECT ... FOR UPDATE`) and re-checks `availableBalance` inside the DB transaction to prevent race-condition double-spend.
- Fundraising withdraw reservation now locks the wallet row similarly.

## Webhook security
- Added raw-body capture (`req.rawBody`) so payout provider webhook signatures can be verified reliably.
- Webhook routes are rate-limited.

## API hardening
- Added `helmet` security headers.
- Added CORS allowlist via `CORS_ORIGINS` (comma-separated). If empty, all origins allowed (dev-friendly default).
- Added rate limiting:
  - General: 300 requests / 15 min (configurable via env)
  - Auth: 20 requests / 15 min
  - Withdraw: 10 requests / 60 sec
  - Webhooks: 120 requests / 60 sec

## New environment variables (optional)
- `CORS_ORIGINS` (e.g. `https://app.example.com,https://admin.example.com`)
- `RL_GENERAL_WINDOW_MS`, `RL_GENERAL_MAX`
- `RL_AUTH_WINDOW_MS`, `RL_AUTH_MAX`
- `RL_WITHDRAW_WINDOW_MS`, `RL_WITHDRAW_MAX`
- `RL_WEBHOOK_WINDOW_MS`, `RL_WEBHOOK_MAX`