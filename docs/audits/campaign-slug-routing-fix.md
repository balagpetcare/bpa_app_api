# Campaign Slug Routing Fix — Implementation Report

**Date:** 2026-06-07  
**Scope:** Phase B — URL-driven campaign slug routing for public booking  
**Projects:** `vaccination_2026` (primary), `bpa-landing` (bridge CTAs)

**Related:** [campaign-booking-id-zero-audit.md](./campaign-booking-id-zero-audit.md)

---

## Summary

Implemented URL-first campaign slug routing so `/book` loads the campaign named in `?campaign={slug}`. Removed the hardcoded `uat-free-2026` fallback. `NEXT_PUBLIC_CAMPAIGN_SLUG` remains an optional env fallback when the query param is absent.

---

## Root problem (recap)

| Before | After |
|--------|-------|
| `/book` always used `NEXT_PUBLIC_CAMPAIGN_SLUG \|\| "uat-free-2026"` | `/book?campaign={slug}` is primary |
| Landing CTAs linked to bare `/book` | All Book Now CTAs include `?campaign={slug}` when slug is known |
| Landing could show campaign A while booking loaded campaign B | Same slug flows from CTA → URL → API |
| Missing DB slug → "Campaign with ID 0 not found" | Friendly errors + back-to-home link |

---

## Implementation

### 1. Shared slug utilities — `vaccination_2026/lib/campaignSlug.ts`

| Export | Purpose |
|--------|---------|
| `normalizeCampaignSlug` / `isValidCampaignSlug` | Validate slug (`^[a-z0-9-]{3,100}$`) |
| `buildBookUrl(slug, { location?, slot? })` | Canonical `/book?campaign=…` builder |
| `parseBookSearchParams` | Read `campaign`, `location`, `slot` from URL |
| `resolveBookingCampaignSlug` | URL param → env fallback; returns `{ slug, error }` |
| `loadPublicCampaign` | Server loader: URL slug → env → public list |
| `getEnvCampaignSlugFallback` | Env only — **no hardcoded slug** |
| `MISSING_CAMPAIGN_SLUG_MESSAGE` / `INVALID_CAMPAIGN_SLUG_MESSAGE` | User-facing copy |

### 2. Client hooks & components

| File | Role |
|------|------|
| `lib/useBookUrl.ts` | Resolves slug: context → public list → env; returns `buildBookUrl()` |
| `components/BookNowLink.tsx` | Reusable Book Now link with slug in query |
| `components/landing/CampaignBookingContext.tsx` | `useOptionalCampaignBooking()`; removed `uat-free-2026` default |

### 3. Booking page — `app/book/page.tsx`

- Wrapped in `Suspense` for `useSearchParams`
- Reads `?campaign=` via `resolveBookingCampaignSlug`
- Validates slug format before API call
- Shows friendly error card + "Back to home" when slug missing/invalid/not found
- Passes `campaignSlug`, `slugError`, `loadError` to `BookingWizard`

### 4. Booking wizard — `components/booking/BookingWizard.tsx`

- Accepts resolved slug from parent (no env constant)
- Reads `location` / `slot` from URL into draft
- Sends `campaignSlug` from URL to `initCheckout`
- Passes `locationId` / `slotId` to checkout when present

### 5. Landing page loader — `app/page.tsx`

- Supports `/?campaign={slug}` for multi-campaign landing
- Uses `loadPublicCampaign()` (URL → env → list fallback)
- Removed `uat-free-2026` constant

### 6. CTA updates (all include `?campaign=` when slug known)

**v2 landing:** HeroSection, CampaignAvailabilitySection, BookingCountdownSection, LandingCtaBand, FinalCtaSection, BpaTrustFooterLayer, ContactSection, StickyMobileCta

**Legacy landing:** LandingHero, NationalPremiumHero, DhakaRolloutSection, SavingsComparisonSection, ClinicLocatorSection, StickyBookingButton, CampaignScheduleSection, CampaignLocatorSection, UpcomingScheduleWidget, UpcomingCampaignsSection

**Global chrome:** SiteHeader, SiteFooter, contact page, booking detail "Book another", book/success "Try again"

**bpa-landing:** `getCampaignBookingUrl(campaignSlug)` appends `?campaign=`; promo + bridge pages pass `campaign.slug`

### 7. Config

- `vaccination_2026/.env.example` — documents env slug as optional fallback only (commented)

---

## Slug resolution order

### Booking page (`/book`)

```
1. ?campaign= (valid format)
2. NEXT_PUBLIC_CAMPAIGN_SLUG (valid format)
3. Error: MISSING_CAMPAIGN_SLUG_MESSAGE
```

Invalid `?campaign=` value → `INVALID_CAMPAIGN_SLUG_MESSAGE` (env not used).

### Book Now links (`useBookUrl`)

```
1. CampaignBookingContext.campaignSlug (landing)
2. First ACTIVE+PUBLIC campaign from GET /public/campaigns
3. NEXT_PUBLIC_CAMPAIGN_SLUG
4. /book (no query — booking page shows missing-slug error)
```

### Landing page (`/`)

```
1. ?campaign=
2. NEXT_PUBLIC_CAMPAIGN_SLUG
3. First campaign from GET /public/campaigns
```

---

## Verification matrix

| Scenario | URL | Expected |
|----------|-----|----------|
| Direct link | `/book?campaign=cat-flu-rabies-2026` | Loads that campaign |
| Shared campaign card link | `/book?campaign={row.slug}` | Loads matching campaign |
| Slot deep link | `/book?campaign={slug}&slot={id}` | Loads campaign; slot in draft |
| Location deep link | `/book?campaign={slug}&location={id}` | Loads campaign; location in draft |
| Multiple active campaigns | Different `?campaign=` values | Each loads its own campaign |
| Missing slug, no env | `/book` | Friendly missing-slug message |
| Invalid slug | `/book?campaign=INVALID!` | Invalid-link message |
| Env fallback only | `/book` + `NEXT_PUBLIC_CAMPAIGN_SLUG` set | Loads env campaign |
| Hero Book Now | `/book?campaign={displayed-slug}` | Matches landing campaign |
| No `uat-free-2026` in code | `rg uat-free-2026 vaccination_2026` | Only removed from app code (docs/reports may retain) |

**Build:** `npm run build` in `vaccination_2026` — passed (2026-06-07).

---

## Files changed (touch points)

| Area | Files |
|------|-------|
| Core | `lib/campaignSlug.ts`, `lib/useBookUrl.ts`, `components/BookNowLink.tsx` |
| Booking | `app/book/page.tsx`, `components/booking/BookingWizard.tsx` |
| Landing load | `app/page.tsx`, `components/landing/CampaignBookingContext.tsx` |
| CTAs | 20+ landing/global components (see §6) |
| Bridge | `bpa-landing/src/config/campaign.ts`, promo + bridge pages |
| Tooling | `scripts/e2e-landing-validation.mjs`, `.env.example` |

---

## Operational notes

1. **Production:** Set `NEXT_PUBLIC_CAMPAIGN_SLUG` only as a safety net for bare `/book` links (bookmarks, old marketing). Primary path is always `?campaign=`.
2. **Admin:** Ensure each ACTIVE+PUBLIC campaign has a stable slug before linking CTAs.
3. **Follow-up (optional):** Backend `getCampaignBySlug` could return slug-specific 404 instead of "Campaign with ID 0" (Phase C from prior audit).

---

## Removed dependencies

- Hardcoded `uat-free-2026` in `BookingWizard`, `app/book/page.tsx`, `app/page.tsx`, `CampaignBookingContext`
- Env-only slug as sole booking source (env is now fallback #2 on `/book`)
