# Bangladesh Pet Association (BPA) – Project Context

## Overview
BPA is a national animal welfare & pet ecosystem platform. It connects pet parents, clinics, pet shops, delivery hubs, staff, and admins.

## Tech Stack
- Backend API: Node.js + Express + Prisma
- Database: PostgreSQL
- Storage: MinIO (dev) / B2 (production path)
- Frontend:
  - **bpa_web** — Next.js multi-panel monorepo (admin, shop, clinic, staff, owner, producer, country, doctor)
  - **bpa-landing** — Next.js marketing site (apex domain)
  - **vaccination_2026** — Next.js campaign booking site (subdomain)
  - **bpa_app** — Flutter mobile app (Riverpod state management)
- Infra: Docker, Docker Compose, Nginx (production)

## Ecosystem applications

| Repository | Role | Local port | Production host |
|------------|------|------------|-----------------|
| `backend-api` | Central API | 3000 | `api.bangladeshpetassociation.com` |
| `bpa-landing` | Marketing / SEO | 3101 | `bangladeshpetassociation.com` |
| `vaccination_2026` | Campaign booking | 3110 | `vaccination.bangladeshpetassociation.com` |
| `bpa_web` | Admin & branch panels | 3100–3107 | `admin.`, `shop.`, `clinic.`, etc. |
| `bpa_app` | Mobile client | — | App stores (HTTPS → API) |

**Full port, subdomain, and dependency matrix:** [./infrastructure/PORT_AND_DOMAIN_MAP.md](./infrastructure/PORT_AND_DOMAIN_MAP.md)

## Fixed Ports (DO NOT CHANGE)

### API
- **3000** — reserved for `backend-api`; must never change

### bpa_web (Next.js `SITE_MODE`)
- mother / staff: **3100**
- shop: **3101**
- clinic: **3102**
- admin: **3103**
- owner: **3104**
- producer: **3105**
- country: **3106**
- doctor: **3107**

### Standalone Next.js frontends
- **bpa-landing:** **3101** (conflicts locally with bpa_web shop — see port map)
- **vaccination_2026:** **3110**

### Reserved
- **3111–3119** — future standalone frontends

## Local dev conflict note
`bpa-landing` and `bpa_web` shop both use port **3101**. On one machine, run only one at a time, or use a temporary port override for shop (documented in PORT_AND_DOMAIN_MAP). Production uses separate containers/upstreams per host.

## API
- Base URL: http://localhost:3000/api/v1
- Production: https://api.bangladeshpetassociation.com/api/v1
- Auth: cookie-based for panels (credentials include); OTP Bearer for campaign booking
- Versioning: v1 (stable)

## UI
- Admin & dashboards must follow WowDash / Larkon Admin Template patterns
- No custom redesign unless explicitly instructed

## Key Principles
- Backward compatible changes only
- Update-only patches preferred
- Never overwrite existing code without merging

## Global-Ready (Country-First)
- **Context:** Every request has a country (header `X-Country-Code`, subdomain, or default BD). Policy, features, and compliance are per country.
- **Docs:** See [./GLOBAL_READY_MASTER.md](./GLOBAL_READY_MASTER.md), [./GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md), [./DEVELOPER_ONBOARDING_GLOBAL.md](./DEVELOPER_ONBOARDING_GLOBAL.md).
- **Launch:** [./MVP_GLOBAL_LAUNCH_CHECKLIST.md](./MVP_GLOBAL_LAUNCH_CHECKLIST.md).
- **Multi-domain production:** [./architecture/bpa-vaccination-domain-strategy.md](./architecture/bpa-vaccination-domain-strategy.md), [./nginx-production-deployment.md](./nginx-production-deployment.md).
