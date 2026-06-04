# Campaign included vaccines & package pricing

## Overview

Public landing and booking surfaces read **`includedVaccines`** and **`pricing`** from campaign API responses. Checkout uses **`priceAmount`** (= vaccine cost + service charge).

## Pricing fields (`campaigns`)

| Column | Purpose |
|--------|---------|
| `vaccineCost` | Per-cat vaccine portion (e.g. 500) |
| `serviceCharge` | Per-cat service portion (e.g. 100) |
| `priceAmount` | Total per cat for payment (600) — auto-synced on admin save |
| `packageFeatures` | JSON array — checklist extras (certificate, syringe, etc.) |

Public API `pricing` object:

```json
{
  "vaccineCost": 500,
  "serviceCharge": 100,
  "totalPrice": 600,
  "currency": "BDT",
  "packageFeatures": ["Injection Administration", "..."],
  "packageFeatureLines": ["PUREVAX® Feline 4", "Rabies Vaccine", "..."],
  "isFree": false
}
```

`packageFeatureLines` = included vaccine names (with “Vaccine” suffix when missing) + `packageFeatures` (deduped).

**Important:** The API never assigns `vaccineCost = totalPrice` with `serviceCharge = 0` unless those values are stored in the database. Configure both amounts in Admin → Configuration.

Backfill existing ৳600 campaigns (migration `20260604230000_backfill_campaign_pricing_split`) or:

```bash
node scripts/backfill-campaign-pricing-split.js <slug> 500 100
```

## Data model (vaccines)

Table: `campaign_included_vaccines`

| Field | Purpose |
|-------|---------|
| `name` | Branded vaccine name (e.g. PUREVAX® Feline 4) |
| `description` | Optional marketing / clinical summary |
| `coveredDiseases` | JSON array of disease strings |
| `displayOrder` | Sort order on public pages |
| `isActive` | Soft hide without delete |

## API

### Public (no auth)

Included in:

- `GET /api/v1/campaign/public/campaigns`
- `GET /api/v1/campaign/public/campaigns/:slug`

Response field:

```json
"includedVaccines": [
  {
    "id": 1,
    "name": "PUREVAX® Feline 4",
    "description": "...",
    "coveredDiseases": ["Feline Panleukopenia (FPV)", "..."],
    "displayOrder": 0
  }
]
```

### Admin (`campaign.manage`)

| Method | Path |
|--------|------|
| GET | `/api/v1/campaign/admin/campaigns/:campaignId/included-vaccines` |
| POST | `/api/v1/campaign/admin/campaigns/:campaignId/included-vaccines` |
| PATCH | `/api/v1/campaign/admin/campaigns/:campaignId/included-vaccines/:vaccineId` |
| DELETE | `/api/v1/campaign/admin/campaigns/:campaignId/included-vaccines/:vaccineId` |
| PUT | `/api/v1/campaign/admin/campaigns/:campaignId/included-vaccines/reorder` body `{ orderedIds: number[] }` |

## Admin UI

BPA Web: **Campaign → Vaccines included** (`/admin/campaigns/[id]/included-vaccines`)

- Add / edit / delete / reorder (↑↓)

## Frontends (`vaccination_2026`)

- **Landing:** `CampaignDetailsSection` (`#campaign-details`) after Offer Value
- **Booking:** section 4 “Vaccines included” in `StepBookingDetails`; hero title/description from API
- **Legacy overview:** `CampaignOverviewSection` uses API vaccines + dynamic price

Shared component: `components/campaign/VaccinesIncludedSection.tsx`

## Seed (Cat Flu & Rabies 2026)

After migration:

```bash
node scripts/seed-campaign-included-vaccines.js <campaign-slug>
```

Default slug env: `cat-flu-rabies-2026` (pass actual slug if different).

## Migrations

- `20260604210000_campaign_included_vaccines`
- `20260604220000_campaign_pricing_breakdown`

Apply with `npx prisma migrate deploy` (never reset production-like DB).
