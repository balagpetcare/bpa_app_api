# BPA Vaccination Campaign Platform — Redesign Plan

**Status:** Implemented (Phase A–E)  
**Date:** 2026-06-05  
**Completed:** 2026-06-05  
**Scope:** `backend-api`, `bpa_app`, `bpa_web` (admin), `vaccination_2026` (reference)  
**Policy:** Follow `BPA_STANDARD.md`, non-destructive Prisma migrations, preserve payment gateway integration

---

## 1. Executive summary

The BPA vaccination campaign stack already supports express checkout, Dhaka city-corporation booking, multi-cat pricing, payment webhooks, SMS, QR check-in, and per-pet certificates on the **backend** and **web landing**. The **mobile app** still uses a legacy flow: direct clinic/location picker, no dynamic price breakdown, single booking-level QR, and limited analytics.

This redesign aligns the **mobile booking UX with production web parity** and closes gaps for **per-cat tickets**, **area-wise public analytics**, and a **modular domain architecture** reusable for future campaign types.

---

## 2. Current state analysis

### 2.1 Mobile (`bpa_app`)

| Area | Current | Gap |
|------|---------|-----|
| Location | `RadioListTile` on `CampaignLocation` list | No City Corporation → Area → auto-center |
| Cats | `catCount` stepper (1..max) | No per-cat names; count only |
| Pricing | Static `displayPrice` badge | No live breakdown by cat count |
| Checkout | `initCheckout` with `locationId` + `slotId` | Missing `cityCorporationCode`, `bdAreaId` |
| Success | Booking ref + verification code | QR shows ref string, not API QR / per-cat tickets |
| Analytics | Local Smart Campaign metrics | No server live-stats integration |
| Scan | Certificate verify only | No vaccination-day ticket lookup |

**Key files:** `campaign_booking_page.dart`, `campaign_repository.dart`, `campaign_booking_draft.dart`, `campaign_success_page.dart`

### 2.2 Backend (`backend-api`)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Admin countdown | ✅ | `Campaign.countdownEnabled` + admin form (`bpa_web`) |
| City corp + area | ✅ | `dhakaBooking.service.ts`, public routes |
| Auto-assigned center | ✅ | `assignment.service.ts`, zone-interest → venue assign |
| Multi-cat booking | ✅ | `catCount` / `petCount`, `CampaignPet` rows |
| Dynamic pricing | ✅ | `campaignPricing.service.ts` |
| Unique booking ID | ✅ | `bookingRef` on payment fulfill |
| QR per cat | ⚠️ Partial | One `qrToken` per **booking** only |
| SMS confirmation | ✅ | `sendBookingConfirmation`, zone-interest templates |
| QR scan (staff) | ✅ | `checkInBooking` staff route |
| Digital certificate | ✅ | `certificate.service.ts` per `CampaignPet` |
| Area analytics | ⚠️ Partial | Admin `analytics.service.ts`; public stats limited |

### 2.3 Web reference (`vaccination_2026`)

Production booking wizard (`StepBookingDetails`) uses:
- `CityCorporationAreaPicker` (DNCC/DSCC + BdArea ZONE)
- `CatCountSelector` + `PriceBreakdown`
- `initCheckout` without `locationId` (zone-interest mode)
- Payment WebView → success with `bookingRef`

**Mobile must mirror this flow.**

---

## 3. Target modular architecture

Logical modules (domain layer); maps to existing Prisma where noted:

```
Campaign              → Campaign (Prisma)
CampaignArea          → BdArea + CoverageZone (geo selection)
CampaignCenter        → CampaignLocation (auto-assigned venue)
CampaignBooking       → CampaignBooking + CampaignCheckoutSession
CampaignTicket        → CampaignPet.ticketToken (new field) + ticket service
CampaignScan          → checkInBooking + pet vaccination status transitions
CampaignCertificate   → CampaignPet.certificateToken + certificate.service
Notification          → SMS + FCM + local notifications (existing)
```

### 3.1 Mobile domain layout

```
lib/features/campaign/domain/vaccination_platform/
  campaign_area.dart          # City corp + BdArea selection
  campaign_center.dart        # Assigned venue summary (read-only)
  campaign_booking_flow.dart  # Wizard step enum + validation
  campaign_ticket.dart        # Per-cat ticket model
  campaign_scan.dart          # Scan lookup result
  campaign_certificate.dart   # Certificate summary (wraps existing)
  campaign_analytics.dart     # Public stats model
```

### 3.2 Backend additions

```
src/api/v1/modules/campaign/
  ticket.service.ts           # Issue & resolve per-pet tickets
  ticket.controller.ts        # Public ticket endpoints
```

**Schema change (non-destructive):**

```prisma
model CampaignPet {
  ticketToken       String?   @unique @db.VarChar(32)
  ticketIssuedAt    DateTime?
}
```

---

## 4. Feature specification

### 4.1 Campaign countdown (admin-configurable)

- **Admin:** Toggle `countdownEnabled` on campaign (`bpa_web` CampaignForm — already exists).
- **Mobile:** `CampaignCountdownStrip` on home banner (already wired to `GET /campaign/public/campaigns/:slug/countdown`).
- **No backend change required.**

### 4.2 Location: City Corporation → Area → Auto center

**User selects:**
1. City Corporation (DNCC / DSCC)
2. Area (BdArea ZONE child)

**System assigns:**
- Coverage zone (internal)
- Campaign center + slot when capacity allows, OR `PENDING_ASSIGNMENT` zone-interest booking

**Checkout payload:**

```json
{
  "campaignSlug": "cat-flu-rabies-2026",
  "cityCorporationCode": "DNCC",
  "bdAreaId": 12345,
  "bookingArea": "Mirpur",
  "catCount": 2,
  "phone": "017XXXXXXXX"
}
```

**Remove from mobile:** direct `locationId` / slot picker for Dhaka campaigns.

### 4.3 Multiple cats per booking

- Count selector 1..`maxCatsPerBooking` (from campaign config).
- Backend creates N `CampaignPet` rows (`Cat 1`, `Cat 2`, …) on fulfill.
- Optional phase-2: per-cat name entry (not blocking v1).

### 4.4 Dynamic total price

- Client: `computeCampaignPriceBreakdown(unitPrice, catCount, coupon)` matching server.
- UI: line items (per cat × count, discount, total).
- Server validates on `checkout/init`.

### 4.5 Unique booking ID after payment

- Generated at `fulfillCheckoutSession`: `VAC-XXXXXX` (`generateBookingRef`).
- Returned in checkout status + success screen.
- **Already implemented** — mobile success page to poll until `bookingRef` present after payment.

### 4.6 One QR ticket per cat

- On pet create: `ticketToken = generateQrToken()`.
- Public URL: `{CAMPAIGN_BASE_URL}/ticket/{ticketToken}`.
- SMS includes ticket links list.
- Mobile success: ticket carousel with QR images from `GET /campaign/public/tickets/:token/qr`.

### 4.7 SMS confirmation

- Extend `PAYMENT_SUCCESS` / `BOOKING_ZONE_INTEREST` templates with `ticketUrls`.
- Queue via existing `campaign.smsQueue` + BulkSMSBD.

### 4.8 QR scan workflow (vaccination day)

| Actor | Flow |
|-------|------|
| Owner | Shows per-cat ticket QR in app |
| Staff | Scans booking ref or ticket token → `POST /campaign/staff/check-in` |
| System | `CHECKED_IN` → vaccinate pet → `COMPLETED` → certificate |

**Mobile v1:** `CampaignTicketLookupPage` — manual token entry + public ticket status (camera scan = phase-2 `mobile_scanner`).

### 4.9 Digital vaccination certificate

- Existing: `generateCertificate(campaignPetId)` after vaccination complete.
- Mobile: `CertificateWalletScreen` + `CertificateViewerScreen` (no change to core flow).

### 4.10 Campaign analytics

**Public endpoint enhancement** `GET /campaign/public/discovery/live-stats?slug=`:

| Metric | Source |
|--------|--------|
| Total bookings | `campaignBooking.count` |
| Total vaccinated | `campaignPet` COMPLETED |
| Remaining slots | slot capacity − booked |
| Area-wise stats | `groupBy bdAreaId / bookingArea` |

**Mobile:** `CampaignAnalyticsPage` replaces local-only dashboard section with server stats.

### 4.11 Payment gateway

- Preserve `createCheckoutPaymentIntent` → WebView → webhook → `fulfillCheckoutFromOrder`.
- Mobile `CampaignPaymentPage` unchanged (WebView return URLs `bpa://campaign/checkout/success`).

---

## 5. API contract (new / extended)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/campaign/public/dhaka/city-corporations` | List DNCC/DSCC |
| GET | `/campaign/public/dhaka/city-corporations/:code/booking-areas` | Areas under corp |
| POST | `/campaign/public/checkout/init` | Extended: city corp fields (existing) |
| GET | `/campaign/public/checkout/:id/status` | Poll booking + tickets |
| GET | `/campaign/public/bookings/:ref/tickets` | List pet tickets for booking |
| GET | `/campaign/public/tickets/:token` | Ticket detail (public) |
| GET | `/campaign/public/tickets/:token/qr` | QR image base64 |
| GET | `/campaign/public/discovery/live-stats?slug=` | Enhanced analytics |
| POST | `/campaign/staff/check-in` | Staff scan (existing) |

---

## 6. Mobile UX — booking wizard

```
Step 0: Campaign summary + countdown strip
Step 1: City Corporation + Area (CityCorporationAreaPicker)
Step 2: Cat count + price breakdown
Step 3: Contact (phone, name, optional alt phone)
Step 4: Review + Pay / Confirm
Step 5: Success — booking ref + per-cat ticket QR list
```

**Navigation:** `CampaignBookingPage` refactored to stepper; draft persisted in `CampaignBookingDraftProvider`.

---

## 7. Implementation phases

### Phase A — Plan & schema
- [x] Gap analysis
- [x] Architecture mapping
- [x] Prisma migration `ticketToken` on `CampaignPet`

### Phase B — Backend tickets & analytics
- [x] `ticket.service.ts` — issue, resolve, QR
- [x] Hook `checkout.service` finalize + ticket issue
- [x] Public ticket routes (`/bookings/:ref/tickets`, `/tickets/:token`)
- [x] SMS variables `ticketUrls`
- [x] Extend `getPublicLiveStats` + `areaStats`

### Phase C — Mobile booking redesign
- [x] Domain modules under `vaccination_platform/`
- [x] `CityCorporationAreaPicker` widget
- [x] `CampaignPriceBreakdownCard` widget
- [x] Refactor `CampaignBookingPage` 4-step wizard
- [x] Repository + API endpoints for Dhaka + tickets

### Phase D — Success, scan, analytics
- [x] `CampaignSuccessPage` — per-cat ticket list + QR
- [x] `CampaignTicketLookupPage` — vaccination day lookup
- [x] `CampaignAnalyticsPage` — server live-stats
- [x] Hub navigation updates

### Phase E — Tests & docs
- [x] Mobile pricing unit tests
- [x] Campaign test suite (26 passing)
- [x] This plan document

---

## 8. Touch points (files to change)

### Backend
- `prisma/schema.prisma`
- `prisma/migrations/20260605140000_campaign_pet_ticket/migration.sql`
- `src/api/v1/modules/campaign/ticket.service.ts` (new)
- `src/api/v1/modules/campaign/checkout.service.ts`
- `src/api/v1/modules/campaign/booking.service.ts`
- `src/api/v1/modules/campaign/qr.service.ts`
- `src/api/v1/modules/campaign/sms.service.ts`
- `src/api/v1/modules/campaign/discovery.service.ts`
- `src/api/v1/modules/campaign/campaign.routes.ts`
- `src/api/v1/modules/campaign/campaign.types.ts`

### Mobile
- `lib/core/network/api_endpoints.dart`
- `lib/features/campaign/data/models/campaign_booking_draft.dart`
- `lib/features/campaign/data/repositories/campaign_repository.dart`
- `lib/features/campaign/presentation/screens/campaign_booking_page.dart`
- `lib/features/campaign/presentation/screens/campaign_success_page.dart`
- `lib/features/campaign/presentation/screens/campaign_payment_page.dart`
- `lib/features/campaign/presentation/widgets/` (new pickers)
- `lib/features/campaign/domain/vaccination_platform/` (new)
- `test/campaign/` (extend)

### Unchanged (preserve)
- Payment orchestrator + webhooks
- Admin campaign form countdown toggle
- Certificate generation pipeline
- Smart Campaign Engine v2 home features

---

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Zone-interest bookings without immediate venue | Show "venue assigned via SMS" on success; existing assign-venue admin flow |
| Per-cat tickets on legacy bookings | Backfill script optional; generate on first ticket API access if missing |
| Price mismatch client/server | Server is source of truth on checkout; client displays estimate only |
| Prisma migration drift | Run `node scripts/check-migration-integrity.js` before/after |

---

## 10. Acceptance criteria

- [x] Mobile booking uses City Corporation + Area only (no clinic list for Dhaka flow)
- [x] Cat count 1..N with live price total
- [x] Payment success shows unique `VAC-*` booking ID
- [x] Each cat has downloadable/scannable ticket QR
- [x] SMS sent with booking ref + ticket link(s)
- [x] Public analytics show bookings, vaccinated, remaining slots, area breakdown
- [x] Staff check-in accepts booking ref and pet ticket token
- [x] Certificates appear after vaccination complete (unchanged pipeline)
- [x] Existing payment gateway flow unchanged
- [x] All campaign tests pass (26)

---

*Plan complete. Proceed to Phase B–E implementation.*
