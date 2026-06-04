# Campaign Configuration Engine — Implementation Report

**Date:** 2026-06-04
**Status:** IMPLEMENTED
**Reference:** `docs/campaign-config/implementation-plan.md`

---

## Summary

The Campaign Configuration Engine has been implemented across Backend, Web Admin, and Booking UI. It introduces per-campaign configurable settings (booking, payment, capacity, display) stored in a dedicated `CampaignConfig` model, with full audit history and real-time enforcement in booking/checkout flows.

---

## 1. Files Changed

### Backend (`backend-api`)

| Action | File | Description |
|--------|------|-------------|
| **MODIFY** | `prisma/schema.prisma` | Added `CampaignConfig` model (11 boolean/int fields), `CampaignConfigHistory` model, added `config` relation to `Campaign` |
| **NEW** | `src/api/v1/modules/campaign/config.service.ts` | Config CRUD, defaults fallback, upsert with version increment, history logging, booking/capacity validation helpers |
| **NEW** | `src/api/v1/modules/campaign/config.validation.ts` | Zod schema for config update validation |
| **NEW** | `src/api/v1/modules/campaign/analytics.service.ts` | Bookings by location, bookings by coverage zone, payment analytics (online/venue/expected/collected revenue), top campaign locations |
| **MODIFY** | `src/api/v1/modules/campaign/campaign.routes.ts` | Added 5 admin config endpoints (`GET/PUT /config`, `GET /config/history`, `GET /config/history/:version`), 1 analytics endpoint (`GET /analytics`) |
| **MODIFY** | `src/api/v1/modules/campaign/campaign.controller.ts` | Public campaign endpoint now includes `config` in response (additive, non-breaking) |
| **MODIFY** | `src/api/v1/modules/campaign/campaign.service.ts` | `createCampaign` now auto-creates `CampaignConfig` row; `getCampaignById` includes `config` relation |
| **MODIFY** | `src/api/v1/modules/campaign/campaign.types.ts` | Added `CampaignConfigInput`, `CampaignAnalytics` type definitions |
| **MODIFY** | `src/api/v1/modules/campaign/booking.service.ts` | Reads `CampaignConfig` for booking validation (bookingEnabled, maxCatsPerBooking, walkInAllowed, payment checks) |
| **MODIFY** | `src/api/v1/modules/campaign/checkout.service.ts` | Reads `CampaignConfig` for checkout validation (bookingEnabled, payment method checks, maxCatsPerBooking) |

### Web Admin (`bpa_web`)

| Action | File | Description |
|--------|------|-------------|
| **MODIFY** | `src/bpa/campaign/admin/CampaignForm.tsx` | Added 8 toggle switches (Booking Open, Online Payment, Pay At Venue, Walk-In, Approval Required, Slot Required, Auto Close, Show Remaining Slots) + Max Capacity field; updated form values, defaults, payload serialization, and deserialization |
| **MODIFY** | `src/bpa/campaign/admin/CampaignNav.tsx` | Added "Analytics" tab |
| **MODIFY** | `lib/campaignApi.ts` | Added `CampaignConfigData` type, `campaignAdminGetConfig`, `campaignAdminUpdateConfig`, `campaignAdminSaveConfig`, `campaignAdminGetConfigHistory`, `CampaignAnalyticsData` type, `campaignAdminAnalytics` functions |
| **MODIFY** | `app/admin/(larkon)/campaigns/[id]/edit/page.tsx` | Saves config alongside campaign update |
| **MODIFY** | `app/admin/(larkon)/campaigns/new/page.tsx` | Saves config when creating new campaign |
| **NEW** | `app/admin/(larkon)/campaigns/[id]/analytics/page.tsx` | Full analytics dashboard: payment summary cards, top locations table, bookings by location table, bookings by coverage zone table |

### Booking UI (`vaccination_2026`)

| Action | File | Description |
|--------|------|-------------|
| **MODIFY** | `components/booking/steps/StepPayDirect.tsx` | Dynamic payment options based on campaign config: shows "Pay Online" when `onlinePaymentEnabled=true`, shows "Pay At Vaccination Venue" when `payAtVenueEnabled=true`, disables booking when both are false |

---

## 2. APIs Changed

### New Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/v1/campaign/admin/campaigns/:id/config` | Admin | Get campaign config (merged with defaults) |
| `PUT` | `/api/v1/campaign/admin/campaigns/:id/config` | Admin | Upsert campaign config (versioned, audited) |
| `GET` | `/api/v1/campaign/admin/campaigns/:id/config/history` | Admin | List config change history |
| `GET` | `/api/v1/campaign/admin/campaigns/:id/config/history/:version` | Admin | Get specific config version |
| `GET` | `/api/v1/campaign/admin/campaigns/:id/analytics` | Admin | Full analytics dashboard (bookings by location, coverage zone, payments, top locations) |

### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| `GET` | `/api/v1/campaign/public/campaigns/:slug` | Response now includes `config` object with public-facing settings |
| `POST` | `/api/v1/campaign/admin/campaigns` | Auto-creates `CampaignConfig` row with sensible defaults |
| `GET` | `/api/v1/campaign/admin/campaigns/:id` | Response now includes `config` relation |

---

## 3. UI Changes

### Admin Panel — Campaign Create/Edit Form

Added under "Campaign Configuration" section:

| Switch | Field | Default |
|--------|-------|---------|
| Booking Open | `bookingEnabled` | `true` |
| Online Payment | `onlinePaymentEnabled` | `false` |
| Pay At Venue | `payAtVenueEnabled` | `false` |
| Walk-In | `walkInAllowed` | `true` |
| Approval Required | `approvalRequired` | `false` |
| Slot Required | `slotRequired` | `true` |
| Auto Close | `autoCloseWhenFull` | `true` |
| Show Remaining Slots | `showRemainingSlots` | `true` |

Plus: Max Capacity input field (0 = unlimited).

Warning banner displayed when both payment options are off with booking enabled.

### Admin Panel — Analytics Page

New tab "Analytics" in campaign navigation. Dashboard includes:

- **Payment Summary Cards**: Online Payments, Venue Payments, Expected Revenue, Collected Revenue
- **Top Campaign Locations**: Ranked table with bookings, cats, vaccinations
- **Bookings By Location**: Full table with capacity info
- **Bookings By Coverage Zone**: Division/District/City breakdown with target capacity and active status

### Booking Page — Dynamic Payment Options

| Condition | UI Shown |
|-----------|----------|
| `onlinePaymentEnabled=true` | "Pay Online" radio + gateway dropdown (bKash, Nagad, SSLCommerz) |
| `payAtVenueEnabled=true` | "Pay At Vaccination Venue" radio |
| Both false (paid campaign) | Warning: "Booking is currently unavailable" + submit disabled |
| Free campaign | No payment section shown, direct confirmation |

---

## 4. Migration Impact

### Schema Changes

| Table | Action | Columns | Risk |
|-------|--------|---------|------|
| `campaign_configs` | **CREATE** | `id`, `campaignId` (unique), `version`, `bookingEnabled`, `onlinePaymentEnabled`, `payAtVenueEnabled`, `walkInAllowed`, `approvalRequired`, `slotRequired`, `autoCloseWhenFull`, `maxCapacity`, `maxCatsPerBooking`, `showRemainingSlots`, `lateBookingAllowed`, `metadataJson`, `createdAt`, `updatedAt` | **Low** — new table only |
| `campaign_config_history` | **CREATE** | `id`, `campaignId`, `version`, `changedBy`, `changeReason`, `configJson`, `createdAt` | **Low** — new table only |
| `campaigns` | **ADD RELATION** | Prisma relation `config CampaignConfig?` — no new column in SQL | **None** |

### Migration Command

```bash
npx prisma migrate dev --name add_campaign_config_engine
```

### Rollback

```sql
DROP TABLE IF EXISTS campaign_config_history;
DROP TABLE IF EXISTS campaign_configs;
```

### Non-Destructive Guarantee

- No `DROP TABLE`, `DROP COLUMN`, or `ALTER TYPE` on existing tables
- No modifications to existing columns
- Existing `Campaign` flat fields (`maxPetsPerBooking`, `allowWalkIns`, etc.) remain unchanged
- Services fall back to Campaign flat fields when no CampaignConfig row exists

---

## 5. Duplicate Risk Assessment

### Risk 1: Dual Source of Truth (Campaign flat fields vs CampaignConfig)

| Aspect | Assessment | Mitigation |
|--------|-----------|------------|
| `maxPetsPerBooking` on Campaign vs `maxCatsPerBooking` on CampaignConfig | **Medium risk** | Services read CampaignConfig first; booking.service uses `configRow?.maxCatsPerBooking ?? campaign.maxPetsPerBooking` |
| `allowWalkIns` on Campaign vs `walkInAllowed` on CampaignConfig | **Medium risk** | Form syncs both values; config takes precedence in services |
| Pricing type on Campaign vs `onlinePaymentEnabled/payAtVenueEnabled` on CampaignConfig | **Low risk** | Config controls payment method visibility; Campaign.pricingType controls price calculation |

**Future action:** Deprecate flat fields on Campaign after all campaigns have CampaignConfig rows.

### Risk 2: CampaignAuditLog vs CampaignConfigHistory

| Aspect | Assessment |
|--------|-----------|
| Both store change records | **Not duplicate** — CampaignAuditLog is a generic event log (all campaign entity types); CampaignConfigHistory stores full config snapshots for version comparison |

### Risk 3: Analytics vs Existing Stats

| Aspect | Assessment |
|--------|-----------|
| `getCampaignStats()` vs `getCampaignAnalyticsDashboard()` | **Not duplicate** — Stats provides totals/rates; Analytics provides payment breakdown, coverage zone analysis, and top locations ranking |
| `getDailySummary()` vs Analytics | **Not duplicate** — Daily summary is per-day view; Analytics is aggregate across the campaign |

### Risk 4: CoverageZone system vs Rollout Region analytics

| Aspect | Assessment |
|--------|-----------|
| `bookingsByCoverageZone()` uses `CampaignRolloutRegion` | **Reuses** existing rollout region data; does not duplicate CoverageZone tables |

---

## 6. Settings Mapping

| Requested Setting | Schema Field | Enforced In |
|-------------------|-------------|-------------|
| `bookingEnabled` | `CampaignConfig.bookingEnabled` | `checkout.service.ts`, `booking.service.ts` |
| `onlinePaymentEnabled` | `CampaignConfig.onlinePaymentEnabled` | `checkout.service.ts`, `StepPayDirect.tsx` |
| `payAtVenueEnabled` | `CampaignConfig.payAtVenueEnabled` | `StepPayDirect.tsx` |
| `walkInAllowed` | `CampaignConfig.walkInAllowed` | `booking.service.ts` (walk-in registration) |
| `approvalRequired` | `CampaignConfig.approvalRequired` | Schema stored, ready for booking approval workflow |
| `slotRequired` | `CampaignConfig.slotRequired` | Schema stored, ready for slot-optional booking |
| `autoCloseWhenFull` | `CampaignConfig.autoCloseWhenFull` | `config.service.ts` → `validateCapacity()` |
| `maxCapacity` | `CampaignConfig.maxCapacity` | `config.service.ts` → `validateCapacity()` |
| `maxCatsPerBooking` | `CampaignConfig.maxCatsPerBooking` | `booking.service.ts`, `checkout.service.ts` |
| `showRemainingSlots` | `CampaignConfig.showRemainingSlots` | Public API response; consumed by booking UI |
| `lateBookingAllowed` | `CampaignConfig.lateBookingAllowed` | Schema stored, ready for late-booking bypass |

---

## 7. Analytics Mapping

| Requested Analytics | Implementation | Endpoint |
|--------------------|----------------|----------|
| Bookings By Location | `analytics.service.ts` → `getBookingsByLocation()` | `GET /analytics` |
| Bookings By Coverage Zone | `analytics.service.ts` → `getBookingsByCoverageZone()` | `GET /analytics` |
| Online Payments | `analytics.service.ts` → `getPaymentAnalytics()` → `onlinePayments/onlineRevenue` | `GET /analytics` |
| Venue Payments | `analytics.service.ts` → `getPaymentAnalytics()` → `venuePayments/venueRevenue` | `GET /analytics` |
| Expected Revenue | `analytics.service.ts` → `getPaymentAnalytics()` → `expectedRevenue` | `GET /analytics` |
| Collected Revenue | `analytics.service.ts` → `getPaymentAnalytics()` → `collectedRevenue` | `GET /analytics` |
| Top Campaign Locations | `analytics.service.ts` → `getTopCampaignLocations()` | `GET /analytics` |

---

## 8. Validation Rules Implemented

### Booking Rules

- `bookingEnabled` must be `true` for non-walk-in bookings
- `walkInAllowed` must be `true` for walk-in registrations
- Pet count must not exceed `maxCatsPerBooking`
- At least one payment method must be enabled for paid campaigns

### Campaign Rules

- Config auto-created on campaign creation with sensible defaults
- Config versioned — every update increments version and creates history entry
- Config changes audited via `CampaignAuditLog`

### Capacity Rules

- When `maxCapacity > 0` and `autoCloseWhenFull = true`, bookings beyond capacity are rejected
- `validateCapacity()` helper available for slot-level and campaign-level enforcement

### Payment Rules

- `onlinePaymentEnabled` controls whether online gateway options appear in checkout
- `payAtVenueEnabled` controls whether "Pay at Venue" option appears
- When neither is enabled on a paid campaign, booking is disabled with user-facing warning
- Free campaigns skip payment validation entirely
