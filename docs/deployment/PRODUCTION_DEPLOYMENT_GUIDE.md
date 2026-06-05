# BPA Production Deployment Guide

**Date:** 2026-06-05  
**Scope:** Public production stack for three hosts  
**Type:** Documentation only — **do not run deploy commands from this doc without a change ticket**

| Host | Application | Origin upstream |
|------|-------------|-----------------|
| `https://bangladeshpetassociation.com` | `bpa-landing` | `127.0.0.1:3101` |
| `https://vaccination.bangladeshpetassociation.com` | `vaccination_2026` | `127.0.0.1:3110` |
| `https://api.bangladeshpetassociation.com` | `backend-api` | `127.0.0.1:3000` |

**Related VCS configs:** `infra/nginx/` · [PORT_AND_DOMAIN_MAP.md](../infrastructure/PORT_AND_DOMAIN_MAP.md) · [nginx-production-deployment.md](../nginx-production-deployment.md) · [enterprise-monitoring-failover-strategy.md](../architecture/enterprise-monitoring-failover-strategy.md)

---

## Architecture

```text
                    ┌─────────────────────────────────────┐
                    │           Cloudflare Edge            │
                    │  DNS · SSL · WAF · CDN · Brotli     │
                    └──────────────────┬──────────────────┘
                                       │ HTTPS (443)
                    ┌──────────────────▼──────────────────┐
                    │     Origin server — nginx (443)      │
                    │  TLS · rate limit · gzip/brotli      │
                    │  security headers · reverse proxy    │
                    └───┬─────────────┬──────────────┬─────┘
                        │             │              │
                 :3101 landing   :3110 campaign   :3000 API
                        │             │              │
                        └─────────────┴──────────────┘
                                      │
                        PostgreSQL · Redis · B2/MinIO · worker
```

**Traffic flow:**

1. Browser resolves DNS → Cloudflare anycast IP (proxied records).
2. Cloudflare terminates user TLS, applies WAF/cache/Brotli, forwards to origin.
3. Origin nginx terminates **Full (strict)** TLS to Cloudflare, proxies to loopback apps.
4. Campaign site proxies `/api/*` → `backend-api:3000` (booking funnel).
5. Landing calls `api.bangladeshpetassociation.com` from browser/SSR (CORS + public reads).

---

## 1. DNS records (Cloudflare)

**Zone:** `bangladeshpetassociation.com`  
**Registrar nameservers:** Point to Cloudflare (`*.ns.cloudflare.com`).

Replace `<ORIGIN_IPV4>` with the production VPS/load-balancer public IPv4. Add `AAAA` if origin has native IPv6.

### 1.1 Required records

| Type | Name | Content | Proxy | TTL | Purpose |
|------|------|---------|-------|-----|---------|
| `A` | `@` | `<ORIGIN_IPV4>` | **Proxied** (orange) | Auto | Apex — marketing landing |
| `A` | `www` | `<ORIGIN_IPV4>` | **Proxied** | Auto | www → nginx 301 to apex |
| `A` | `vaccination` | `<ORIGIN_IPV4>` | **Proxied** | Auto | Campaign booking site |
| `A` | `api` | `<ORIGIN_IPV4>` | **Proxied** | Auto | Central REST API |

### 1.2 Recommended records

| Type | Name | Content | Proxy | Purpose |
|------|------|---------|-------|---------|
| `CNAME` | `www` | `bangladeshpetassociation.com` | Proxied | Alternative to `A` www (choose one pattern) |
| `TXT` | `@` | `v=spf1 …` | DNS only | Mail (if sending from domain) |
| `TXT` | `_dmarc` | `v=DMARC1; p=none; …` | DNS only | Email auth |
| `CAA` | `@` | `0 issue "letsencrypt.org"` | DNS only | Restrict cert issuers (optional) |

### 1.3 Staging (recommended before prod cutover)

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| `A` | `staging` | `<STAGING_IP>` | Proxied |
| `A` | `vaccination-staging` | `<STAGING_IP>` | Proxied |
| `A` | `api-staging` | `<STAGING_IP>` | Proxied |

Validate staging end-to-end before switching production traffic.

### 1.4 DNS-only exceptions

| Record | When to use DNS only (grey cloud) |
|--------|-----------------------------------|
| `api` (temporary) | Initial Let's Encrypt HTTP-01 if origin cert not ready |
| `mail`, `MX` | Always DNS only |
| ACME `_acme-challenge` | When using certbot DNS-01 plugin |

**After origin TLS is stable:** keep all web hosts **proxied** for WAF and DDoS protection.

---

## 2. Cloudflare settings

Configure in **Cloudflare Dashboard → bangladeshpetassociation.com**.

### 2.1 SSL/TLS

| Setting | Value | Notes |
|---------|-------|-------|
| **SSL/TLS encryption mode** | **Full (strict)** | Origin must present valid cert (Let's Encrypt or Cloudflare Origin CA) |
| **Always Use HTTPS** | On | Edge redirect HTTP → HTTPS |
| **Minimum TLS Version** | TLS 1.2 | Align with nginx `ssl_protocols` |
| **TLS 1.3** | On | |
| **Automatic HTTPS Rewrites** | On | Fix mixed content |
| **HSTS** | Enable after smoke test | Max-Age 31536000; includeSubDomains; preload (matches nginx) |
| **Origin Server** | Origin Certificate (optional) | 15-year cert on origin if not using Let's Encrypt |

**Certificate strategy (pick one):**

| Option | Origin cert | Renewal |
|--------|-------------|---------|
| **A — Let's Encrypt (recommended)** | certbot on origin; SAN covers apex, www, vaccination, api | certbot timer |
| **B — Cloudflare Origin CA** | Generate in CF dashboard; install on nginx | Manual before expiry (~15y) |

### 2.2 Security

| Setting | Value |
|---------|-------|
| **Security Level** | Medium (raise to High during attacks) |
| **Bot Fight Mode** | On for marketing hosts; test booking flow |
| **Browser Integrity Check** | On |
| **WAF managed rules** | Cloudflare Managed Ruleset — On |
| **Custom WAF** | Block common paths: `/.env`, `/wp-admin`, `/phpmyadmin` |
| **Rate limiting rules** | `/api/v1/campaign/auth/*` — 10 req/min/IP; `/api/v1/campaign/booking/*` — 30 req/min/IP |

**Authenticated origin pulls (optional hardening):**

- Enable **Authenticated Origin Pulls** after installing Cloudflare origin pull CA on nginx (`ssl_client_certificate`).

### 2.3 Speed — Brotli & compression

| Setting | Value |
|---------|-------|
| **Brotli** | On (Cloudflare compresses at edge for eligible responses) |
| **Auto Minify** | JS, CSS, HTML — **Off** for Next.js (can break hydration); evaluate per host |
| **HTTP/2** | On |
| **HTTP/3 (QUIC)** | On |
| **0-RTT** | Off until reviewed (replay risk on mutating API) |

Origin nginx also enables **gzip** (`03-compression.conf`) and optional **Brotli** (`04-brotli.conf`) for direct-origin requests and cache misses.

### 2.4 Caching (Cloudflare)

Use **Cache Rules** (or legacy Page Rules) — default **bypass** for dynamic HTML and API.

| Rule name | Host | URL match | Cache status | Edge TTL | Notes |
|-----------|------|-----------|--------------|----------|-------|
| Bypass API | `api.*` | `*` | Bypass | — | Never cache JSON/auth |
| Bypass book | `vaccination.*` | `/book*`, `/api/*` | Bypass | — | OTP/checkout |
| Bypass HTML | `bangladeshpetassociation.com` | `/` except static | Bypass | — | SSR pages |
| Cache static | `*` | `/_next/static/*` | Cache | 1 year | Immutable Next assets |
| Cache media | `*` | `*.ico,*.svg,*.webp,*.png,*.woff2` | Cache | 7 days | Public files |
| Cache OG | `bangladeshpetassociation.com` | `/opengraph-image*` | Cache | 1 day | Generated OG images |

**Cache key:** Include host header; do not cache responses with `Set-Cookie`.

**Development mode:** Off in production (bypasses cache entirely).

### 2.5 Network & resilience

| Setting | Value |
|---------|-------|
| **WebSockets** | On (if Socket.IO used through api host) |
| **IP Geolocation** | On (optional analytics) |
| **True-Client-IP** | On; nginx reads `CF-Connecting-IP` (see §3.4) |

### 2.6 Cloudflare health checks (optional paid)

| Monitor | URL | Interval | Regions |
|---------|-----|----------|---------|
| Landing | `https://bangladeshpetassociation.com/` | 60s | 2+ |
| Vaccination | `https://vaccination.bangladeshpetassociation.com/` | 60s | 2+ |
| API liveness | `https://api.bangladeshpetassociation.com/health` | 60s | 2+ |

Alert on 2 consecutive failures → Slack `#bpa-incidents`.

---

## 3. Nginx configuration

**Source of truth in git:** `infra/nginx/`  
Install path on server: `/etc/nginx/`.

### 3.1 Shared infrastructure (already in VCS)

Copy and enable:

```bash
sudo cp infra/nginx/conf.d/*.conf /etc/nginx/conf.d/
sudo cp infra/nginx/snippets/*.conf /etc/nginx/snippets/
sudo cp infra/nginx/sites-available/*.conf /etc/nginx/sites-available/
```

| File | Purpose |
|------|---------|
| `conf.d/00-upstreams.conf` | `bpa_landing:3101`, `bpa_vaccination:3110`, **`bpa_api:3000`** |
| `conf.d/01-rate-limit.conf` | `bpa_general`, `bpa_static`, `bpa_api_auth` zones |
| `conf.d/02-security-headers.conf` | `server_tokens off` |
| `conf.d/03-compression.conf` | gzip |
| `conf.d/04-brotli.conf` | Brotli (disable if module missing) |
| `snippets/ssl-letsencrypt.conf` | TLS 1.2/1.3, OCSP stapling |
| `snippets/security-headers.conf` | HSTS, CSP, Permissions-Policy |
| `snippets/proxy-nextjs.conf` | Next.js upstream headers |
| `snippets/proxy-api.conf` | API upstream headers |

**Update `00-upstreams.conf`** — uncomment API upstream:

```nginx
upstream bpa_api {
    server 127.0.0.1:3000 max_fails=3 fail_timeout=30s;
    keepalive 64;
}
```

### 3.2 Real IP from Cloudflare

Add to `conf.d/05-cloudflare-real-ip.conf` (new file):

```nginx
# Cloudflare IPv4/IPv6 ranges — refresh quarterly from:
# https://www.cloudflare.com/ips/

set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
# IPv6 (subset — extend from Cloudflare docs)
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;

real_ip_header CF-Connecting-IP;
real_ip_recursive on;
```

### 3.3 Site — apex marketing (`bangladeshpetassociation.com`)

**File:** `sites-available/bangladeshpetassociation.com.conf` (in VCS)

Key behaviors:

- Proxies to `bpa_landing` (`:3101`)
- `/_next/static/` — 1y cache
- `/vaccination` bridge served by landing (no forced redirect to subdomain)
- `www` → apex 301

**Optional same-origin API proxy** (reduces CORS for SSR):

```nginx
location ^~ /api/v1/ {
    limit_req zone=bpa_general burst=40 nodelay;
    include /etc/nginx/snippets/proxy-api.conf;
    proxy_pass http://bpa_api/api/v1/;
}
```

Enable only if `NEXT_PUBLIC_API_URL` on landing is set to same-origin `/api/v1`.

### 3.4 Site — vaccination campaign

**File:** `sites-available/vaccination.bangladeshpetassociation.com.conf` (in VCS)

Key behaviors:

- `/api/*` → `127.0.0.1:3000/api/` (checkout, OTP, webhooks)
- `/book/payment/*` — `Cache-Control: no-store`
- Static assets — long cache

### 3.5 Site — API host (proposed — add to VCS)

**File:** `sites-available/api.bangladeshpetassociation.com.conf`

```nginx
# Central API — backend-api (upstream :3000)
# Install: ln -s .../api.bangladeshpetassociation.com.conf /etc/nginx/sites-enabled/

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name api.bangladeshpetassociation.com;

    include /etc/nginx/snippets/ssl-letsencrypt.conf;
    include /etc/nginx/snippets/security-headers.conf;

    access_log /var/log/nginx/bpa-api.access.log combined buffer=32k flush=5s;
    error_log  /var/log/nginx/bpa-api.error.log warn;

    limit_conn bpa_conn_per_ip 60;

    # Liveness — no rate limit
    location = /health {
        limit_req off;
        include /etc/nginx/snippets/proxy-api.conf;
        proxy_pass http://bpa_api/health;
        add_header Cache-Control "no-store" always;
    }

    location = /health/redis {
        limit_req off;
        include /etc/nginx/snippets/proxy-api.conf;
        proxy_pass http://bpa_api/health/redis;
        add_header Cache-Control "no-store" always;
    }

    # Payment / SMS webhooks — allow provider IPs at WAF; generous body size
    location ^~ /api/v1/campaign/payment/ {
        limit_req zone=bpa_general burst=20 nodelay;
        client_max_body_size 1m;
        include /etc/nginx/snippets/proxy-api.conf;
        proxy_read_timeout 120s;
        proxy_pass http://bpa_api;
    }

    # Auth / OTP — strict rate limit
    location ~ ^/api/v1/campaign/(auth|booking)/ {
        limit_req zone=bpa_api_auth burst=5 nodelay;
        limit_req zone=bpa_general burst=30 nodelay;
        limit_req_status 429;
        include /etc/nginx/snippets/proxy-api.conf;
        proxy_pass http://bpa_api;
    }

    # Public campaign reads — moderate limit
    location ^~ /api/v1/campaign/public/ {
        limit_req zone=bpa_general burst=60 nodelay;
        include /etc/nginx/snippets/proxy-api.conf;
        proxy_pass http://bpa_api;
    }

    # Default API
    location / {
        limit_req zone=bpa_general burst=40 nodelay;
        limit_req_status 429;
        include /etc/nginx/snippets/proxy-api.conf;
        proxy_pass http://bpa_api;
    }
}
```

### 3.6 HTTP ACME + redirect (update existing)

**File:** `sites-available/00-acme-and-redirect.conf` — add `api` to `server_name`:

```nginx
server_name bangladeshpetassociation.com www.bangladeshpetassociation.com
            vaccination.bangladeshpetassociation.com
            api.bangladeshpetassociation.com;
```

### 3.7 TLS certificate issuance

**Multi-SAN cert (recommended):**

```bash
sudo certbot certonly --nginx \
  -d bangladeshpetassociation.com \
  -d www.bangladeshpetassociation.com \
  -d vaccination.bangladeshpetassociation.com \
  -d api.bangladeshpetassociation.com \
  --email admin@bangladeshpetassociation.com \
  --agree-tos \
  --no-eff-email
```

**Auto-renewal:**

```bash
sudo systemctl enable certbot.timer
sudo certbot renew --dry-run
```

**Behind Cloudflare:** If HTTP-01 fails while proxied, use **DNS-01** (`certbot-dns-cloudflare`) or temporarily grey-cloud the host during issuance.

### 3.8 Enable sites & validate

```bash
sudo ln -sf /etc/nginx/sites-available/00-acme-and-redirect.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/bangladeshpetassociation.com.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/vaccination.bangladeshpetassociation.com.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/api.bangladeshpetassociation.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 4. SSL summary

| Layer | Mechanism | Responsibility |
|-------|-----------|----------------|
| User → Cloudflare | Universal SSL / Advanced certificate | Cloudflare |
| Cloudflare → Origin | Full (strict) — valid origin cert | Platform team |
| Origin nginx | `ssl-letsencrypt.conf` or CF Origin CA | certbot / manual |
| HSTS | nginx `Strict-Transport-Security` + Cloudflare HSTS | Both (enable CF after verify) |
| OCSP stapling | nginx `ssl_stapling on` | Origin |

**Do not use** Cloudflare **Flexible** SSL (encrypts only to edge; origin HTTP is insecure).

---

## 5. Security headers

### 5.1 Nginx (origin)

Applied via `snippets/security-headers.conf` on all three HTTPS server blocks:

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self), payment=(self)` |
| `X-XSS-Protection` | `0` (deprecated; intentional) |
| `Content-Security-Policy` | Baseline in snippet — includes analytics + payment frame-src |

**API host CSP:** Consider a stricter CSP on `api.*` (JSON-only responses) — override in API server block:

```nginx
add_header Content-Security-Policy "default-src 'none'; frame-ancestors 'none';" always;
```

### 5.2 Express (backend-api)

`helmet()` in `src/app.ts` — ensure production `connectSrc` includes production frontends, not only `localhost:*`.

### 5.3 Cloudflare Transform Rules (optional)

| Rule | Action |
|------|--------|
| Add `X-Content-Type-Options: nosniff` if missing | Set static header |
| Remove `Server` fingerprint | Rewrite response headers |

---

## 6. Brotli & compression strategy

| Layer | gzip | Brotli | When |
|-------|------|--------|------|
| **Cloudflare edge** | Yes (automatic) | **On** in Speed settings | All proxied responses eligible |
| **nginx origin** | `03-compression.conf` | `04-brotli.conf` (optional module) | Cache miss / grey-cloud / origin-only |
| **Next.js** | Built-in | — | App layer |
| **API JSON** | nginx gzip/brotli | Small payloads — acceptable CPU cost |

**Rule:** Do not double-compress unnecessarily. Cloudflare respects `Content-Encoding` from origin; prefer **one** compression hop (edge OR origin). Typical production: **Cloudflare Brotli on**, origin gzip on, origin Brotli optional.

**Install Brotli module (Debian/Ubuntu):**

```bash
sudo apt install -y libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static
# If nginx -t fails: mv 04-brotli.conf 04-brotli.conf.disabled
```

---

## 7. Caching strategy

### 7.1 Layer summary

| Content type | Cloudflare | nginx | App |
|--------------|------------|-------|-----|
| HTML (SSR) | Bypass | no cache | `Cache-Control: private, no-cache` |
| `/_next/static/*` | 1 year | `expires 1y; immutable` | Next.js hashed assets |
| Public images/fonts | 7 days | `expires 7d` | — |
| `/book`, `/api/*` on vaccination | Bypass | `no-store` on payment paths | — |
| API JSON | **Never cache** | no cache headers | auth Vary |
| Health endpoints | Bypass | `no-store` | — |

### 7.2 Landing ISR / Next cache

`bpa-landing` uses `unstable_cache` with 60–120s revalidation for API-backed sections. Origin must not cache HTML at nginx layer longer than app intent.

### 7.3 API caching

**Never** cache at Cloudflare or CDN for:

- `/api/v1/auth/*`
- `/api/v1/campaign/booking/*`
- `/api/v1/campaign/payment/*`
- Any response with `Set-Cookie`

Public read endpoints (`/api/v1/campaign/public/*`) may use short edge cache (30–60s) **only after** verifying no personalized data — default **bypass** until reviewed.

---

## 8. Health checks

### 8.1 Application endpoints (current)

| Service | Endpoint | Expected | Notes |
|---------|----------|----------|-------|
| **backend-api** | `GET /health` | `200 {"ok":true,"service":"bpa_api"}` | Implemented |
| **backend-api** | `GET /health/redis` | `200` or `503` | Redis probe |
| **backend-api** | `GET /api/v1/campaign/public/sms/health` | `200` | SMS provider status |
| **bpa-landing** | `GET /health` | `200 {"ok":true}` | **Recommended** — add Next.js route |
| **vaccination_2026** | `GET /health` | `200 {"ok":true}` | **Recommended** — add Next.js route |

**Recommended future:** `GET /health/ready` on API (DB `SELECT 1` + migrations check) — see [enterprise-monitoring-failover-strategy.md](../architecture/enterprise-monitoring-failover-strategy.md).

### 8.2 Synthetic monitoring (external)

Run from **2+ regions** (e.g. Singapore, Mumbai):

| ID | URL | Interval | Fail threshold |
|----|-----|----------|----------------|
| U1 | `https://bangladeshpetassociation.com/` | 1 min | 2 consecutive |
| U2 | `https://bangladeshpetassociation.com/health` | 1 min | 2 consecutive |
| U3 | `https://vaccination.bangladeshpetassociation.com/` | 1 min | 2 consecutive |
| U4 | `https://vaccination.bangladeshpetassociation.com/health` | 1 min | 2 consecutive |
| U5 | `https://vaccination.bangladeshpetassociation.com/book` | 5 min | 2 consecutive |
| U6 | `https://api.bangladeshpetassociation.com/health` | 1 min | 2 consecutive |
| U7 | `https://api.bangladeshpetassociation.com/api/v1/campaign/public/campaigns` | 5 min | 2 consecutive |
| U8 | TLS expiry all hosts | Daily | < 14 days |

### 8.3 Origin process supervision

| Process | Port | Supervisor | Restart policy |
|---------|------|------------|----------------|
| `backend-api` | 3000 | systemd / PM2 / Docker | `Restart=always` |
| `worker:notifications` | — | same | required for OTP/SMS |
| `bpa-landing` | 3101 | systemd / PM2 | `Restart=always` |
| `vaccination_2026` | 3110 | systemd / PM2 | `Restart=always` |
| `nginx` | 443 | systemd | `Restart=on-failure` |
| `postgresql` | 5432 | managed / systemd | HA per provider |
| `redis` | 6379 | managed / systemd | persistence enabled |

**Post-deploy smoke:**

```bash
curl -fsS https://api.bangladeshpetassociation.com/health
curl -fsS https://bangladeshpetassociation.com/ | head -c 200
curl -fsS https://vaccination.bangladeshpetassociation.com/book | head -c 200
```

---

## 9. Backup strategy

Consolidates [enterprise-monitoring-failover-strategy.md §6](../architecture/enterprise-monitoring-failover-strategy.md) for this three-host stack.

### 9.1 Recovery objectives

| Component | RPO | RTO | Notes |
|-----------|-----|-----|-------|
| PostgreSQL | ≤ 1 hour | 30 min – 4 h | Campaign bookings — critical |
| Redis | ≤ 6 hours | 30 min | OTP queues; re-auth acceptable |
| Object storage (B2) | ≤ 24 h | 4 h | Certificates, uploads |
| Frontends (landing, vaccination) | 0 (git) | 30 min | Redeploy from tag |
| nginx/TLS config | 0 (git + certbot) | 15 min | `infra/nginx/` in VCS |
| Secrets (.env) | 0 (vault versions) | 15 min | Never only on disk |

### 9.2 PostgreSQL

| Job | Schedule | Retention | Verify |
|-----|----------|-----------|--------|
| Managed snapshot / `pg_dump -Fc` | Hourly or daily | 30 days | Backup log |
| WAL / PITR | Continuous (managed) | 7–30 days | Quarterly restore drill |
| **Pre-deploy snapshot** | Manual before migration | 7 days | Record snapshot ID in ticket |

**Pre-migration (mandatory):**

```bash
node scripts/check-migration-integrity.js
npx prisma migrate deploy   # only after snapshot
```

**Never on production DB:** `prisma migrate reset`, `db push`, destructive down migrations after live bookings.

### 9.3 Redis

| Job | Schedule | Notes |
|-----|----------|-------|
| RDB snapshot | Every 6 h | Managed Redis |
| Pre-campaign snapshot | Before go-live | Document in deploy ticket |

### 9.4 Object storage

Daily mirror to DR bucket (`mc mirror` or provider replication) — see `DISASTER-RECOVERY-PLAYBOOK.md`.

### 9.5 Configuration backup

| Item | Location | Backup method |
|------|----------|---------------|
| Production `.env` | Vault | Versioned secrets |
| Let's Encrypt | `/etc/letsencrypt/` | certbot + CF Origin CA fallback |
| Cloudflare DNS | Dashboard | Export zone quarterly |
| nginx | `infra/nginx/` + `/etc/nginx/` | Git + server snapshot |

### 9.6 Monthly verification checklist

- [ ] Last DB backup age &lt; 24 h
- [ ] Restore drill to isolated DB (`campaign_bookings` row count spot-check)
- [ ] `certbot renew --dry-run` succeeds
- [ ] Cloudflare DNS export archived
- [ ] `node scripts/check-migration-integrity.js` clean on staging

---

## 10. Production environment variables

### 10.1 backend-api

| Variable | Production example |
|----------|-------------------|
| `PORT` | `3000` |
| `NODE_ENV` | `production` |
| `API_PUBLIC_BASE_URL` | `https://api.bangladeshpetassociation.com` |
| `APP_URL` | `https://api.bangladeshpetassociation.com` |
| `CORS_ORIGINS` | `https://bangladeshpetassociation.com,https://vaccination.bangladeshpetassociation.com,https://admin.bangladeshpetassociation.com` |
| `COOKIE_DOMAIN` | `.bangladeshpetassociation.com` |
| `DATABASE_URL` | Vault — managed Postgres |
| `REDIS_URL` | Vault |

### 10.2 bpa-landing

| Variable | Production example |
|----------|-------------------|
| `NEXT_PUBLIC_SITE_URL` | `https://bangladeshpetassociation.com` |
| `NEXT_PUBLIC_API_URL` | `https://api.bangladeshpetassociation.com/api/v1` |
| `NEXT_PUBLIC_CAMPAIGN_SITE_URL` | `https://vaccination.bangladeshpetassociation.com` |

### 10.3 vaccination_2026

| Variable | Production example |
|----------|-------------------|
| `NEXT_PUBLIC_SITE_URL` | `https://vaccination.bangladeshpetassociation.com` |
| API proxy | Same-origin `/api/*` → nginx → `:3000` |

---

## 11. Deployment checklist

**Ticket required:** deploy ID, rollback tag, snapshot ID, maintenance window.

### Phase 0 — Pre-flight (T-7 days)

- [ ] Staging hosts validated (`staging.`, `vaccination-staging.`, `api-staging.`)
- [ ] DNS records created in Cloudflare (§1)
- [ ] Cloudflare SSL **Full (strict)** verified (§2.1)
- [ ] Origin cert covers all four SANs (§3.7)
- [ ] WAF + rate limits configured (§2.2)
- [ ] Backup snapshot &lt; 24 h; pre-deploy snapshot taken (§9.2)
- [ ] `node scripts/check-migration-integrity.js` passes on staging
- [ ] Rollback git tags created (`release-YYYY-MM-DD`, previous tag noted)
- [ ] On-call assigned; `#bpa-incidents` channel ready
- [ ] Maintenance window communicated (if migration locks expected)

### Phase 1 — Infrastructure (T-1 h)

- [ ] Origin nginx configs deployed from `infra/nginx/` + API site (§3)
- [ ] `sudo nginx -t && sudo systemctl reload nginx`
- [ ] Brotli module installed or disabled cleanly (§6)
- [ ] Cloudflare cache rules applied (§2.4)
- [ ] Synthetic monitors silenced for maintenance window (max 30 min)

### Phase 2 — Data layer (T-0)

- [ ] **Pre-deploy DB snapshot** recorded
- [ ] `npx prisma migrate deploy` on production
- [ ] Post-migrate sanity: campaign tables, config rows
- [ ] Redis reachable; worker queue empty or drained

### Phase 3 — Applications (ordered)

| Step | Component | Action | Verify |
|------|-----------|--------|--------|
| 1 | **backend-api** | Build + deploy; start `:3000` | `curl /health` 200 |
| 2 | **worker** | Deploy `worker:notifications` | OTP test (sandbox) |
| 3 | **vaccination_2026** | `npm run build && npm run start` `:3110` | `/` and `/book` 200 |
| 4 | **bpa-landing** | `npm run build && npm run start` `:3101` | `/` 200, `/vaccination` 200 |
| 5 | **Campaign** | Admin → ACTIVE campaign + slots | Public list 200 |
| 6 | **Webhooks** | Payment/SMS URLs → `api.` host | Provider test callback 200 |

### Phase 4 — Edge & DNS cutover

- [ ] Cloudflare proxy enabled (orange cloud) on all hosts
- [ ] HSTS enabled in Cloudflare after smoke pass
- [ ] Purge Cloudflare cache ( selective — static only)
- [ ] Resume synthetic monitors

### Phase 5 — Post-deploy smoke (T+30 min)

- [ ] U1–U8 health checks green (§8.2)
- [ ] Landing → “Book Now” → vaccination subdomain
- [ ] Vaccination booking funnel (staging OTP or sandbox)
- [ ] Payment return URL loads (`/book/payment/*`)
- [ ] API CORS from landing + vaccination origins
- [ ] Security headers spot-check ([securityheaders.com](https://securityheaders.com))
- [ ] Lighthouse on production URL (landing homepage)
- [ ] Error rates normal in logs (5xx &lt; 0.5%)

### Phase 6 — Sign-off

- [ ] Deploy ticket closed with snapshot ID + git SHA
- [ ] Runbook updated if deviations occurred
- [ ] Post-deploy review scheduled (24 h)

---

## 12. Rollback checklist

Use when smoke tests fail, SEV-1/2 incident, or error budget exceeded. **Prefer forward fix** for minor issues; rollback for schema incompatibility or total funnel failure.

### 12.1 Decision matrix

| Symptom | First action | Rollback scope |
|---------|--------------|----------------|
| Bad frontend build | Redeploy previous tag | landing and/or vaccination only |
| API 5xx after deploy | Rollback API container | backend-api + worker |
| Migration failure | **Stop** — do not retry blindly | Restore DB snapshot (§9.2) |
| Payment broken | Pause campaign in admin | API rollback if code-related |
| nginx misconfig | `nginx -t` fail → revert file | nginx only |
| Cloudflare rule error | Disable rule | Edge only |

### 12.2 Rollback sequence

**Step 1 — Contain (0–5 min)**

- [ ] Announce incident in `#bpa-incidents`
- [ ] Enable Cloudflare **Under Attack** mode only if DDoS; otherwise avoid
- [ ] **Pause campaign** in admin if booking/payment affected
- [ ] Optional: serve static maintenance on vaccination `/book` (nginx `return 503` or maintenance page)

**Step 2 — Frontend rollback (5–15 min)**

```bash
# Example — adjust paths/tags
cd /opt/bpa/bpa-landing && git checkout release-PREV && npm ci && npm run build && pm2 restart bpa-landing
cd /opt/bpa/vaccination_2026 && git checkout release-PREV && npm ci && npm run build && pm2 restart bpa-vaccination
```

- [ ] Verify `:3101` and `:3110` locally on origin
- [ ] `curl` smoke U1, U3, U5

**Step 3 — API rollback (5–15 min)**

```bash
cd /opt/bpa/backend-api && git checkout release-PREV && npm ci && npm run build && pm2 restart bpa-api bpa-worker
```

- [ ] `curl https://api.bangladeshpetassociation.com/health`
- [ ] Campaign public list returns expected payload

**Step 4 — Database rollback (last resort, 30 min – 4 h)**

Only if migration caused corruption/incompatibility and forward fix is not safe.

- [ ] Stop API + worker (prevent writes)
- [ ] Restore pre-deploy snapshot to new instance or PITR to timestamp **before deploy**
- [ ] Update `DATABASE_URL` if endpoint changed
- [ ] Run integrity check; compare booking counts with finance ops
- [ ] Document data loss window (RPO)

**Never:** `prisma migrate reset` on production.

**Step 5 — nginx / edge rollback**

```bash
sudo cp /etc/nginx/sites-available/*.conf.bak /etc/nginx/sites-available/
sudo nginx -t && sudo systemctl reload nginx
```

- [ ] Revert Cloudflare rule if changed
- [ ] Purge cache if stale HTML served

**Step 6 — Verify & close**

- [ ] U1–U8 green for 15 min
- [ ] Booking test on staging or sandbox
- [ ] Incident postmortem within 48 h
- [ ] Root cause + preventive ticket

### 12.3 Rollback tags (prepare before every deploy)

```bash
git tag release-$(date +%Y%m%d)-pre-deploy
git push origin release-$(date +%Y%m%d)-pre-deploy
```

Record in deploy ticket:

| Field | Value |
|-------|-------|
| Previous API SHA | |
| Previous landing SHA | |
| Previous vaccination SHA | |
| DB snapshot ID | |
| Rollback owner | |

---

## 13. Quick reference

| Resource | Path |
|----------|------|
| nginx VCS | `infra/nginx/` |
| Port map | `docs/infrastructure/PORT_AND_DOMAIN_MAP.md` |
| nginx install guide | `docs/nginx-production-deployment.md` |
| API gap analysis (landing) | `bpa-landing/docs/api/BPA_LANDING_API_GAP_ANALYSIS.md` |
| Monitoring strategy | `docs/architecture/enterprise-monitoring-failover-strategy.md` |
| Campaign deploy plan | `docs/vaccination-campaign-2026/06-DEPLOYMENT-PLAN.md` |
| Prisma policy | `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md` |

---

## Change log

| Date | Change |
|------|--------|
| 2026-06-05 | Initial production deployment guide — DNS, Cloudflare, nginx (incl. proposed API vhost), caching, health, backup, deploy/rollback checklists |

---

*Documentation only. No deployment was executed in producing this guide.*
