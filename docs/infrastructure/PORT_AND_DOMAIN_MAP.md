# BPA Port and Domain Map

**Status:** Documentation only (no runtime changes applied)  
**Date:** 2026-06-05  
**Source:** [bpa-vaccination-domain-strategy.md](../architecture/bpa-vaccination-domain-strategy.md), package.json scripts, `infra/nginx/`  
**Related:** [nginx-production-deployment.md](../nginx-production-deployment.md)

This document is the canonical reference for **local development ports**, **production hostnames**, and **upstream bindings** across the BPA ecosystem.

---

## Executive summary

| Layer | Port / host rule |
|-------|------------------|
| **Central API** | `3000` (fixed, never change) |
| **bpa_web panels** | `3100`–`3107` (fixed per `SITE_MODE`) |
| **bpa-landing** | `3101` (fixed; nginx production upstream) |
| **vaccination_2026** | `3110` (fixed; campaign app) |
| **Reserved** | `3111`–`3119` for future standalone frontends |
| **Production routing** | Host-based nginx → loopback or container upstream |

### Verified port conflict (local dev only)

| Port | Apps | Severity | Notes |
|------|------|----------|-------|
| **3101** | `bpa-landing` **and** `bpa_web` shop (`dev:shop`) | **High** | Both bind `localhost:3101`. Only one can run at a time on a single workstation. |
| — | All other apps | None | Unique ports within the documented map |

**Production:** No bind conflict when each app runs in a **separate process/container** (each may listen on `:3101` on its own network namespace). Nginx routes by `Host` header to the correct upstream.

**Local workaround (until runtime change):** Run `bpa-landing` **or** `bpa_web` shop—not both on 3101. For full-stack local testing with both, temporarily override shop: `cross-env SITE_MODE=shop next dev -p 3108` (documented only; not in `package.json` yet).

---

## Corrected production port map (proposed)

Loopback ports below are what nginx upstreams target on the app server (`127.0.0.1` or Docker service name). Public traffic always arrives on **443** at the edge.

| App | Local port | Production upstream | Production host | Purpose |
|-----|------------|---------------------|-----------------|---------|
| **backend-api** | 3000 | `:3000` | `api.bangladeshpetassociation.com` | Central REST API, webhooks, auth |
| **bpa-landing** | 3101 | `:3101` | `bangladeshpetassociation.com` | Marketing, SEO, apex `/vaccination` bridge |
| **vaccination_2026** | 3110 | `:3110` | `vaccination.bangladeshpetassociation.com` | Campaign landing, booking, payment return |
| **bpa_web** mother / staff | 3100 | `:3100` | `staff.bangladeshpetassociation.com` (or path on admin host) | Staff portal, mother shell |
| **bpa_web** shop | 3101 | `:3101` (separate container) | `shop.bangladeshpetassociation.com` | Pet shop branch panel |
| **bpa_web** clinic | 3102 | `:3102` | `clinic.bangladeshpetassociation.com` | Clinic branch panel |
| **bpa_web** admin | 3103 | `:3103` | `admin.bangladeshpetassociation.com` | Platform admin, campaign ops |
| **bpa_web** owner | 3104 | `:3104` | `owner.bangladeshpetassociation.com` (planned) | Organization owner panel |
| **bpa_web** producer | 3105 | `:3105` | `producer.bangladeshpetassociation.com` (planned) | Producer panel |
| **bpa_web** country | 3106 | `:3106` | Internal / country ops (planned) | Country-level admin |
| **bpa_web** doctor | 3107 | `:3107` | `doctor.bangladeshpetassociation.com` (planned) | Doctor verification panel |

**Redirects (production):**

| Host | Behavior |
|------|----------|
| `www.bangladeshpetassociation.com` | 301 → apex |
| `bangladeshpetassociation.com/vaccination` | Bridge page (canonical → subdomain); optional nginx 301 to `vaccination.` |

**Staging mirror (recommended):**

| Production | Staging |
|------------|---------|
| `api.bangladeshpetassociation.com` | `api-staging.bangladeshpetassociation.com` |
| `bangladeshpetassociation.com` | `staging.bangladeshpetassociation.com` |
| `vaccination.bangladeshpetassociation.com` | `vaccination-staging.bangladeshpetassociation.com` |
| `admin.bangladeshpetassociation.com` | `admin-staging.bangladeshpetassociation.com` |

---

## Application registry

### backend-api

| Field | Value |
|-------|-------|
| **Repository** | `backend-api` |
| **Domain** | `bangladeshpetassociation.com` (API subdomain) |
| **Subdomain** | `api` |
| **Local port** | `3000` |
| **Production host** | `https://api.bangladeshpetassociation.com` |
| **Purpose** | Single source of truth: PostgreSQL (Prisma), campaign/booking/payment, auth, clinic ops, SMS, file storage |
| **Dependencies** | PostgreSQL (`5432`), Redis (`6379`), object storage (MinIO `9000` / B2 in prod), notification worker |

**Key paths:** `/api/v1/*` · Health: `/health` or campaign health endpoints  
**Env:** `PORT=3000`, `CORS_ORIGINS`, `COOKIE_DOMAIN=.bangladeshpetassociation.com`, `APP_URL`, `API_PUBLIC_BASE_URL`

---

### bpa_web

| Field | Value |
|-------|-------|
| **Repository** | `bpa_web` |
| **Domain** | `bangladeshpetassociation.com` (per-panel subdomains) |
| **Subdomains** | `admin`, `shop`, `clinic`, `staff`, `owner`, `producer`, `doctor` (planned) |
| **Local ports** | See panel table below |
| **Production hosts** | `https://admin.bangladeshpetassociation.com`, etc. |
| **Purpose** | Multi-mode Next.js monorepo: admin, staff, shop, clinic, owner, producer, country, doctor dashboards |
| **Dependencies** | `backend-api` (`3000`), cookie auth via same-origin `/api/v1` proxy |

| `SITE_MODE` | Local port | npm script | Base path |
|-------------|------------|------------|-----------|
| mother / staff | 3100 | `dev:mother` | `/mother`, `/staff` |
| shop | 3101 | `dev:shop` | `/shop` |
| clinic | 3102 | `dev:clinic` | `/clinic` |
| admin | 3103 | `dev:admin` | `/admin` |
| owner | 3104 | `dev:owner` | `/owner` |
| producer | 3105 | `dev:producer` | `/producer` |
| country | 3106 | `dev:country` | `/country` |
| doctor | 3107 | `dev:doctor` | `/doctor` |

**API integration:** `NEXT_PUBLIC_API_BASE_URL` → server-side proxy to `backend-api`  
**Auth:** JWT in HttpOnly cookie (`access_token`); ports `3100`–`3107` are separate origins in local dev

---

### bpa-landing

| Field | Value |
|-------|-------|
| **Repository** | `bpa-landing` |
| **Domain** | `bangladeshpetassociation.com` |
| **Subdomain** | `@` (apex) |
| **Local port** | `3101` |
| **Production host** | `https://bangladeshpetassociation.com` |
| **Purpose** | Public marketing site, SEO (Organization/WebSite JSON-LD), `/vaccination` bridge to campaign subdomain |
| **Dependencies** | `backend-api` for SSR public reads (`NEXT_PUBLIC_API_URL` → `/api/v1/public/*`); links to `vaccination_2026` for booking CTA |

**Nginx upstream:** `bpa_landing` → `127.0.0.1:3101` (`infra/nginx/conf.d/00-upstreams.conf`)

---

### vaccination_2026

| Field | Value |
|-------|-------|
| **Repository** | `vaccination_2026` |
| **Domain** | `bangladeshpetassociation.com` |
| **Subdomain** | `vaccination` |
| **Local port** | `3110` |
| **Production host** | `https://vaccination.bangladeshpetassociation.com` |
| **Purpose** | 2026 cat flu + rabies campaign: landing, `/book`, OTP checkout, payment return, certificate verify |
| **Dependencies** | `backend-api` (`3000`) via Next.js rewrite `/api/*` → API; Redis/SMS/payment handled server-side on API |

**Nginx upstream:** `bpa_vaccination` → `127.0.0.1:3110`  
**Campaign API proxy on vaccination host:** `/api/*` → `backend-api:3000` (see site config)

---

## Supporting infrastructure (not public web apps)

| Service | Local port | Purpose | Used by |
|---------|------------|---------|---------|
| PostgreSQL | 5432 | Primary database | `backend-api` |
| Redis | 6379 | OTP, queues, cache | `backend-api`, worker |
| MinIO | 9000 (API), 9001 (console) | Dev object storage | `backend-api` |
| Notification worker | — (no HTTP) | Async jobs | `backend-api` |

---

## Local development quick reference

```text
# Typical campaign stack
backend-api          http://localhost:3000/api/v1
bpa-landing          http://localhost:3101
vaccination_2026     http://localhost:3110

# bpa_web (one panel at a time, or dev:all on 3100–3107)
bpa_web admin        http://localhost:3103/admin
bpa_web shop         http://localhost:3101/shop   ⚠ conflicts with bpa-landing
```

**Recommended local profiles:**

| Profile | Processes | Ports |
|---------|-----------|-------|
| Campaign only | API + vaccination_2026 | 3000, 3110 |
| Marketing only | API + bpa-landing | 3000, 3101 |
| Full BPA panels | API + `npm run dev:all` (bpa_web) | 3000, 3100–3107 (no landing) |
| Marketing + campaign | API + landing + vaccination | 3000, 3101, 3110 (no shop on 3101) |

---

## Nginx vhosts in VCS (current)

| Config file | Host | Upstream |
|-------------|------|----------|
| `bangladeshpetassociation.com.conf` | apex + www redirect | `bpa_landing:3101` |
| `vaccination.bangladeshpetassociation.com.conf` | vaccination subdomain | `bpa_vaccination:3110` + API proxy |
| *(planned)* | `api.`, `admin.`, `shop.`, etc. | Per panel upstream |

---

## Pending runtime changes (out of scope for this doc pass)

1. Add `dev:shop:alt` or document permanent shop port override when co-developing with `bpa-landing`.
2. Add nginx site configs for `api.`, `admin.`, and other `bpa_web` subdomains.
3. Align stale references (`:3001` campaign port, `3100-3104`-only docs) — **addressed in this documentation pass**.
4. Standardize env var naming (`NEXT_PUBLIC_API_URL` vs `NEXT_PUBLIC_API_BASE_URL`).

---

## Change log

| Date | Change |
|------|--------|
| 2026-06-05 | Initial map from ecosystem architecture analysis; conflict analysis; production host matrix |
