# BPA Production Deployment Plan

**Date:** 2026-06-05  
**Scope:** Complete step-by-step production server deployment for the BPA ecosystem  
**Type:** Planning document only — execute with a change ticket and rollback plan  
**Target domain:** `bangladeshpetassociation.com`

---

## Overview

This plan deploys the **Phase 1 production stack** (campaign go-live):

| Host | Repository | Port | Process name |
|---|---|---|---|
| `api.bangladeshpetassociation.com` | `bpa_app_api` | 3000 | `bpa-api`, `bpa-worker` |
| `bangladeshpetassociation.com` | `bpa_land` | 3101 | `bpa-landing` |
| `vaccination.bangladeshpetassociation.com` | `vaccination_2026` | 3110 | `bpa-vaccination` |

**Phase 2** (post-campaign): `next_v1` admin/staff panels, `bpa_app` mobile store release.

**Architecture:**

```text
Internet → Cloudflare (DNS, WAF, SSL) → Origin VPS (nginx :443)
                                              ├── :3101 bpa-landing
                                              ├── :3110 vaccination_2026
                                              └── :3000 backend-api (+ worker)
                                                    ├── PostgreSQL :5432
                                                    ├── Redis :6379
                                                    └── B2 / MinIO (object storage)
```

---

## Prerequisites

### Server Requirements

| Resource | Minimum | Recommended |
|---|---|---|
| VPS | 4 vCPU, 8 GB RAM, 80 GB SSD | 8 vCPU, 16 GB RAM, 160 GB SSD |
| OS | Ubuntu 22.04 LTS or Debian 12 | Ubuntu 24.04 LTS |
| Node.js | 20.x LTS | 20.x LTS (via nvm or nodesource) |
| PostgreSQL | 16 | Managed (RDS, Supabase, or self-hosted) |
| Redis | 7 | Managed or self-hosted with AOF |
| nginx | 1.24+ | With optional Brotli module |

### Access Requirements

- [ ] SSH access to origin server
- [ ] Cloudflare account with zone `bangladeshpetassociation.com`
- [ ] GitHub deploy access to all four repositories
- [ ] Secrets vault (or secure `.env` delivery method)
- [ ] Payment gateway credentials (sandbox first, then production)
- [ ] SMS provider credentials (SSL Wireless / BulkSMSBD)
- [ ] Object storage credentials (Backblaze B2 recommended for prod)

### Pre-Deploy Blockers (Must Resolve First)

| # | Blocker | Owner | Status |
|---|---|---|---|
| 1 | Push `bpa-landing` application code to `bpa_land` GitHub | Dev team | **Required** |
| 2 | Production secrets prepared in vault | Ops | Required |
| 3 | PostgreSQL provisioned with connection string | Ops | Required |
| 4 | Redis provisioned | Ops | Required |
| 5 | Staging environment validated end-to-end | QA | Recommended |

---

## Phase 0: Pre-Flight (T-7 Days)

### 0.1 Repository Verification

On your workstation, verify all repos are clean and on `main`:

```bash
# bpa_app_api
cd /opt/bpa/backend-api  # or clone fresh
git clone https://github.com/balagpetcare/bpa_app_api.git backend-api
cd backend-api && git checkout main && git pull origin main
git log -1 --oneline   # expect: 5cad431 or later

# vaccination_2026
git clone https://github.com/balagpetcare/vaccination_2026.git
cd vaccination_2026 && git checkout main && git pull origin main
git log -1 --oneline   # expect: a3a22fe or later

# bpa_land (verify application code exists after push)
git clone https://github.com/balagpetcare/bpa_land.git bpa-landing
cd bpa-landing && git checkout main && git pull origin main
ls package.json src/   # must exist — not just README

# next_v1 (Phase 2 — clone now for admin access)
git clone https://github.com/balagpetcare/next_v1.git bpa_web
```

### 0.2 Staging Environment

Deploy to staging hosts first:

| Production | Staging |
|---|---|
| `api.bangladeshpetassociation.com` | `api-staging.bangladeshpetassociation.com` |
| `bangladeshpetassociation.com` | `staging.bangladeshpetassociation.com` |
| `vaccination.bangladeshpetassociation.com` | `vaccination-staging.bangladeshpetassociation.com` |

Run full booking funnel on staging before production cutover.

### 0.3 Rollback Preparation

```bash
# Tag current production state before deploy
cd backend-api && git tag release-$(date +%Y%m%d)-pre-deploy && git push origin release-$(date +%Y%m%d)-pre-deploy
cd ../vaccination_2026 && git tag release-$(date +%Y%m%d)-pre-deploy && git push origin release-$(date +%Y%m%d)-pre-deploy
cd ../bpa-landing && git tag release-$(date +%Y%m%d)-pre-deploy && git push origin release-$(date +%Y%m%d)-pre-deploy
```

Record rollback tags in deploy ticket.

### 0.4 Database Pre-Deploy

```bash
cd backend-api
node scripts/check-migration-integrity.js   # must exit 0
```

Take a **mandatory pre-deploy snapshot**:

```bash
# Managed Postgres: create snapshot via provider console
# Self-hosted:
pg_dump -Fc -h <DB_HOST> -U <DB_USER> -d bpa_production -f backup-pre-deploy-$(date +%Y%m%d).dump
```

Record snapshot ID in deploy ticket.

### 0.5 On-Call & Communication

- [ ] Assign on-call engineer
- [ ] Prepare `#bpa-incidents` channel
- [ ] Schedule maintenance window (if migration locks expected)
- [ ] Notify campaign operations team

---

## Phase 1: Server Provisioning (T-1 Day)

### 1.1 Initial Server Setup

```bash
# SSH to origin server
ssh deploy@<ORIGIN_IP>

# System updates
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y curl git nginx certbot python3-certbot-nginx \
  build-essential postgresql-client redis-tools

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Create deploy user directories
sudo mkdir -p /opt/bpa/{backend-api,bpa-landing,vaccination_2026,bpa_web}
sudo chown -R deploy:deploy /opt/bpa
```

### 1.2 DNS Configuration (Cloudflare)

In Cloudflare Dashboard → `bangladeshpetassociation.com`:

| Type | Name | Content | Proxy |
|---|---|---|---|
| `A` | `@` | `<ORIGIN_IP>` | Proxied (orange) |
| `A` | `www` | `<ORIGIN_IP>` | Proxied |
| `A` | `vaccination` | `<ORIGIN_IP>` | Proxied |
| `A` | `api` | `<ORIGIN_IP>` | Proxied |

**Cloudflare SSL/TLS settings:**

| Setting | Value |
|---|---|
| Encryption mode | **Full (strict)** |
| Always Use HTTPS | On |
| Minimum TLS | 1.2 |
| TLS 1.3 | On |
| HSTS | Enable after smoke test |

### 1.3 Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Only ports 22, 80, 443 should be public. Application ports (3000, 3101, 3110) bind to `127.0.0.1` only.

---

## Phase 2: Data Layer (T-0, Start of Deploy Window)

### 2.1 PostgreSQL

If using managed Postgres, verify connection from origin:

```bash
psql "$DATABASE_URL" -c "SELECT 1;"
```

If self-hosting:

```bash
sudo apt install -y postgresql-16
# Create database and user per your security policy
# Store DATABASE_URL in vault — never in git
```

### 2.2 Redis

```bash
redis-cli -u "$REDIS_URL" ping   # expect: PONG
```

### 2.3 Run Database Migrations

```bash
cd /opt/bpa/backend-api
git checkout main && git pull origin main

# Install dependencies
npm ci

# Integrity check (mandatory)
node scripts/check-migration-integrity.js

# Deploy migrations
npm run prisma:migrate:deploy

# Post-migrate integrity check
node scripts/check-migration-integrity.js

# Verify campaign tables exist
npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM campaign_configs;"
```

**If migration fails:** STOP. Do not retry blindly. Restore from pre-deploy snapshot.

### 2.4 Seed Production Data (If First Deploy)

```bash
# Bootstrap super admin (interactive)
npm run bootstrap:super-admin

# Seed roles/permissions (if needed)
npm run seed
```

---

## Phase 3: Application Deployment (Ordered)

Deploy in this exact order. Each step includes verification before proceeding.

### 3.1 backend-api (Port 3000)

#### Clone and Build

```bash
cd /opt/bpa/backend-api
git checkout main && git pull origin main

# Install production dependencies
npm ci --omit=dev

# Generate Prisma client and build
npm run build
```

#### Environment File

Create `/opt/bpa/backend-api/.env` (from vault — never commit):

```bash
# /opt/bpa/backend-api/.env — PRODUCTION (example structure, use vault values)

PORT=3000
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:pass@host:5432/bpa_production

# Redis
REDIS_ENABLED=true
REDIS_URL=redis://user:pass@host:6379

# Auth
JWT_SECRET=<vault-secret-min-32-chars>
JWT_EXPIRES_IN=7d
COOKIE_DOMAIN=.bangladeshpetassociation.com

# URLs
API_PUBLIC_BASE_URL=https://api.bangladeshpetassociation.com
APP_URL=https://api.bangladeshpetassociation.com
CORS_ORIGINS=https://bangladeshpetassociation.com,https://vaccination.bangladeshpetassociation.com,https://admin.bangladeshpetassociation.com

# Storage (B2 recommended for production)
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.<region>.backblazeb2.com
S3_REGION=<region>
S3_BUCKET=bpa-production
S3_ACCESS_KEY=<vault>
S3_SECRET_KEY=<vault>
STORAGE_PUBLIC_URL=https://<cdn-or-bucket-url>

# SMS
SMS_ENABLED=true
SMS_PROVIDER=<ssl-wireless-or-bulksmsbd>
# ... SMS credentials from vault

# Payment (configure per active gateway)
PAYMENT_PROVIDER=<amarpay|bkash|sslcommerz>
# ... payment credentials from vault

# Campaign
CAMPAIGN_LANDING_URL=https://vaccination.bangladeshpetassociation.com
CAMPAIGN_SIMPLIFIED_BOOKING=true
```

Secure the file:

```bash
chmod 600 /opt/bpa/backend-api/.env
```

#### PM2 Configuration

Create `/opt/bpa/ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [
    {
      name: 'bpa-api',
      cwd: '/opt/bpa/backend-api',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '1G',
      error_file: '/var/log/bpa/api-error.log',
      out_file: '/var/log/bpa/api-out.log',
      merge_logs: true,
      restart_delay: 5000,
      max_restarts: 10,
    },
    {
      name: 'bpa-worker',
      cwd: '/opt/bpa/backend-api',
      script: 'npm',
      args: 'run worker:notifications',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      error_file: '/var/log/bpa/worker-error.log',
      out_file: '/var/log/bpa/worker-out.log',
      merge_logs: true,
      restart_delay: 10000,
      max_restarts: 10,
    },
  ],
};
```

```bash
sudo mkdir -p /var/log/bpa
sudo chown deploy:deploy /var/log/bpa

# Start processes
pm2 start /opt/bpa/ecosystem.config.cjs
pm2 save
pm2 startup   # follow printed instructions for systemd integration
```

#### Verify API

```bash
curl -fsS http://127.0.0.1:3000/health
# Expected: {"ok":true,"service":"bpa_api"}

curl -fsS http://127.0.0.1:3000/health/redis
# Expected: 200

curl -fsS http://127.0.0.1:3000/api/v1/campaign/public/campaigns
# Expected: 200 with campaign list (may be empty until campaign activated)
```

**Gate:** API health must return 200 before proceeding.

---

### 3.2 vaccination_2026 (Port 3110)

#### Clone and Build

```bash
cd /opt/bpa/vaccination_2026
git checkout main && git pull origin main
npm ci
npm run build
```

#### Environment File

Create `/opt/bpa/vaccination_2026/.env.production.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.bangladeshpetassociation.com
API_BASE_URL=https://api.bangladeshpetassociation.com
NEXT_PUBLIC_SITE_URL=https://vaccination.bangladeshpetassociation.com
NEXT_PUBLIC_CAMPAIGN_SLUG=cat-flu-rabies-2026
NEXT_PUBLIC_BRIDGE_CAMPAIGN_URL=https://bangladeshpetassociation.com/vaccination

# Analytics (set when ready)
# NEXT_PUBLIC_ANALYTICS_GA4_ID=G-XXXXXXXX
# NEXT_PUBLIC_ANALYTICS_META_PIXEL_ID=XXXXXXXX
```

#### PM2 Start

```bash
pm2 start npm --name bpa-vaccination --cwd /opt/bpa/vaccination_2026 -- start
pm2 save
```

#### Verify

```bash
curl -fsS http://127.0.0.1:3110/ | head -c 200
curl -fsS http://127.0.0.1:3110/book | head -c 200
# Expected: HTML responses with 200
```

**Gate:** Landing and booking pages must return 200.

---

### 3.3 bpa_land (Port 3101)

#### Clone and Build

```bash
cd /opt/bpa/bpa-landing
git checkout main && git pull origin main

# Verify application code exists
test -f package.json && test -d src/ || { echo "BLOCKER: bpa_land remote has no app code"; exit 1; }

npm ci
npm run build
```

#### Environment File

Create `/opt/bpa/bpa-landing/.env.production.local`:

```bash
NEXT_PUBLIC_SITE_URL=https://bangladeshpetassociation.com
NEXT_PUBLIC_SITE_NAME=Bangladesh Pet Association
NEXT_PUBLIC_API_URL=https://api.bangladeshpetassociation.com/api/v1
NEXT_PUBLIC_CAMPAIGN_SITE_URL=https://vaccination.bangladeshpetassociation.com
NEXT_PUBLIC_CAMPAIGN_BOOK_URL=https://vaccination.bangladeshpetassociation.com/book

# Analytics (set when ready)
# NEXT_PUBLIC_ANALYTICS_GA4_ID=G-XXXXXXXX
```

#### PM2 Start

```bash
pm2 start npm --name bpa-landing --cwd /opt/bpa/bpa-landing -- start
pm2 save
```

#### Verify

```bash
curl -fsS http://127.0.0.1:3101/ | head -c 200
curl -fsS http://127.0.0.1:3101/vaccination | head -c 200
# Expected: HTML with 200
```

**Gate:** Homepage and vaccination bridge must return 200.

---

### 3.4 Campaign Activation (Admin)

Using `next_v1` admin panel (Phase 2) or direct API:

1. Log in as super admin
2. Navigate to Campaign Management
3. Set campaign status to **ACTIVE**
4. Configure slots, pricing, and locations
5. Verify public campaign list:

```bash
curl -fsS https://api.bangladeshpetassociation.com/api/v1/campaign/public/campaigns | jq .
```

**Gate:** Active campaign must appear in public API response.

---

## Phase 4: nginx & SSL (Edge Configuration)

### 4.1 Deploy nginx Configs

```bash
cd /opt/bpa/backend-api

# Copy shared infrastructure
sudo cp infra/nginx/conf.d/*.conf /etc/nginx/conf.d/
sudo cp infra/nginx/snippets/*.conf /etc/nginx/snippets/
sudo cp infra/nginx/sites-available/*.conf /etc/nginx/sites-available/

# Enable API site (create from deployment guide §3.5 if not in VCS)
sudo ln -sf /etc/nginx/sites-available/00-acme-and-redirect.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/bangladeshpetassociation.com.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/vaccination.bangladeshpetassociation.com.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/api.bangladeshpetassociation.com.conf /etc/nginx/sites-enabled/
```

### 4.2 Uncomment API Upstream

Edit `/etc/nginx/conf.d/00-upstreams.conf`:

```nginx
upstream bpa_api {
    server 127.0.0.1:3000 max_fails=3 fail_timeout=30s;
    keepalive 64;
}
```

### 4.3 Cloudflare Real IP

Create `/etc/nginx/conf.d/05-cloudflare-real-ip.conf` per `PRODUCTION_DEPLOYMENT_GUIDE.md` §3.2.

### 4.4 TLS Certificate

```bash
sudo certbot certonly --nginx \
  -d bangladeshpetassociation.com \
  -d www.bangladeshpetassociation.com \
  -d vaccination.bangladeshpetassociation.com \
  -d api.bangladeshpetassociation.com \
  --email admin@bangladeshpetassociation.com \
  --agree-tos \
  --no-eff-email

sudo systemctl enable certbot.timer
sudo certbot renew --dry-run
```

### 4.5 Validate and Reload

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Phase 5: DNS Cutover & Edge Activation

### 5.1 Enable Cloudflare Proxy

Ensure all A records are **Proxied** (orange cloud).

### 5.2 Purge Cache

In Cloudflare Dashboard → Caching → Purge Everything (or selective static purge).

### 5.3 Enable HSTS

After smoke tests pass:

- Cloudflare: SSL/TLS → Edge Certificates → Enable HSTS
- Verify nginx `Strict-Transport-Security` header is present

### 5.4 Configure WAF Rules

Per `PRODUCTION_DEPLOYMENT_GUIDE.md` §2.2:

- Block `/.env`, `/wp-admin`, `/phpmyadmin`
- Rate limit `/api/v1/campaign/auth/*` — 10 req/min/IP
- Rate limit `/api/v1/campaign/booking/*` — 30 req/min/IP

---

## Phase 6: Post-Deploy Smoke Tests (T+30 min)

Run all checks. **Any failure triggers rollback evaluation.**

### 6.1 Health Checks

```bash
# API
curl -fsS https://api.bangladeshpetassociation.com/health
curl -fsS https://api.bangladeshpetassociation.com/health/redis

# Landing
curl -fsS https://bangladeshpetassociation.com/ | head -c 200
curl -fsS https://bangladeshpetassociation.com/vaccination | head -c 200

# Vaccination
curl -fsS https://vaccination.bangladeshpetassociation.com/ | head -c 200
curl -fsS https://vaccination.bangladeshpetassociation.com/book | head -c 200

# Campaign API
curl -fsS https://api.bangladeshpetassociation.com/api/v1/campaign/public/campaigns
```

### 6.2 End-to-End Funnel

| Step | Action | Expected |
|---|---|---|
| 1 | Visit `bangladeshpetassociation.com` | Homepage loads, HTTPS |
| 2 | Click "Book Vaccination" or visit `/vaccination` | Bridge page or redirect to subdomain |
| 3 | Arrive at `vaccination.bangladeshpetassociation.com/book` | Booking wizard loads |
| 4 | Select location and slot | Slots appear from API |
| 5 | Enter phone, request OTP | SMS sent (or sandbox mock) |
| 6 | Complete booking | Confirmation page with reference |
| 7 | Payment flow (if enabled) | Redirect to gateway and return URL works |

### 6.3 Security Verification

```bash
# Security headers
curl -sI https://bangladeshpetassociation.com/ | grep -i strict-transport
curl -sI https://api.bangladeshpetassociation.com/health | grep -i x-content-type

# CORS (from vaccination origin)
curl -sI -H "Origin: https://vaccination.bangladeshpetassociation.com" \
  https://api.bangladeshpetassociation.com/api/v1/campaign/public/campaigns | grep -i access-control

# No secrets exposed
curl -fsS https://api.bangladeshpetassociation.com/.env   # expect 404
```

### 6.4 Performance

- Run Lighthouse on `https://bangladeshpetassociation.com/` (target: LCP < 2.5s)
- Run Lighthouse on `https://vaccination.bangladeshpetassociation.com/book`
- Verify `/_next/static/` assets return `Cache-Control: immutable`

### 6.5 Process Health

```bash
pm2 list
# All processes: online, 0 restarts

pm2 logs --lines 50
# No unhandled exceptions in last 50 lines
```

---

## Phase 7: Sign-Off

- [ ] All smoke tests passed
- [ ] Deploy ticket closed with: git SHA per repo, DB snapshot ID, cert expiry date
- [ ] Rollback tags recorded
- [ ] On-call briefed on runbook location
- [ ] Post-deploy review scheduled (24 hours)
- [ ] Campaign operations notified: **LIVE**

---

## Rollback Procedure

Use if smoke tests fail, SEV-1/2 incident, or error rate > 0.5%.

### Decision Matrix

| Symptom | Action | Scope |
|---|---|---|
| Bad frontend build | Redeploy previous tag | landing and/or vaccination |
| API 5xx after deploy | Rollback API | backend-api + worker |
| Migration failure | **Stop** — restore DB snapshot | Database |
| Payment broken | Pause campaign in admin | Campaign config |
| nginx misconfig | Revert nginx files | Edge only |

### Rollback Commands

```bash
# Frontend rollback
cd /opt/bpa/bpa-landing && git checkout release-YYYYMMDD-pre-deploy && npm ci && npm run build && pm2 restart bpa-landing
cd /opt/bpa/vaccination_2026 && git checkout release-YYYYMMDD-pre-deploy && npm ci && npm run build && pm2 restart bpa-vaccination

# API rollback
cd /opt/bpa/backend-api && git checkout release-YYYYMMDD-pre-deploy && npm ci && npm run build && pm2 restart bpa-api bpa-worker

# Database rollback (last resort)
# 1. Stop API + worker: pm2 stop bpa-api bpa-worker
# 2. Restore pre-deploy snapshot
# 3. Update DATABASE_URL if endpoint changed
# 4. Restart: pm2 start bpa-api bpa-worker
# NEVER: prisma migrate reset
```

---

## Phase 2 Deployment: Admin Panel (next_v1)

Deploy after Phase 1 is stable. Required for ongoing campaign management.

### Additional Host

| Host | Port | Process |
|---|---|---|
| `admin.bangladeshpetassociation.com` | 3103 | `bpa-web-admin` |

### Steps

```bash
cd /opt/bpa/bpa_web
git checkout main && git pull origin main
npm ci && npm run build

# .env.production.local
NEXT_PUBLIC_API_BASE_URL=https://api.bangladeshpetassociation.com
NEXT_PUBLIC_AUTH_BASE_URL=https://api.bangladeshpetassociation.com
AUTH_COOKIE_NAME=bpa_admin

pm2 start npm --name bpa-web-admin --cwd /opt/bpa/bpa_web -- run start
# Note: default start is :3100; for admin-only, consider SITE_MODE=admin next start -p 3103
```

Add nginx vhost for `admin.bangladeshpetassociation.com` → `127.0.0.1:3103`.

Update `CORS_ORIGINS` on API to include `https://admin.bangladeshpetassociation.com`.

---

## Phase 3 Deployment: Mobile App (bpa_app)

**Not a server deployment.** Separate track for App Store / Play Store.

### Prerequisites (from mobile audit)

1. Final bundle IDs (not `com.example.*`)
2. `flutterfire configure` with production Firebase project
3. Fill `env/prod.json` with `https://api.bangladeshpetassociation.com`
4. Android release keystore + Play App Signing
5. iOS provisioning profile + `DEVELOPMENT_TEAM`
6. Disable cleartext HTTP in release builds
7. Host `assetlinks.json` and AASA on production domains
8. Store metadata and privacy policy

### Build Commands (when ready)

```bash
cd bpa_app
flutter build appbundle --release --dart-define-from-file=env/prod.json   # Android
flutter build ipa --release --dart-define-from-file=env/prod.json         # iOS
```

---

## Ongoing Operations

### Daily Checks

```bash
pm2 list                                    # all online
curl -fsS https://api.bangladeshpetassociation.com/health
df -h                                       # disk space
```

### Weekly Checks

- [ ] Review PM2 logs for errors
- [ ] Verify DB backup age < 24h
- [ ] `certbot renew --dry-run`
- [ ] Check Cloudflare analytics for anomalies

### Monthly Checks

- [ ] DB restore drill to isolated instance
- [ ] `node scripts/check-migration-integrity.js` on staging
- [ ] Cloudflare DNS export archive
- [ ] Review and rotate secrets per policy
- [ ] Lighthouse audit on production URLs

### Deploy Update Procedure (Subsequent Releases)

```bash
# 1. Tag pre-deploy
git tag release-$(date +%Y%m%d)-pre-deploy && git push origin release-$(date +%Y%m%d)-pre-deploy

# 2. DB snapshot (if migrations included)
pg_dump ... && node scripts/check-migration-integrity.js

# 3. Pull, build, restart (per app)
cd /opt/bpa/backend-api && git pull origin main && npm ci && npm run build
npm run prisma:migrate:deploy   # only if new migrations
pm2 restart bpa-api bpa-worker

cd /opt/bpa/vaccination_2026 && git pull origin main && npm ci && npm run build && pm2 restart bpa-vaccination
cd /opt/bpa/bpa-landing && git pull origin main && npm ci && npm run build && pm2 restart bpa-landing

# 4. Smoke tests (§6.1)
# 5. Close ticket
```

---

## Server Directory Layout (Final State)

```text
/opt/bpa/
├── ecosystem.config.cjs          # PM2 process definitions
├── backend-api/                  # bpa_app_api (port 3000)
│   ├── .env                      # production secrets (chmod 600)
│   ├── dist/                     # compiled TypeScript
│   └── prisma/                   # schema + migrations
├── bpa-landing/                  # bpa_land (port 3101)
│   ├── .env.production.local
│   └── .next/                    # build output
├── vaccination_2026/             # (port 3110)
│   ├── .env.production.local
│   └── .next/
└── bpa_web/                      # next_v1 (Phase 2, port 3103)
    ├── .env.production.local
    └── .next/

/etc/nginx/
├── conf.d/                       # rate limits, upstreams, compression
├── snippets/                     # SSL, security headers, proxy configs
└── sites-enabled/                # vhosts for all hosts

/var/log/bpa/                     # PM2 application logs
```

---

## Quick Reference: Clone URLs

```bash
git clone https://github.com/balagpetcare/bpa_app_api.git       # API
git clone https://github.com/balagpetcare/bpa_land.git           # Landing
git clone https://github.com/balagpetcare/vaccination_2026.git   # Campaign
git clone https://github.com/balagpetcare/next_v1.git            # Admin (Phase 2)
git clone https://github.com/balagpetcare/bpa_app.git            # Mobile (Phase 3)
```

---

## Related Documents

| Document | Purpose |
|---|---|
| `BPA_DEPLOYMENT_READINESS_AUDIT.md` | Pre-deploy audit findings |
| `PRODUCTION_DEPLOYMENT_GUIDE.md` | Detailed nginx, Cloudflare, caching, backup |
| `PORT_AND_DOMAIN_MAP.md` | Canonical port and hostname reference |
| `DISASTER-RECOVERY-PLAYBOOK.md` | Incident recovery procedures |
| `infra/nginx/README.md` | nginx config installation guide |
