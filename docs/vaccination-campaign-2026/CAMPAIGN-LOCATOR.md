# Campaign Locator & Discovery — BPA 2026

## Overview

Dynamic campaign discovery replaces static landing content. All data is loaded from **public campaign APIs** — no hardcoded clinic lists, coverage figures, or schedules.

## Landing sections (`vaccination_2026`)

| Section | ID | API |
|---------|-----|-----|
| Upcoming campaigns | `#upcoming` | `GET /discovery/upcoming` |
| Campaign locator | `#locator` | `GET /discovery/locator` |
| Campaign schedule | `#schedule` | `GET /discovery/schedule` |
| Coverage / rollout | `#coverage` | `GET /discovery/schedule` (regions + totals) |
| Pre-register (inactive areas) | `#pre-register` | `POST /pre-register` |

Geo helpers: `GET /rollout/divisions`, `/districts`, `/upazilas`, `GET /discovery/areas`.

## Public API (`/api/v1/campaign/public`)

### Upcoming campaigns

```
GET /discovery/upcoming?window=today|this_week|this_month&campaignId=&campaignSlug=
```

Returns active public campaigns with:

- `nextSlotDate`, `nextSlotStartTime`
- `availableSlots`, `remainingCapacity`
- `locationCount`

Filtered to campaigns with activity or locations in the selected window.

### Campaign locator

```
GET /discovery/locator?divisionId=&districtId=&district=&city=&area=&postalCode=&upazilaId=&campaignSlug=
```

**Search dimensions**

- Division / district / upazila (IDs or resolved names)
- City (text or upazila name)
- Area (neighbourhood — matches `BdArea` and address text)
- Postal code (address substring)

**Response**

- `matches[]` — locations and active rollout regions, sorted by distance when coordinates exist
- Per match: `isNearest`, `nextSlotDate`, `nextSlotStartTime`, `availableSlots`, `remainingCapacity`, `distanceKm`
- `showPreRegister` — true when no matches and area is not yet open
- `preRegisterGeo` — IDs for waiting list signup

### Interactive schedule

```
GET /discovery/schedule?campaignSlug=&startDate=&endDate=&divisionId=&districtId=
```

Powers **calendar**, **timeline**, **list**, and **map** views:

- `events` — all slots in range with capacity
- `byDate` — calendar grouping
- `locations` — clinics with lat/lng for map
- `rolloutRegions` — Dhaka / division / district rollout rows
- `divisions` — filter list
- `totals` — open events and remaining capacity

### Areas (optional autocomplete)

```
GET /discovery/areas?districtId=&upazilaId=&q=
```

## Backend implementation

- **Service:** `src/api/v1/modules/campaign/discovery.service.ts`
- **Validation:** `src/api/v1/modules/campaign/discovery.validation.ts`
- **Routes:** `campaign.routes.ts` (public router)

Distance uses Haversine when BD geo and `CampaignLocation` coordinates are present.

## Pre-registration when no campaign

If locator returns `showPreRegister: true`:

1. User completes mobile + cat count (locator embed or `#pre-register`).
2. `POST /pre-register` stores waiting list row.
3. Admin activates region → **Notify waiting** sends SMS (`CAMPAIGN_PREREG_OPEN`).

See [NATIONAL-ROLLOUT-SYSTEM.md](./NATIONAL-ROLLOUT-SYSTEM.md).

## Frontend client

`vaccination_2026/lib/campaignApi.ts`:

- `fetchUpcomingCampaigns`
- `searchCampaignLocator`
- `fetchDiscoverySchedule`

## Admin data requirements

For full discovery UX, configure in admin:

1. **Campaign locations** with address, optional `latitude`/`longitude`, `addressJson` (`division`, `district`, `upazila`, `city`, `area`)
2. **Slots** with OPEN status and capacity
3. **Rollout regions** per phase (Dhaka, division cities, districts)

## Testing checklist

- [ ] Upcoming: Today / Week / Month tabs return API rows
- [ ] Locator: Dhaka district returns nearest active site with slots
- [ ] Locator: inactive district shows pre-register
- [ ] Schedule: calendar, timeline, list, map render without static data
- [ ] Coverage chips reflect `rolloutRegions` from API
- [ ] Builds pass: `backend-api`, `vaccination_2026`

---

*Document version: 2026-06-02*
