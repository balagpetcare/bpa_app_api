# BPA Backend — Local Development Setup

This guide restores a working local environment after a missing `.env` file.

## Prerequisites

- Node.js 20+ (project uses TypeScript / ts-node for dev)
- Docker Desktop (recommended for PostgreSQL, Redis, MinIO)
- Git clone of `backend-api`

## 1. Create environment file

```bash
cd backend-api
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bpa_onboarding?schema=public
SHADOW_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bpa_onboarding_shadow?schema=public
JWT_SECRET=your-local-dev-secret-min-32-chars
PORT=3000
REDIS_ENABLED=false
```

Validate:

```bash
npm run validate:env
```

## 2. PostgreSQL

### Option A — Docker Compose (recommended)

```bash
npm run dev:infra
```

This starts `bpa_db`, `bpa-redis`, and `bpa-storage` per `docker-compose.yml`.

### Option B — Local PostgreSQL

Create databases:

```sql
CREATE DATABASE bpa_onboarding;
CREATE DATABASE bpa_onboarding_shadow;
```

**DATABASE_URL format:**

```
postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
```

Example:

```
postgresql://postgres:postgres@localhost:5432/bpa_onboarding?schema=public
```

## 3. Prisma

Prisma 7 reads URLs from `prisma.config.ts` (not embedded in schema).

```bash
npm install
npm run setup:prisma          # validate + generate client
npm run prisma:migrate        # migrate deploy (safe for shared dev DB)
npm run seed                  # optional: seed data + super admin
npm run admin:bootstrap       # create super admin from SUPER_ADMIN_* vars
```

**Shadow database** is required only for `npm run prisma:migrate:dev` (creates migration files):

```bash
npm run validate:env -- --migrate-dev
npm run prisma:migrate:dev
```

**Policy:** Never run `migrate reset` or `db push` on production-like databases. See `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`.

## 4. Object storage (MinIO)

With Docker infra running:

```env
STORAGE_PROVIDER=minio
AWS_ENDPOINT=http://localhost:9000
AWS_BUCKET_NAME=bpa-pets
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_FORCE_PATH_STYLE=true
STORAGE_PUBLIC_URL=http://localhost:9000
MINIO_PUBLIC_URL=http://localhost:9000
```

Initialize bucket:

```bash
npm run storage:init
npm run storage:test
```

For LAN/mobile testing, set `STORAGE_PUBLIC_URL` / `MINIO_PUBLIC_URL` to your machine IP (e.g. `http://192.168.0.100:9000`).

## 5. Redis (optional locally)

Default local config disables Redis:

```env
REDIS_ENABLED=false
```

To enable queues (SMS worker, notifications):

```env
REDIS_ENABLED=true
REDIS_URL=redis://localhost:6379
```

Run worker in a second terminal:

```bash
npm run worker:notifications
```

## 6. Payment configuration

Payments are **optional for local API startup** (warnings only in development).

To test checkout, set:

```env
API_PUBLIC_BASE_URL=http://localhost:3000
PAYMENT_PROVIDER=eps
# ... provider credentials from sandbox dashboard
```

Verify EPS connectivity:

```bash
npm run test:eps-connection
```

**Callback URL pattern** (auto-built):

- Webhook: `{API_PUBLIC_BASE_URL}/api/v1/payments/webhook`
- EPS success: `{API_PUBLIC_BASE_URL}/api/v1/payments/payment/eps/callback/success`

For gateway testing with external callbacks, use ngrok or similar and set `API_PUBLIC_BASE_URL` to the public URL.

Supported gateways: **SSLCommerz**, **EPS**, **bKash**, **Nagad**, **AmarPay**. SurjoPay is not integrated.

## 7. SMS configuration

For local dev without a gateway:

```env
SMS_ENABLED=false
# or
SMS_ALLOW_DEV_FAKE_SENT=true
```

For real SMS (sandbox):

```env
SMS_ENABLED=true
SMS_PROVIDER=bulksmsbd
SMS_API_KEY=
SMS_SENDER_ID=
BULKSMSBD_API_KEY=
BULKSMSBD_SENDER_ID=
```

## 8. Email (optional)

SMTP is only needed for the email worker (`npm run worker:email`):

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=BPA <no-reply@yourdomain.com>
```

## 9. Start the API

```bash
npm run dev
```

Server listens on **port 3000** at `/api/v1`.

Full stack with Docker:

```bash
npm run dev:full
```

## 10. CORS & frontends

Allow local Next.js apps (ports 3100–3106):

```env
CORS_ORIGINS=http://localhost:3100,http://localhost:3101,http://localhost:3102,http://localhost:3103,http://localhost:3104,http://localhost:3105,http://localhost:3106
COOKIE_DOMAIN=localhost
```

Panel invite links:

```env
PANEL_PUBLIC_URL=http://localhost:3100
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `DATABASE_URL must be set` | Add `DATABASE_URL` to `.env`, restart |
| Prisma migrate fails | Check PostgreSQL running; verify URL; use `SHADOW_DATABASE_URL` for `migrate dev` |
| Storage bootstrap warning | Run `npm run storage:init`; check MinIO at `AWS_ENDPOINT` |
| Payment bootstrap warning | Expected in dev without credentials; set `VALIDATE_PAYMENT_CONFIG=true` to audit |
| Port in use | API must use **3000** — stop conflicting process |
| JWT errors on login | Set `JWT_SECRET` in `.env` |

## Related docs

- [ENVIRONMENT_VARIABLE_AUDIT.md](./ENVIRONMENT_VARIABLE_AUDIT.md) — full variable reference
- [ENV_RECOVERY_REPORT.md](./ENV_RECOVERY_REPORT.md) — audit summary & readiness
- [../integrations/storage-providers.md](../integrations/storage-providers.md) — MinIO vs B2
