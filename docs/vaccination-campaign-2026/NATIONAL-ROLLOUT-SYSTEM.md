# National Rollout System — BPA 2026 Vaccination Campaign

## Overview

The national rollout system transforms the Dhaka-only pilot into a **phased nationwide vaccination platform** with geographic rollout control, pre-registration for inactive areas, admin dashboards, and demand reporting.

## Phases (default seed)

| Phase | Code | Geography | Default status |
|-------|------|-----------|----------------|
| 1 | `PHASE_1` | Dhaka | `ACTIVE` |
| 2 | `PHASE_2` | Chattogram, Rajshahi, Khulna, Sylhet, Barishal, Rangpur, Mymensingh | `PLANNED` |
| 3 | `PHASE_3` | District expansion | `PLANNED` |
| 4 | `PHASE_4` | Nationwide coverage | `PLANNED` |

Default phases and Phase 1 Dhaka region are created automatically on first roadmap or admin phases request (`ensureDefaultRolloutPhases`).

## Data model

- **`CampaignRolloutPhase`** — phase metadata, status, dates, nationwide goal per phase
- **`CampaignRolloutRegion`** — division / district / upazila, city, venue, linked `CampaignLocation`, start/end dates, `targetCapacity`, `isActive`
- **`CampaignPreRegistration`** — waiting list: phone, cat count, BD geo IDs, status (`WAITING` → `NOTIFIED` → `BOOKED` / `CANCELLED`)

Migration: `prisma/migrations/20260604120000_campaign_national_rollout/migration.sql`

## Campaign Rollout Engine (backend)

**Service:** `src/api/v1/modules/campaign/rollout.service.ts`  
**Validation:** `src/api/v1/modules/campaign/rollout.validation.ts`  
**Routes:** `src/api/v1/modules/campaign/campaign.routes.ts`

### Public API (`/api/v1/campaign/public`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/rollout/roadmap?campaignId=&slug=` | Current phase, upcoming phases, nationwide goal |
| GET | `/rollout/divisions` | BD divisions |
| GET | `/rollout/districts?divisionId=` | Districts by division |
| GET | `/rollout/upazilas?districtId=` | Upazilas by district |
| POST | `/rollout/area-check` | Whether area is active for booking |
| POST | `/pre-register` | Pre-registration when area inactive |

### Admin API (`/api/v1/campaign/admin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/campaigns/:campaignId/rollout/phases` | List phases + regions |
| POST | `/rollout/phases` | Create phase |
| PATCH | `/rollout/phases/:id` | Update phase |
| POST | `/rollout/regions` | Create region (division, district, city, venue, dates, capacity) |
| PATCH | `/rollout/regions/:id` | Update region / activate |
| GET | `/campaigns/:campaignId/rollout/dashboard/pre-bookings` | Pre-booking dashboard |
| GET | `/campaigns/:campaignId/rollout/dashboard/area-demand` | Area demand dashboard |
| GET | `/campaigns/:campaignId/rollout/dashboard/waiting-list` | Waiting list |
| GET | `/campaigns/:campaignId/rollout/reports/demand` | District/city demand + estimated vaccines |
| POST | `/campaigns/:campaignId/rollout/notify-pre-registered` | Mark notified + enqueue SMS |

## Landing site (`vaccination_2026`)

- **`RolloutRoadmapSection`** — Current phase, upcoming phase, nationwide goal (`#roadmap`)
- **`PreRegisterSection`** — District / upazila / phone / cat count when area not active (`#pre-register`)
- API client: `lib/campaignApi.ts` (`fetchRolloutRoadmap`, `submitPreRegistration`, etc.)

## Admin web (`bpa_web`)

| Route | Purpose |
|-------|---------|
| `/admin/campaigns/[id]/rollout` | Phase status, regions CRUD |
| `/admin/campaigns/[id]/pre-registrations` | Pre-booking, area demand, waiting list, notify |
| `/admin/campaigns/[id]/rollout-reports` | Most requested districts/cities, estimated demand |

Nav tabs added in `CampaignNav.tsx`. API: `lib/campaignApi.ts`.

## Pre-registration flow

1. User selects division → district → upazila, phone, cat count.
2. `area-check` returns `canPreRegister: true` when no active region matches.
3. `POST /pre-register` stores row with status `WAITING`.
4. When admin activates region and calls **Notify waiting**, status → `NOTIFIED` and SMS template `CAMPAIGN_PREREG_OPEN` is enqueued (if SMS queue available).

## Reports

- **Most requested districts** — grouped pre-registrations with district/division names
- **Most requested cities** — upazila-level aggregation
- **Estimated vaccine demand** — sum of `catCount` across pre-registrations

## Deployment

```bash
cd backend-api
npx prisma generate
npx prisma migrate deploy
npm run build
```

Apply same migration before enabling rollout routes in production. Seed BD geo tables if not already present (`BdDivision`, `BdDistrict`, `BdUpazila`).

## Testing checklist

- [ ] GET roadmap returns Phase 1 active for active campaign
- [ ] Pre-register rejected when Dhaka area active (direct to booking)
- [ ] Pre-register accepted for inactive district
- [ ] Admin activate region + notify updates status
- [ ] Demand report ranks districts by `estimatedCats`
- [ ] Landing roadmap and pre-register form load with campaign slug

---

*Document version: 2026-06-02 — National rollout implementation.*
