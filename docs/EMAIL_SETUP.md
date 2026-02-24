# Email setup (BPA API)

Producer staff invites and other transactional emails use SMTP (nodemailer). Email sending is **optional**: if SMTP is not configured, the API still works and returns invite data; delivery is marked as `SKIPPED` with a clear message.

## Required environment variables

| Variable      | Description |
|---------------|-------------|
| `SMTP_HOST`   | SMTP server host (e.g. `smtp.gmail.com`) |
| `SMTP_PORT`   | Port (e.g. `587` for TLS, `465` for SSL) |
| `SMTP_SECURE` | Set to `true` for port 465 (SSL) |
| `SMTP_USER`   | SMTP username / email |
| `SMTP_PASS`   | SMTP password or app password |
| `SMTP_FROM`   | Sender address (e.g. `BPA <noreply@yourdomain.com>`) |

## Gmail (development)

1. Enable 2FA on your Google account.
2. Create an [App Password](https://myaccount.google.com/apppasswords) for "Mail".
3. Set in `.env`:
   - `SMTP_HOST=smtp.gmail.com`
   - `SMTP_PORT=587`
   - `SMTP_SECURE=false`
   - `SMTP_USER=your@gmail.com`
   - `SMTP_PASS=your-16-char-app-password`
   - `SMTP_FROM=BPA Dev <your@gmail.com>`

## Producer staff invite emails

- When `POST /api/v1/producer/staff/invite` is called with an `email`, a delivery record is created and a job is enqueued (if Redis is available).
- The **BullMQ** worker (`producer_staff_invite_email` queue) sends the email with retries (5 attempts, exponential backoff).
- If SMTP is not configured, the worker marks the delivery as **FAILED** with `lastError: "SMTP not configured"`.
- Logs: only non-sensitive data (e.g. `deliveryId`, `inviteId`, `to`, `status`). **Raw invite tokens are never logged.**

## Redis (queue)

- Set `REDIS_URL` (e.g. `redis://localhost:6379`) or `REDIS_HOST` + `REDIS_PORT` so the email queue and worker run.
- **Dedicated worker (recommended):** Run the email worker as a separate process so queued jobs are always processed. Use `npm run worker:email` or the Docker service `bpa_worker` (see below).

## Docker: dedicated email worker

The `bpa_worker` service in `docker-compose.yml` runs the BullMQ email worker in a separate container:

- Same image/build as `bpa_api`.
- Command: `npm run worker:email`.
- Env: `REDIS_HOST=bpa-redis`, `REDIS_PORT=6379` (and `.env.docker` for `DATABASE_URL`, etc.).
- Depends on `bpa_db` and `bpa-redis` (healthy).

**Verification:**

1. `docker compose up -d --build`
2. Create a new producer staff invite (with email) via API or producer panel.
3. Watch worker logs: `docker compose logs -f bpa_worker`  
   - You should see `Email worker started`, then e.g. `Email worker: job completed deliveryId=X inviteId=Y to=...` (or `job failed ... error=SMTP not configured` if SMTP is not set).
4. In the producer UI (Invitations tab), **Sent count** should increment and **Last sent** should show a timestamp when SMTP is configured; otherwise **Delivery status** shows FAILED and **Last error** "SMTP not configured".

## Production recommendations

- Prefer a transactional email provider:
  - **SendGrid** – SMTP or API
  - **Mailgun** – SMTP or API
  - **Amazon SES** – SMTP or SDK
- Use a dedicated domain and DKIM/SPF for better deliverability.
- Keep `SMTP_PASS` (and `REDIS_URL` if applicable) in secrets; never commit them.
