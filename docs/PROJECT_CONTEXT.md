# Bangladesh Pet Association (BPA) – Project Context

## Overview
BPA is a national animal welfare & pet ecosystem platform. It connects pet parents, clinics, pet shops, delivery hubs, staff, and admins.

## Tech Stack
- Backend API: Node.js + Express + Prisma
- Database: PostgreSQL
- Storage: MinIO
- Frontend:
  - Next.js (multi-app)
  - Flutter mobile app (Riverpod state management)
- Infra: Docker, Docker Compose

## Fixed Ports (DO NOT CHANGE)
- API: 3000
- Next.js Apps:
  - mother: 3100
  - shop: 3101
  - clinic: 3102
  - admin: 3103
  - owner: 3104

## API
- Base URL: http://localhost:3000/api/v1
- Auth: cookie-based (credentials include)
- Versioning: v1 (stable)

## UI
- Admin & dashboards must follow WowDash Admin Template
- No custom redesign unless explicitly instructed

## Key Principles
- Backward compatible changes only
- Update-only patches preferred
- Never overwrite existing code without merging

## Global-Ready (Country-First)
- **Context:** Every request has a country (header `X-Country-Code`, subdomain, or default BD). Policy, features, and compliance are per country.
- **Docs:** See [./GLOBAL_READY_MASTER.md](./GLOBAL_READY_MASTER.md), [./GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md), [./DEVELOPER_ONBOARDING_GLOBAL.md](./DEVELOPER_ONBOARDING_GLOBAL.md).
- **Launch:** [./MVP_GLOBAL_LAUNCH_CHECKLIST.md](./MVP_GLOBAL_LAUNCH_CHECKLIST.md).
- **New country:** [./GLOBAL_READY_MASTER.md#5-new-country-rollout-checklist](./GLOBAL_READY_MASTER.md#5-new-country-rollout-checklist).
