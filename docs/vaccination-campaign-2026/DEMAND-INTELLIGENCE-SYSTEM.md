# Demand Forecasting & Rollout Planning — BPA 2026

## Overview

Enterprise decision-support for national cat vaccination rollout: executive KPIs, geographic rankings, vaccine forecasting, resource planning, and actionable recommendations.

## Architecture (BPA modular)

| Layer | File |
|-------|------|
| Types | `demand-intelligence.types.ts` |
| Repository | `demand-intelligence.repository.ts` |
| Service | `demand-intelligence.service.ts` |
| Controller | `demand-intelligence.controller.ts` |
| Routes | `campaign.routes.ts` |

Legacy monolithic logic was refactored into repository + service; response includes **legacy fields** (`summary`, `heatmap`, `districtRanking`, etc.) for existing clients.

## API

### Admin (full report)

```
GET /api/v1/campaign/admin/campaigns/:campaignId/demand-intelligence
```

**Response sections:**

| Section | Purpose |
|---------|---------|
| `executiveSummary` | Pre-reg, bookings, vaccinated, conversion, projected demand/revenue |
| `geographic` | Division/district/upazila/location rankings + heatmap |
| `vaccineForecast` | Doses required, buffer, inventory, shortages by vaccine |
| `resourcePlanning` | Staff/slot recommendations, daily capacity |
| `recommendations` | Rollout, procurement, staffing, capacity actions |
| `charts` | Trend, district comparison, vaccine bars, utilization |

### Public heatmap

```
GET /api/v1/campaign/public/discovery/demand-heatmap?level=division|district|upazila|city|area&campaignSlug=
```

## Data sources

| Signal | Table |
|--------|--------|
| Pre-registration | `CampaignPreRegistration` |
| Bookings | `CampaignBooking` |
| Vaccinated | `CampaignPet` |
| Slots / capacity | `CampaignSlot`, `CampaignLocation` |
| Staff | `CampaignStaff` |
| Vaccine stock | `CampaignVaccineType`, `CampaignIncludedVaccine` |
| Rollout capacity | `CampaignRolloutRegion` |
| Geo names | `BdDivision`, `BdDistrict`, `BdUpazila` |

**Division heatmap coordinates:** `BdDivision` has no `latitude`/`longitude` in schema. Division map points use the **mean** of child `BdDistrict` coordinates (`deriveDivisionCentroids` in `demand-intelligence.repository.ts`). Null when no district has coords.

## Scoring & forecast

- **Demand score** = 0–100 vs top bucket in dimension.
- **30-day projection** from 7-day pre-reg + booking cat velocity.
- **Buffer** = 15% on vaccine doses.
- **Staff heuristics** = vaccinators ~40 cats/day, volunteers ~80 cats/day.

## Admin UI (`bpa_web`)

Route: `/admin/campaigns/[id]/demand-intelligence`

Component: `src/bpa/campaign/admin/demand-forecast/DemandForecastDashboard.tsx`

Nav: **Demand forecasting**

---

*Document version: 2026-06-04*
