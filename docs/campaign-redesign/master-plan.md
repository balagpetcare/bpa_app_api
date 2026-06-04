# Vaccination Campaign — Master Redesign Plan

**Project scope:** BPA 2026 Cat Flu + Rabies Vaccination Campaign  
**Audit date:** 2026-06-04  
**Workspaces in scope:**

| Role | Path |
|------|------|
| Backend / API | `D:\BPA_Data\backend-api` |
| Admin Web (WowDash) | `D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\` |
| Public Landing & Booking | `D:\BPA_Data\vaccination_2026` |

**Audit goal:** Map the full **Campaign Admin · Locations · Booking · Analytics · Reports · SMS · Export** surface; identify **current limitations · duplicate functionality · missing business features**; propose a target architecture and phased redesign plan.

**This document is planning only.** No code is modified. All changes when executed must follow `docs/BPA_STANDARD.md`: fixed ports, no UI redesign (WowDash patterns), no destructive Prisma migrations, update-only patches.

---

## 0. Executive Summary

### 0.1 What works today

| Area | Status |
|------|--------|
| Backend Phases A–H (schema, services, controllers, RBAC, SMS queue, certificate, verification) | **Shipped** — `PHASE-2-AUDIT.md` |
| Production payment gateways (bKash, Nagad, SSLCommerz, AmarPay) | **Shipped** |
| SMS gateway (SSL Wireless primary, BulkSMS BD fallback) via BullMQ | **Shipped** — `SMS-INTEGRATION-REPORT.md` |
| Express 3-step checkout (no OTP) — `checkout.service.ts`, `assignment.service.ts`, `claim.service.ts` | **Shipped** — `booking-flow-simplification-plan.md` §17 |
| National rollout engine (phases, regions, pre-registration) | **Shipped** — `NATIONAL-ROLLOUT-SYSTEM.md` |
| Campaign discovery (upcoming, locator, schedule, areas) | **Shipped** — `CAMPAIGN-LOCATOR.md` |
| Demand intelligence (district/city/area heatmaps, forecast) | **Shipped** — `DEMAND-INTELLIGENCE-SYSTEM.md` |
| Admin UI for **21 routes** under `/admin/campaigns/[id]/*` | **Shipped, but fragmented** (see §3) |
| Public landing v2 (mobile-first, Bangla/English, premium copy) | **Shipped** |

### 0.2 Headline problems found

1. **Two parallel booking subsystems coexist** — legacy OTP `POST /campaign/booking/` + new express `POST /public/checkout/init`. Legacy is still routed; public UI uses only express. Slot-counting and duplicate-rule semantics differ between paths.
2. **Slot capacity is per booking, not per cat.** Region capacity uses `catCount`; slot `bookedCount` increments by `1` regardless of `petCount`. Hard overbooking risk.
3. **Walk-ins do not consume slot capacity.** Only `walkInCount` increments. A busy slot can be silently overbooked at the venue.
4. **Three to four admin pages overlap on the same data.** Dashboard, Statistics, Reports all consume `/stats` + `/vaccination-stats`. Rollout-reports duplicates Demand-Intelligence. Certificates duplicates Verification. Pricing duplicates Edit.
5. **Reports are JSON dumps.** No CSV/XLSX/PDF export anywhere except certificate PDF. `canExportData` staff permission exists but no endpoint enforces or implements it.
6. **Daily summary and campaign stats have stub zeros** for walk-ins, queue wait, per-day vaccinations, vaccine-type breakdown.
7. **SMS lifecycle is partially wired.** Cancel / no-show templates exist but are not invoked from booking lifecycle. Reminder schedulers (`scheduleReminders`, `send2HourReminders`) are written but no cron registers them. OTP SMS bypasses `CampaignSmsLog`.
8. **No SMS budget controls.** Cost is estimated post-hoc; no caps, alerts, or low-balance throttling.
9. **No admin UI to edit per-campaign SMS templates** despite `CampaignSmsTemplate` table + service support.
10. **`/booking/[ref]` is session-only.** Deep links to a booking detail page fail in a new tab/device. No server-side fetch by claim credentials.
11. **Payment method selector in checkout is informational only.** Server uses one `PAYMENT_PROVIDER` env per environment. bKash/Nagad/SSL toggle in UI does not route to the chosen provider.
12. **Refund policy is unimplemented.** `06-payment-flow.md` describes 24h/4h tiered refunds; code does full-only refund and is not routed on admin.
13. **No audit log API on admin router.** Audit page synthesizes events from booking timestamps + staff stats; real `CampaignAuditLog` rows are written but never listed.
14. **No clinic operating-hours model.** Locations have `dailyCapacity` only; slots carry the time. Real-world venues with breaks/sessions cannot be modeled cleanly.
15. **No country awareness.** Schema is BD-implicit (BDT, `bd_*` geo, no `Campaign.countryId`). Conflicts with `PROJECT_CONTEXT.md` Global-Ready principle.
16. **Naming collisions** with `FundraisingCampaign`, `PricingCampaign`, `RecallCampaign` create developer confusion at imports.
17. **Documentation drift.** `PREMIUM-NATIONAL-CAMPAIGN-EXPERIENCE.md` and the old `BOOKING-FLOW-REPORT.md` describe a 7-step OTP wizard that the public app no longer ships. Hero still mentions "SMS OTP" in trust facts.

### 0.3 Strategic recommendation

The system is **functionally complete** for a Dhaka pilot. The redesign is therefore not about new features but about **consolidating duplicates, finishing partially-wired flows, hardening capacity accounting, and adding exports + budget controls** so the platform can carry **nationwide scale** without operational drift.

A **single phased redesign of ~6 weeks** (5 phases — see §10) is enough to ship this consolidation **without breaking the production booking flow** if guarded behind feature flags and update-only patches.

---

## 1. Module: Campaign Admin

### 1.1 Current state

| Layer | Where |
|-------|-------|
| API routes | `src/api/v1/modules/campaign/campaign.routes.ts` (admin router lines 687–1063) |
| Service | `src/api/v1/modules/campaign/campaign.service.ts` |
| Controller | `src/api/v1/modules/campaign/campaign.controller.ts` |
| Middleware | `src/api/v1/modules/campaign/campaign.middleware.ts` (`requireCampaignAdmin`, `requireCampaignAdminOrStaff`, `requireCampaignStaff`) |
| Validation | `src/api/v1/modules/campaign/campaign.validation.ts`, `config.validation.ts` |
| Types | `src/api/v1/modules/campaign/campaign.types.ts` |
| Errors | `src/api/v1/modules/campaign/campaign.errors.ts` |
| Config engine | `src/api/v1/modules/campaign/config.service.ts` + `CampaignConfig`, `CampaignConfigHistory` |
| Admin UI list | `bpa_web/app/admin/(larkon)/campaigns/page.tsx` |
| Admin UI detail (21 sub-routes) | `bpa_web/app/admin/(larkon)/campaigns/[id]/*` |
| Admin components | `bpa_web/src/bpa/campaign/admin/CampaignNav.tsx`, `CampaignForm.tsx`, `CampaignTrendChart.tsx`, `CampaignDashboardWidgets.tsx`, `CampaignStatusBadge.tsx`, `smsTemplates.ts` |
| API client | `bpa_web/lib/campaignApi.ts` |

### 1.2 Campaign lifecycle (verified in code)

```
DRAFT ──activate──► ACTIVE ◄──pause──► PAUSED
  │                    │
  │                    ├── end date / complete ──► COMPLETED
  │                    └── cancel ──► CANCELLED
```

`activateCampaign` rejects if `endDate < now`. `updateCampaign` sets `publishedAt` on first ACTIVE transition. No date validation on PAUSED→ACTIVE. **Visibility** (`PUBLIC | PRIVATE | UNLISTED`) and **pricingType** (`FREE | PAID | DONATION`) are orthogonal; `DONATION` is enum-only — no donation flow in services.

### 1.3 RBAC model

| Caller type | Middleware | Resolution |
|-------------|------------|------------|
| Platform admin | `requireCampaignAdmin` = JWT + `requirePermission("campaign.manage")` | Whitelisted/global.admin/country.admin also pass via `requirePermission` |
| Campaign staff | `requireCampaignStaff(permission)` | Resolves `campaignId` from params/body/booking/pet/location; checks `CampaignStaff` row + role matrix |
| Either | `requireCampaignAdminOrStaff(permission)` | **Exported but unused on routes** |

**Staff role permission matrix** (`staff.service.ts`):

| Role | canCheckIn | canRegisterWalkIn | canRecordVaccination | canManageQueue | canViewReports | canExportData | canManageStaff | canManageCampaign |
|------|------------|-------------------|----------------------|----------------|----------------|---------------|-----------------|-------------------|
| ADMIN | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| COORDINATOR | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| CHECK_IN | ✓ | ✓ | — | ✓ | — | — | — | — |
| VACCINATOR | — | — | ✓ | — | — | — | — | — |
| SUPPORT | ✓ | ✓ | — | — | — | — | — | — |

**`canExportData` is granted to ADMIN/COORDINATOR but no endpoint enforces or implements it.**

### 1.4 Admin UI page inventory (21 routes)

| # | Route | Purpose | API endpoints | Charts | Bulk / export | Overlaps with |
|---|--------|---------|--------------|--------|---------------|----------------|
| 1 | `/campaigns/page.tsx` | List campaigns | `GET /admin/campaigns` | — | — | — |
| 2 | `/campaigns/new` | Create + config | `POST /campaigns`, `PUT .../config` | — | — | `edit` |
| 3 | `/campaigns/[id]/page.tsx` | Dashboard / overview | `GET /campaigns/:id`, `GET .../stats`, composite | Apex area | — | **statistics**, **analytics**, **reports** |
| 4 | `[id]/edit` | Settings + config | `GET /campaigns/:id`, `PATCH`, `PUT .../config` | — | — | **pricing** |
| 5 | `[id]/locations` | Venues CRUD | `GET/POST/PATCH .../locations` | — | — | dashboard `byLocation`, analytics |
| 6 | `[id]/slots` | Slot view + bulk | `GET /public/locations/:id/slots`, `POST /slots/bulk`, `POST /slots/:id/close` | — | bulk create | — |
| 7 | `[id]/bookings` | Booking table | `GET .../bookings` (20/page) | — | — | **audit** |
| 8 | `[id]/staff` | Staff CRUD | `GET .../staff`, `staff-stats`, `POST/PATCH/DELETE /staff/:id` | — | — | **audit** |
| 9 | `[id]/vaccinations` | Legacy redirect | client → `/statistics` | — | — | **statistics** |
| 10 | `[id]/analytics` | Payment + location + zone analytics | `GET .../analytics` | tables only | — | dashboard, **statistics**, **pricing** |
| 11 | `[id]/statistics` | KPIs + trend + donut | `GET .../stats`, `/vaccination-stats` | Apex area + donut | — | **dashboard**, **reports** |
| 12 | `[id]/reports` | On-demand JSON | `GET .../stats`, `daily-summary`, `vaccination-stats` | — | **JSON download** | **statistics** |
| 13 | `[id]/sms` | Static template reference | **none** | — | — | (backend service only) |
| 14 | `[id]/certificates` | Cert list + lookup + PDF | `GET .../bookings`, `/public/certificates/:token` | — | PDF links | **verification** |
| 15 | `[id]/verification` | Verify tokens | `GET .../bookings` (50), `/public/verify/:token` | — | — | **certificates** |
| 16 | `[id]/rollout` | Phase/region CRUD | `GET .../rollout/phases`, region CRUD, BD geo | progress bars | — | **rollout-reports**, **demand-intelligence**, **pre-registrations** |
| 17 | `[id]/rollout-reports` | Demand snapshot | `GET .../rollout/reports/demand` | — | — | **demand-intelligence** |
| 18 | `[id]/demand-intelligence` | Full demand BI | `GET .../demand-intelligence` | CSS heatmap | — | **rollout-reports**, **analytics zones** |
| 19 | `[id]/pre-registrations` | Pre-booking / waiting / area demand | 3 endpoints + notify | — | **Notify SMS** | **demand-intelligence** |
| 20 | `[id]/pricing` | Pricing + revenue estimate | `GET /campaigns/:id`, `GET .../bookings`, `PATCH` | — | — | **edit**, **analytics** |
| 21 | `[id]/audit` | Pseudo audit trail | `GET .../bookings` (100), `staff-stats` | — | — | **bookings**, **staff** |

**`CampaignNav.tsx` exposes 18 tabs** (wraps on small screens). `/vaccinations` is a redirect kept for back-compat.

### 1.5 Limitations — Campaign Admin

1. **Config not loaded on edit.** `campaignAdminGetConfig` exists in lib but `edit/page.tsx` never calls it — operators see stale defaults when editing.
2. **No phase creation in UI.** `campaignAdminCreateRolloutPhase` is unused; phases must be seeded via `ensureDefaultRolloutPhases`.
3. **Staff assignment requires raw numeric `userId`.** No user picker / search.
4. **Campaign list has no UI pagination** despite API supporting `page`/`pageSize`; `CANCELLED` status not in filter.
5. **Booking list has no detail view, no date/location filters** (API supports them), no export, no row actions.
6. **Audit page is synthetic** — synthesizes events from booking and staff-stats; **no admin API to list `CampaignAuditLog` rows** despite the table being populated.
7. **`canExportData` permission is dead** — no export endpoint enforces it.
8. **18 tabs is too many.** No grouping; Bookings is buried last.
9. **Cert list hard-capped at 100, verification at 50.** Client-side search only.
10. **Slots page uses public API** for listing; admin slot CRUD endpoints partially unused (only bulk + close).
11. **Pre-registrations "Area demand" tab is raw `JSON.stringify`** — operator-unfriendly.
12. **No deep audit on lifecycle actions** beyond `logCampaignAudit` writes; no UI surface.

### 1.6 Duplicates — Campaign Admin

| Cluster | Pages | Recommendation |
|---------|-------|----------------|
| Operational stats | Dashboard, **Statistics**, Reports | Merge as tabs under an "Insights" hub; remove standalone Reports or repurpose as an Export center |
| Demand reports | Rollout-reports, Demand-intelligence, Pre-reg "Area demand" tab | Demand-intelligence supersedes — deprecate rollout-reports; format the pre-reg tab |
| Certificate trust | Certificates, Verification | Merge into one page with two modes (Issue / Verify) |
| Campaign settings | Edit, Pricing | Move pricing fields into Edit (already there in form), keep "Revenue estimate" as a sub-card |
| Vaccinations | Legacy `/vaccinations` route | Already a redirect — remove from `CampaignNav` (already done) but consider deleting the file |
| Cancellation / no-show flows | Booking row action vs Staff portal | Booking actions exist but no admin UI surfaces them |

### 1.7 Missing features — Campaign Admin

| Feature | Source |
|---------|--------|
| **`CampaignAuditLog` list API + UI** | Dead code + design intent |
| **SMS template CRUD UI** | `CampaignSmsTemplate` exists; only static reference page |
| **User picker for staff assignment** | UX |
| **Campaign list pagination, search, status badges including CANCELLED** | UX |
| **Bookings detail page (`/[id]/bookings/[ref]`)** | UX |
| **Bookings filters: date range, location, payment status** | API ready |
| **Phase create UI** | API ready |
| **Per-region drill-down (`rolloutRegionStats`)** | API ready |
| **Per-location stats panel** | API ready |
| **Checkout sessions monitoring page** | `campaignAdminCheckoutSessions` unused |
| **Daily summary card on dashboard** | `/daily-summary` only shown in JSON reports |
| **Refund / cancel admin tooling** | `processRefund` exists; no route |
| **Walk-in cash collection by staff** | `BUG-203` |
| **Single-slot create / update UI** | API ready |

---

## 2. Module: Campaign Locations

### 2.1 Current state

| Layer | Where |
|-------|-------|
| Service | `src/api/v1/modules/campaign/location.service.ts` |
| Service (slots) | `src/api/v1/modules/campaign/slot.service.ts` |
| Routes | `campaign.routes.ts` admin: `POST/PATCH/GET /locations`, `GET /locations/:id/stats`; public: `GET /campaigns/:id/availability`, `GET /locations/:id/slots` |
| Admin UI | `bpa_web/app/admin/(larkon)/campaigns/[id]/locations/page.tsx`, `[id]/slots/page.tsx` |

### 2.2 Location model (verified)

| Field | Purpose | Constraints |
|-------|---------|-------------|
| `name`, `code` | Identity | code unique within campaign |
| `address`, `addressJson` | Geo | `{ division, district, upazila, area }` — **no FK** to `BdDivision`/`BdDistrict`/`BdUpazila` |
| `latitude`, `longitude` | Map | optional |
| `dailyCapacity` | Daily soft cap | default **100** — **used only for walk-in quota**, not bookings |
| `operatingHours` | — | **Not modeled** — only slots carry time |
| `isActive` | Soft toggle | `deactivateLocation` flips |
| Relations | `slots`, `bookings`, `staff`, `rolloutRegions` | — |

### 2.3 Slot model (verified)

| Field | Purpose | Constraints |
|-------|---------|-------------|
| `locationId`, `date`, `startTime`, `endTime` | Identity | UNIQUE `(locationId, date, startTime)` |
| `capacity` | Per-slot capacity | default **50** |
| `bookedCount` | Confirmed bookings | DB trigger on `campaign_bookings` INSERT/UPDATE |
| `walkInCount` | Walk-ins | App-managed; **does not** affect `bookedCount` or status |
| `status` | `OPEN | FULL | CLOSED | CANCELLED` | BEFORE UPDATE trigger flips OPEN↔FULL |

**Capacity layers (concurrent):**

| Layer | Field | Granularity | DB enforcement |
|-------|-------|-------------|----------------|
| Slot | `capacity`, `bookedCount`, `walkInCount` | location × date × time | **Yes** — triggers |
| Location | `dailyCapacity` | venue × day | No — walk-in quota only |
| Region | `targetCapacity`, `bookedCount` on `CampaignRolloutRegion` | division/district/upazila | No — app increment |
| Campaign | `CampaignConfig.maxCapacity` | campaign-wide | No |

### 2.4 Limitations — Locations

1. **Slot `bookedCount` increments by 1 per booking** regardless of `petCount` / `catCount`. A 5-cat booking takes the same seat as a 1-cat booking. **Overbooking risk.**
2. **Region `bookedCount` increments by `catCount`** (express flow). **Inconsistent units** between slot and region capacity.
3. **Walk-ins do not consume slot `bookedCount`.** A FULL slot can still accept walk-ins; the venue can be overwhelmed.
4. **No operating hours / breaks / sessions** at the location level. Real venues with morning/afternoon sessions and lunch breaks must encode each session as a separate slot.
5. **No clinic/host metadata** (vet name, contact, equipment) on `CampaignLocation`.
6. **`addressJson` is free-form JSON**, not FK to BD geo tables — locator joins are string-matched and fragile.
7. **Walk-in quota is daily** but slots are sub-daily — quota math drifts when not all daily slots are equal.
8. **No location-level pricing override** (campaign price is global).
9. **No location archival / "completed" state.**

### 2.5 Duplicates — Locations

| Duplicate | Locations |
|-----------|-----------|
| Availability aggregation | `location.getLocationsWithAvailability` vs `slot.getAvailableSlots` vs `discovery.searchCampaignLocator` |
| Slot listing | Admin slots page uses public `GET /public/locations/:id/slots`; admin slot CRUD only partially used |
| Geo source | `addressJson` (free-form) vs `CampaignRolloutRegion.divisionId/districtId/upazilaId` (Int) vs `BdDivision/...` (FK) — three representations |

### 2.6 Missing — Locations

1. **`petCount`-aware slot capacity** (or document that 1 booking = 1 family seat regardless of pets).
2. **Walk-in slot consumption** so the slot reflects venue reality.
3. **Location operating hours / sessions / break windows** for richer slot generation.
4. **Vet roster per location** to link with `CampaignStaff` and recording.
5. **Location-level dashboards** beyond the cards on `/locations` (`campaignAdminLocationStats` unused).
6. **Distance-based location suggestion** in admin (today only on public locator).
7. **Inventory linkage** — vaccine doses per location, low-stock alert.

---

## 3. Module: Booking Flow

### 3.1 Current state

| Path | Entry | Auth | Booking timing | Status |
|------|--------|------|----------------|--------|
| **Express checkout** | `POST /public/checkout/init` → gateway → `fulfillCheckoutFromOrder` | None | Pay → Book | **Active** in `vaccination_2026` |
| **Legacy OTP** | `POST /campaign/auth/request-otp` → `verify-otp` → `POST /booking/` → `POST /booking/:ref/payment` | OTP JWT (24h) | Book (DRAFT) → Pay → CONFIRMED via webhook | **Still routed**, public UI removed |
| **Walk-in** | `POST /staff/walk-in` | Staff RBAC | Immediate | Active |
| **Claim** | `POST /public/booking/claim` (phone + ref + verification code) | None | Lookup-only | Active |

### 3.2 Booking lifecycle (verified)

```
DRAFT ──confirm/pay──► CONFIRMED ──check-in──► CHECKED_IN ──first pet──► IN_PROGRESS ──all pets──► COMPLETED
   │                        │                      │
   │                        ├── no-show ──► NO_SHOW (slot trigger releases bookedCount)
   │                        └── cancel ──► CANCELLED (slot trigger releases bookedCount)
   └── abandoned ──► (stays DRAFT or app cleanup)
```

Default insert status: `CONFIRMED` for free + express; `DRAFT` for paid legacy until webhook.

### 3.3 Express checkout (the active flow)

| Step | Public UI | API | What happens |
|------|-----------|-----|--------------|
| 1 — **Contact + Area** | `StepContactArea.tsx` | local validation + `checkRolloutArea` | Phone, division/district/upazila, address, cat count |
| 2 — **Pay** | `StepPayDirect.tsx` | `POST /public/checkout/init` (or `confirm-free`) | Creates `CampaignCheckoutSession` (PENDING, 30 min TTL); paid → gateway redirect; free → fulfill |
| Return | `/book/success?checkoutId=` polls `GET /checkout/:id/status` | — | After PAID, `fulfillCheckoutFromOrder` creates booking, increments region `bookedCount += catCount`, slot `bookedCount += 1`, sends SMS |
| 3 — **Done** | `StepSuccess.tsx` | — | Show booking ref, verification code, QR |

### 3.4 Limitations — Booking

1. **Two parallel flows coexist on the API.** Legacy `POST /campaign/booking/` is still mounted; if anyone calls it, slot semantics drift from express. No `CAMPAIGN_SIMPLIFIED_BOOKING` feature flag in code despite plan §8.3.
2. **Slot `bookedCount` counts bookings, not cats.** Express region path counts cats. **Mismatch.**
3. **Walk-ins bypass slot capacity** entirely.
4. **Checkout session abandonment cleanup.** `expireStaleCheckoutSessions()` is defined but **no cron registers it** — orphan PENDING rows accumulate.
5. **Init → fulfill capacity race.** Region/slot can fill in the 30-minute checkout window; user pays then fulfillment fails. No reserve / hold mechanism by design.
6. **`paymentMethod` ignored by gateway router.** UI selector (BKASH / NAGAD / SSL / AMARPAY) stored on `Order` but `getActivePaymentStrategy()` uses single `PAYMENT_PROVIDER` env. **User-visible promise broken.**
7. **No tiered refund.** `06-payment-flow.md` says full < 24h, 50% 4–24h, none < 4h. Code refunds full amount only and `processRefund` is **not routed on admin**.
8. **No "pay at venue" path** despite `payAtVenueEnabled` config flag.
9. **`DONATION` pricing type** is enum-only — no donation flow in services.
10. **QR HMAC checksum is not validated on scan** (BUG-103).
11. **Claim does not link booking to logged-in BPA user** — only returns details. There is no post-claim "save to my account" action.
12. **`findByVerificationCode` scans 30 days of bookings** — O(n) hot path on scale (not currently called from public, but available).
13. **`/booking/[ref]` is session-only** — no server fetch by `ref + code`; share/refresh in a new device fails.
14. **`/book/payment/failed` cancel URL omits ref** in express flow — failed pay loses recovery context.
15. **Express duplicate-booking rule** is "same phone + campaign + today"; legacy rule is "same booking date." Different semantics, same product.
16. **In-memory rate limits** (checkout, claim) — per-process only; multi-instance bypassable.
17. **Legacy 7-step components still in repo** (`StepOtp`, `StepClinic`, `StepSchedule`, `StepDetailsLight`) — unused but maintained; risk of confusion.
18. **Hero copy still mentions OTP** in `vaccination_2026` while the booking does not use OTP — messaging drift.

### 3.5 Duplicates — Booking

| Duplicated concern | Code locations |
|--------------------|----------------|
| Booking creation + slot increment | `booking.service.createBooking` vs `checkout.fulfillCheckoutSession` |
| Payment intent + Order creation | `createPaymentIntent` vs `createCheckoutPaymentIntent` |
| Webhook fulfillment | Booking-id path vs checkout-session-id path in `payment.webhooks.service` |
| Pricing breakdown | `bookingPricing.ts` (client) vs `campaignPricing.service` (server) — two implementations |
| Coupon validation | `bookingCoupons.ts` `findCoupon` (client) vs `campaignCoupon.service.validateCampaignCoupon` (server) — server path used in payment intent |
| Auth for "my booking" | OTP `GET /booking/my` vs claim form vs `/booking/list` UI |
| Success / detail UI | `StepSuccess` (wizard) + `/book/confirm/[ref]` (OTP API) + `/booking/[ref]` (claim cache) — 3 patterns |
| Payment retry | Express `/book/success` vs legacy `/book/payment` |
| Status mapping | `mapBookingRecordToDetails` (shared) + ad-hoc shaping in webhooks/checkout fulfill |

### 3.6 Missing — Booking

1. **Feature flag `CAMPAIGN_SIMPLIFIED_BOOKING`** to gate legacy.
2. **Booking detail by `ref + verificationCode`** — public GET that backs `/booking/[ref]` without OTP/session.
3. **Booking-to-account linking** (`POST /booking/:ref/link-account` after BPA login).
4. **Refund policy enforcement** (tiered, audited).
5. **Pay-at-venue flow** end-to-end (staff cash receipt, mark paid).
6. **Donation pricing flow** if business wants it.
7. **Cron** for `expireStaleCheckoutSessions` and `scheduleReminders`.
8. **Persistent rate limiting** (Redis-backed) for claim and checkout.
9. **HMAC checksum validation** on QR scan.
10. **Pet-level capacity** consistency between slot and region.
11. **Walk-in slot consumption** (or document venue-flow exception).
12. **Reschedule** (`BR-12`, `PO-6`) — not implemented; cancel + rebook required.
13. **Waitlist** (`FR-BK-14`) — not implemented.
14. **Resume checkout** from `checkoutId` so users can pick up an abandoned PENDING session.

---

## 4. Module: Analytics

### 4.1 Current state

| Service | Endpoint | Returns |
|---------|----------|---------|
| `analytics.service.ts` → `getCampaignAnalyticsDashboard` | `GET /admin/campaigns/:id/analytics` | Locations stats, top locations (with completed vax), payment analytics (online vs venue, revenue), coverage-zone counts, rollout region table |
| `campaign.service.ts` → `getCampaignStats` | `GET /admin/campaigns/:id/stats` | Totals, by status, by location (bookings only), by day, completion rate, show rate |
| `campaign.service.ts` → `getDailySummary` | `GET /admin/campaigns/:id/daily-summary` | One day: total/checked/vaccinated/no-show/walkIns/byType/queue |
| `vaccination.service.ts` → `getVaccinationStats` | `GET /admin/campaigns/:id/vaccination-stats` | Total pets, by vaccinationStatus, completed by vaccine type |
| `demand-intelligence.service.ts` → `getDemandIntelligence` | `GET /admin/campaigns/:campaignId/demand-intelligence` | District/city/area demand, heatmaps, 7-day velocity, 30-day forecast, capacity gap & priority |
| `discovery.service.ts` → `getPublicLiveStats` | `GET /public/discovery/live-stats` | Public counters |
| `rollout.service.ts` → `getRolloutDemandReports` / `getAreaDemandDashboard` / `getPreBookingDashboard` / `getWaitingListDashboard` | Various rollout dashboards | Pre-reg + booking aggregates |
| `smsCostMonitoring.service.ts` → `getCampaignSmsCostSummary` | `GET /admin/campaigns/:campaignId/sms/cost-summary` | SMS spend |

### 4.2 Limitations — Analytics

1. **Stub zeros.** `getCampaignStats` `byLocation` and `byDay` vaccination counts are **`0`** (placeholder). `getDailySummary` returns **`walkIns: 0`**, **`byType: []`**, **`queue: 0`**, and never calculates show rate.
2. **No date range filtering** on `getCampaignAnalyticsDashboard`. Returns lifetime totals.
3. **No trend / time series** on analytics endpoint — only top-N + totals.
4. **No funnel** (pre-register → checkout → paid → fulfilled → checked-in → vaccinated).
5. **Show rate / no-show rate** in `getCampaignStats` but not surfaced on Analytics page.
6. **`bookedCount` on region** can diverge from live booking counts (no reconciliation).
7. **Demand-intelligence has no caching** — full re-aggregation on every call (potentially expensive at scale).
8. **Demand-intelligence area heatmap** has no lat/lng — only district/city heatmaps are mappable.
9. **Bookings without parseable `ownerAddressJson`** are excluded from district/city/area buckets — under-reports demand.
10. **Pre-registration is excluded from `areaDemand`** (bookings only).
11. **Default pricePerCat = 500** in demand-intelligence revenue projection vs **0** in analytics revenue — **two pricing assumptions**.
12. **`projectedVaccinations = vaccinated + 0.85 × projectedDemand`** is a hard-coded heuristic — no tuning surface.
13. **No conversion metrics** (checkout init → fulfilled, claim attempts).

### 4.3 Duplicates — Analytics

| Overlap | Endpoints |
|---------|-----------|
| District/city demand | `getDemandIntelligence` vs `getRolloutDemandReports` vs `getAreaDemandDashboard` |
| Location bookings | `getBookingsByLocation` (analytics) vs `getTopCampaignLocations` (analytics, adds vax) vs `getCampaignStats.byLocation` (stats) |
| Coverage geography | `analytics.getBookingsByCoverageZone` vs `demand-intelligence` district ranking — keyed differently (rollout region vs address) |
| Revenue | `analytics.getPaymentAnalytics` vs `pricing/page.tsx` estimate (`bookings × price`) — different sources |

### 4.4 Missing — Analytics

1. **Funnel API** (pre-reg → checkout init → paid → fulfilled → completed) with conversion ratios.
2. **Date range parameters** on analytics dashboard.
3. **Trend chart** on analytics (vaccinations + bookings over time).
4. **Pre-registration → booking attribution** (linked by phone).
5. **Daily reconciliation** of region `bookedCount` vs live bookings.
6. **Cohort analytics** (pre-reg conversion by district).
7. **Repeat-booking & multi-pet** analytics.
8. **Wait-time / queue** analytics (raw data exists via `checkInTime` and `vaccinatedAt`).

---

## 5. Module: Reports

### 5.1 Current state

| Page / endpoint | Output |
|-----------------|--------|
| `/admin/campaigns/[id]/reports/page.tsx` | Dropdown of "Total stats / Daily summary (by date) / Vaccination breakdown" → renders **raw JSON in `<pre>`**; "Download JSON" button |
| `GET /admin/campaigns/:id/stats` | JSON |
| `GET /admin/campaigns/:id/daily-summary?date=` | JSON (incomplete — see §4.2) |
| `GET /admin/campaigns/:id/vaccination-stats` | JSON |
| `GET /admin/campaigns/:campaignId/rollout/reports/demand` | JSON |
| `GET /admin/campaigns/:campaignId/demand-intelligence` | JSON |

### 5.2 Limitations — Reports

1. **No file-format exports** anywhere (CSV / XLSX / PDF). JSON only.
2. **Reports page is a developer console** — raw JSON not consumable by operators.
3. **Reporting categories per `15-reporting-design.md` are unimplemented:** Operational (queue stats, staff performance), Campaign (booking trends excluding stub zeros, no-show analysis), Financial (revenue, refunds, payment status), Coverage (geographic, breed, age), Compliance (audit trail, verification log).
4. **No scheduled reports** (daily summary email, weekly digest).
5. **No real-time dashboard** with WebSocket (`16-realtime-design` implied but not in code).
6. **No "Location performance" table** as drafted in `15-reporting-design.md` §3.2 (booked / done / rate / wait / staff / score).
7. **`canExportData` permission is unused.**
8. **No audit log report** despite `CampaignAuditLog` being populated.

### 5.3 Duplicates — Reports

| Page / endpoint | Same data also at |
|-----------------|--------------------|
| Reports page | Statistics (charted) + Dashboard (KPI cards) |
| Daily summary report | Could surface on Dashboard |
| Vaccination breakdown | Statistics donut chart |
| Demand reports | Demand-intelligence (richer) + rollout-reports |

### 5.4 Missing — Reports

1. **Export API** with `format=csv|xlsx|pdf` per resource (bookings, vaccinations, SMS, audit, certificates, payments).
2. **Streamed CSV** for large exports.
3. **`Excel` workbooks** for finance/coverage reports per `15-reporting-design.md`.
4. **Audit log report** (filtered by action / actor / entity / date range).
5. **Verification log report** (cert verifications over time).
6. **Refund report** (when refund flow exists).
7. **Staff activity report** (actions per staff per period).
8. **Scheduled email reports** (daily summary at 8am to ops channel).
9. **Report templates** (admin-saveable filters).
10. **Audit log table on `CampaignAuditLog` writes** (the data is being written but not surfaced).

---

## 6. Module: SMS

### 6.1 Current state

```
Campaign sms.service / otp.service
  → campaign.smsQueue.enqueueCampaignSmsMessage
  → BullMQ notif_sms (notificationWorker)
  → smsGateway.service (SSL Wireless primary → BulkSMS BD fallback → mock)
  → CampaignSmsLog update + recordSmsCostOnLog
```

| Concern | Where |
|---------|-------|
| Templates | `CampaignSmsTemplate` + `sms.service.ts` defaults |
| Per-campaign templates | DB-backed; **no admin UI** |
| Delivery | BullMQ via SSL Wireless + BulkSMS BD providers |
| Webhook | `POST /public/sms/delivery-callback` (optional secret) |
| Cost monitor | `smsCostMonitoring.service.ts` — estimate per segment |
| Recovery | `smsQueueRecovery.service.ts` — re-enqueue stuck > 15 min |
| Health | `GET /public/sms/health` |

### 6.2 Implemented templates

| Code | Trigger | Logged to `CampaignSmsLog` |
|------|---------|----------------------------|
| `CAMPAIGN_OTP` | `otp.service.requestOtp` | **No** — bypasses log |
| `BOOKING_CONFIRMED` | `booking.service`, `checkout.service`, `payment.service` | Yes |
| `VACCINATION_COMPLETE` | `vaccination.service` (per pet) | Yes |
| `BOOKING_CANCELLED` | Helper only — **not called by lifecycle** | — |
| `NO_SHOW` | Helper only — **not called by lifecycle** | — |
| `REMINDER_24H`, `REMINDER_2H` | `scheduleReminders` / `send2HourReminders` — **no cron** | — |
| `ANNOUNCEMENT` | Template CRUD only — **no admin UI** | — |
| `CAMPAIGN_PREREG_OPEN` | `rollout.notifyPreRegisteredUsers` — **hardcoded body**, bypasses templates | **No** |

### 6.3 Limitations — SMS

1. **OTP SMS bypasses `CampaignSmsLog`** — invisible in cost summary, recovery, delivery webhook.
2. **`BOOKING_CANCELLED` and `NO_SHOW` helpers exist but are not invoked** by `booking.service.cancelBooking` / `markNoShow`.
3. **Reminders are not scheduled.** `scheduleReminders` (24h) and `send2HourReminders` exist as functions; no cron / BullMQ repeater registers them.
4. **2h reminder filter** uses hour diff 2–3, ignores minutes/timezone — fires once per hour-bucket only.
5. **Pre-reg open SMS uses a hardcoded body** instead of `CampaignSmsTemplate` lookup — inconsistent with the rest of the SMS layer.
6. **No SMS budget caps or low-balance alerts.** `estimatedCostBdt` per `CampaignSmsLog` row exists but no enforcement.
7. **No per-campaign template CRUD UI** in admin (BUG-109).
8. **No bulk SMS broadcast UI** (`FR-SMS-7`, `AD-8` from business reqs).
9. **No priority queues / dedicated lanes** (e.g. OTP must out-pace marketing — design doc P0–P3 not coded).
10. **Webhook unauthenticated by default** (`CAMPAIGN_SMS_WEBHOOK_SECRET` optional, no HMAC).
11. **No reschedule SMS** template (`BOOKING_RESCHEDULED` per design).
12. **Delivery webhook does not surface granular failure codes** — non-DELIVERED treated as FAILED.
13. **Verification of webhook origin IP** absent.
14. **Cost monitoring excludes QUEUED** state — early visibility limited.

### 6.4 Duplicates — SMS

| Overlap | Where |
|---------|-------|
| Generic notifications (`NotificationDelivery`) vs `CampaignSmsLog` | Two SMS audit tables, two SMS code paths |
| Pre-reg open SMS hardcoded body vs `CampaignSmsTemplate` | Two template authoring conventions |
| Direct send fallback vs queue path | `sms.service.sendSmsDirect` (legacy/dev) + queue path |

### 6.5 Missing — SMS

1. **Admin UI to manage `CampaignSmsTemplate`** (CRUD per code).
2. **Cron registration** for `scheduleReminders` and `send2HourReminders` (or BullMQ repeatable jobs at `notif_sms_reminder`).
3. **Cancel / no-show invocations** in booking lifecycle.
4. **Bulk announcement console** in admin (recipients filter + dry-run + cost preview).
5. **SMS budget config** (`CampaignConfig.smsBudgetBdt`, soft warning + hard cap).
6. **Low-balance alerts** when provider balance < threshold.
7. **Webhook HMAC** + provider IP allowlist.
8. **`BOOKING_RESCHEDULED`** template & event.
9. **Failure detail surface** in admin (top failure reasons, retry button).
10. **OTP logging** into `CampaignSmsLog` (or a separate `OtpAuditLog`).
11. **Per-template usage analytics** (sent / delivered / failed by template).

---

## 7. Module: Export

### 7.1 Current state — what exists

| Export | Format | Surface |
|--------|--------|---------|
| Reports page → "Download JSON" | **JSON** | `bpa_web/.../campaigns/[id]/reports/page.tsx` |
| Certificate PDF | **JSON `{ pdf: base64, filename }`** | `GET /public/certificates/:token/pdf` (Puppeteer HTML → A4 PDF → base64) |
| Certificate QR | base64 PNG embedded in JSON | `GET /public/certificates/:token` |
| `canExportData` role flag | — | Defined on ADMIN / COORDINATOR; **not enforced anywhere** |

### 7.2 Limitations — Export

1. **No CSV / XLSX / streamable export** anywhere.
2. **Certificate PDF** is base64 in JSON, not an `application/pdf` attachment — browsers cannot direct-download.
3. **Reports page download** is JSON only; not consumable by Excel-using operations teams.
4. **No "Export bookings"** button on bookings page.
5. **No "Export vaccinations"**, "Export SMS logs", "Export audit", "Export payments / refunds".
6. **No export audit trail** (who exported what, when).
7. **No export rate limiting** (large CSV streaming protection).
8. **No async / scheduled exports** (e.g. daily CSV to ops S3 bucket / MinIO).

### 7.3 Missing — Export (consolidated)

| Resource | Suggested endpoint | Format(s) | Notes |
|----------|-------------------|-----------|-------|
| Bookings | `GET /admin/campaigns/:id/bookings/export?format=csv&filter=…` | CSV, XLSX | Use existing booking filters |
| Vaccinations | `GET /admin/campaigns/:id/vaccinations/export` | CSV, XLSX | Include vaccine type, batch, vet |
| Payments | `GET /admin/campaigns/:id/payments/export` | CSV, XLSX | From `Order` rows tagged `campaign_booking:` / `campaign_checkout:` |
| SMS logs | `GET /admin/campaigns/:id/sms/export` | CSV | Filter by status / template |
| Audit log | `GET /admin/campaigns/:id/audit/export` | CSV | From `CampaignAuditLog` (also needs list API) |
| Pre-registrations | `GET /admin/campaigns/:id/pre-registrations/export` | CSV, XLSX | For ops outreach |
| Demand intelligence | `GET /admin/campaigns/:id/demand-intelligence/export` | XLSX (multi-sheet) | District + city + area + forecast |
| Certificates batch | `GET /admin/campaigns/:id/certificates/batch.zip` | ZIP of PDFs | Per `10-certificate-design.md` |
| Daily summary | `GET /admin/campaigns/:id/daily-summary/export?date=&format=pdf` | PDF | Printable for venue |
| Scheduled exports | Background BullMQ job → MinIO | CSV / XLSX | Per campaign config |

All exports must enforce `canExportData` (or `campaign.manage`) and write a `CampaignAuditLog` row with `entityType: "Export"`.

---

## 8. Cross-cutting concerns

### 8.1 Multi-country readiness

| Gap | Impact |
|-----|--------|
| `Campaign.countryId` missing | Cannot scope by country (PROJECT_CONTEXT.md "country-first" violated) |
| `currency` is string default `"BDT"` | Not FK to Country |
| Rollout uses `BdDivision`/`BdDistrict`/`BdUpazila` (BD-only) — bare Int FKs to bd_* | Cannot model non-BD geography |
| `estimatedCostBdt` column on `CampaignSmsLog` | BDT-specific |
| Booking phone validators assume BD format `01[3-9]XXXXXXXX` | Single-country |
| `Order.branchId` required — campaign uses organizer's default branch | BD BPA org assumption |

### 8.2 Schema duplicates / legacy

| Candidate | Verdict |
|-----------|---------|
| `schema_final_clean/` parallel tree | **Stale snapshot** — missing all 2026 campaign tables. Delete or archive. |
| `schema/` partial split | **Incomplete** — campaign not extracted from monolith |
| Naming collisions: `FundraisingCampaign`, `PricingCampaign`, `RecallCampaign` | Not duplicates of feature, just naming risk |
| `CampaignSmsLog` vs `NotificationDelivery` | Two SMS audit tables — intentional separation but documentation needs to make this explicit |
| `CampaignCheckoutSession.bookingId` column | **Orphan** — only `CampaignBooking.checkoutSessionId` has a Prisma relation |

### 8.3 Stale documentation

| Doc | Drift |
|-----|-------|
| `PREMIUM-NATIONAL-CAMPAIGN-EXPERIENCE.md` | Describes 7-step OTP booking — the public app no longer uses OTP for booking |
| `BOOKING-FLOW-REPORT.md` (vaccination_2026 docs) | Describes the same superseded 7-step flow |
| `IMPLEMENTATION_PROGRESS.md` | Phases I–K marked "pending" although frontends shipped |
| Hero copy / trust facts (landing) | Still names "SMS OTP" as a trust signal |
| `12-web-admin-design.md` | Expected admin layout vs the 21-route reality |

### 8.4 Test coverage gaps (from `03-BUG-LIST.md`)

- No Supertest / integration tests for `/campaign/booking/*`
- No tests for `campaign-link` module
- No widget / integration tests in `bpa_app`
- No load / performance suite per `20-qa-strategy.md`

### 8.5 Security gaps

| Gap | Severity |
|-----|----------|
| QR HMAC checksum not validated on scan | Low (defense-in-depth) |
| Payment webhook no IP allowlist | Medium (secret header optional) |
| SMS delivery webhook unauthenticated by default | Open (BUG-106) |
| In-memory rate limits (checkout, claim) | Medium at multi-instance |
| Admin RBAC `campaign.manage` not seeded automatically | Low (BUG-114) |

---

## 9. Target architecture

The redesign **does not introduce a new framework**. It consolidates the existing campaign module by:

1. **Single canonical booking path** (express checkout). Legacy OTP routes gated behind `CAMPAIGN_LEGACY_BOOKING_ENABLED=false` by default.
2. **Capacity unit reform** — `bookedCount` increments by `petCount` for both slot and region, **OR** explicit "1 booking = 1 family slot" rule documented and walk-ins included in slot count.
3. **Admin UI consolidation** — 21 routes collapse to 12 (see §9.1).
4. **Export center** — single page with one row per exportable resource × format.
5. **SMS lifecycle completion** — cancel, no-show, reminders, broadcast.
6. **Reports with file formats** — CSV/XLSX/PDF for each report category.
7. **Audit log API + page** — surface what is already being written.
8. **Country awareness** — add `Campaign.countryId` (nullable for BD-implicit back-compat).
9. **Documentation reconciliation** — single canonical source of truth (this document + the simplification plan).

### 9.1 Proposed admin information architecture

| Old (21 routes) | New (12 routes) |
|-----------------|-----------------|
| Dashboard | **Overview** (dashboard) |
| Statistics, Reports, Vaccinations | **Insights** (sub-tabs: KPIs · Trends · Daily · Vaccinations) |
| Analytics | **Analytics** (payments · zones · top venues) — kept distinct |
| Demand-intelligence, Rollout-reports, Pre-registrations (area-demand tab) | **Demand** (heatmap · districts · cities · waiting list · pre-bookings) |
| Rollout (phases + regions) | **Rollout** (phases + regions, with create-phase UI) |
| Locations, Slots | **Venues** (locations list with slot drawer + bulk create) |
| Bookings | **Bookings** (with detail page, filters, export) |
| Staff | **Staff** (with user picker) |
| Certificates, Verification | **Certificates** (tabs: Issue / Verify / Logs) |
| SMS | **SMS** (templates CRUD · logs · broadcast · cost) |
| Pricing | folded into **Settings** (edit + config history + pricing) |
| Audit | **Audit** (`CampaignAuditLog` rows, filtered) |
| Edit | **Settings** (campaign + config + pricing + history) |
| — | **Exports** (download center: bookings, vaccinations, SMS, audit, demand, payments) |
| `/vaccinations` legacy redirect | remove |

### 9.2 Capacity model decisions (pick one before §10 starts)

| Option | Slot `bookedCount` | Slot `walkInCount` | Region `bookedCount` | Pros | Cons |
|--------|--------------------|--------------------|--------------------|------|------|
| **A — Pet-aware** | `+= petCount` | `+= petCount` | `+= catCount` | Accurate venue load | DB trigger rewrite; migration of historical counts |
| **B — Family-seat** (current legacy semantic, document & enforce) | `+= 1` | `+= 0` (still ignored) | `+= 1` (change from cats) | No trigger change | Region semantics change; walk-ins still uncounted |
| **C — Hybrid** | `+= petCount`, walk-ins included | `+= petCount` | `+= catCount` | Walk-in safety + pet accuracy | Most code/trigger work |

Recommended: **Option C** for nationwide scale. Implement behind `CAMPAIGN_CAPACITY_MODEL=pet-aware` flag; reconcile historical rows in a one-shot migration script (not a destructive `migrate reset`).

### 9.3 Lifecycle hardening

| Lifecycle | Add |
|-----------|-----|
| Booking | Reschedule (`PO-6`); Waitlist (`FR-BK-14`); Reissue cert |
| Campaign | Re-open from COMPLETED (admin override with audit reason) |
| Checkout | Resume from `checkoutId`; cron expiry |
| Pre-reg | `CONVERTED` set automatically when phone matches a paid booking |

### 9.4 Payment hardening

1. **Per-request gateway selection** — checkout init accepts `paymentMethod` and routes to a per-method strategy; current single-`PAYMENT_PROVIDER` becomes a **fallback default**.
2. **Tiered refund** — implement `06-payment-flow.md` policy with `processRefund` exposed on admin (`POST /admin/bookings/:ref/refund`).
3. **Pay-at-venue** — staff endpoint to record cash + mark `OrderPayment` paid + booking confirmed if pending.
4. **Webhook IP allowlist** + signature verification per provider.

### 9.5 Documentation reconciliation

- This master plan is the **canonical audit + redesign**.
- Re-version `IMPLEMENTATION_PROGRESS.md` once redesign phases land.
- Mark **`PREMIUM-NATIONAL-CAMPAIGN-EXPERIENCE.md`** and **`BOOKING-FLOW-REPORT.md` (in vaccination_2026)** as **HISTORICAL** with banners pointing to `booking-flow-simplification-plan.md`.
- Promote `booking-flow-simplification-plan.md` as the canonical booking design.

---

## 10. Phased redesign plan

All phases follow `BPA_STANDARD.md`:
- **No port changes** (3000 API, 3100–3105 Next.js).
- **No UI redesign** outside WowDash patterns.
- **No destructive Prisma migrations** — additive only; new migrations + `migrate deploy` + integrity check.
- **No deletion of working code** — feature-flag legacy, do not remove files.
- **Update-only patches** with explicit touch-point list per task.

Effort estimates are calendar-time engineering work, single backend + single frontend engineer in parallel where possible.

### Phase R1 — Foundations & data integrity (week 1)

**Goal:** Lock the capacity model and add the audit/exports skeleton without changing UX.

| # | Task | Touch points |
|---|------|--------------|
| R1.1 | Add `CAMPAIGN_CAPACITY_MODEL` env + boolean `petCountAware` config helper | `campaign.utils.ts`, `booking.service.ts`, `checkout.service.ts` |
| R1.2 | New Prisma migration: add `CampaignAuditLog` GET admin route filters; **no schema change yet** | `campaign.routes.ts` |
| R1.3 | Reconciliation script `scripts/reconcile-campaign-counts.ts` (read-only audit) | `backend-api/scripts/` |
| R1.4 | Add `CAMPAIGN_LEGACY_BOOKING_ENABLED` env (default `false`); gate `POST /campaign/booking/` | `campaign.routes.ts` |
| R1.5 | Cron registration for `expireStaleCheckoutSessions` (BullMQ repeatable) | `infrastructure/queue/*` |
| R1.6 | Cron registration for `scheduleReminders` (24h) and `send2HourReminders` | same |
| R1.7 | Webhook hardening: enforce optional secrets where present, log unauthenticated attempts | `campaign.routes.ts`, `payment.webhooks.service.ts`, `sms.controller.ts` |
| R1.8 | Persistent rate limits via Redis for checkout init + claim (fallback to memory) | `checkout.service.ts`, `claim.service.ts` |
| R1.9 | `CampaignAuditLog` GET admin list endpoint + UI (replace synthetic audit page) | `campaign.routes.ts`, `bpa_web/.../audit/page.tsx` |
| R1.10 | Documentation: mark `BOOKING-FLOW-REPORT.md` (vaccination_2026), `PREMIUM-NATIONAL-CAMPAIGN-EXPERIENCE.md` as HISTORICAL with banner | docs/ |

**Acceptance:** Reconciliation script reports current vs expected counts. Legacy booking returns 410 with hint when env is `false`. Cron jobs visible in BullMQ dashboard.

### Phase R2 — SMS lifecycle completion (week 2)

**Goal:** Wire missing SMS events, add template CRUD + broadcast + budget controls.

| # | Task | Touch points |
|---|------|--------------|
| R2.1 | Wire `BOOKING_CANCELLED` SMS in `booking.service.cancelBooking` (both staff + public) | `booking.service.ts` |
| R2.2 | Wire `NO_SHOW` SMS in `booking.service.markNoShow` | `booking.service.ts` |
| R2.3 | Add `BOOKING_RESCHEDULED` template + event hook | `sms.service.ts`, `booking.service.ts` |
| R2.4 | OTP logging into `CampaignSmsLog` with template `CAMPAIGN_OTP` | `otp.service.ts` |
| R2.5 | Pre-reg open SMS uses `CampaignSmsTemplate` lookup (not hardcoded body) | `rollout.service.ts` |
| R2.6 | Admin API + UI for `CampaignSmsTemplate` CRUD | `campaign.routes.ts`, `sms` admin page |
| R2.7 | Bulk announcement endpoint (filter audience by booking status, district, attended), dry-run + cost preview | new `sms.broadcast.service.ts` |
| R2.8 | SMS budget config (`CampaignConfig.smsMonthlyBudgetBdt`, soft/hard caps) + admin UI | `config.service.ts`, settings page |
| R2.9 | Failure surface: top failure reasons table + retry button | sms admin page |
| R2.10 | Webhook HMAC + provider IP allowlist | `sms.controller.ts`, `payment.webhooks.service.ts` |

**Acceptance:** Cancel/no-show triggers SMS visible on `CampaignSmsLog`. Admin can edit a template and send a test broadcast. Cost summary shows OTP + broadcast lines.

### Phase R3 — Exports & reports (week 3)

**Goal:** Eliminate JSON-dump reports; deliver CSV/XLSX/PDF for all major resources.

| # | Task | Touch points |
|---|------|--------------|
| R3.1 | Add `exporter` utility (streaming CSV; XLSX via `exceljs`) | `src/api/v1/utils/exporter.ts` |
| R3.2 | Export endpoints for bookings, vaccinations, SMS logs, audit log, pre-registrations, payments, demand intelligence | `campaign.routes.ts` |
| R3.3 | Audit log write on every export call (`entityType: "Export"`) | exporter middleware |
| R3.4 | Enforce `canExportData` (or `campaign.manage`) on export endpoints | `campaign.middleware.ts` |
| R3.5 | Replace Reports page with "Exports" hub + report previews | `reports/page.tsx` → rename to `exports/page.tsx`; keep redirect |
| R3.6 | Fill stub zeros in `getDailySummary` (walk-ins, byType, queue) + `getCampaignStats.byLocation/byDay` vaccination counts | `campaign.service.ts` |
| R3.7 | Daily summary PDF (printable for venue noticeboard) | `certificate.service` pattern reused |
| R3.8 | Async export job for large datasets (BullMQ → MinIO upload + email link) | `infrastructure/queue/exports/` |
| R3.9 | Add `format=csv|xlsx|pdf` query param convention + content negotiation | exporter |
| R3.10 | Certificate batch ZIP download per location/date | new admin endpoint |

**Acceptance:** Operator can download a filtered booking CSV from admin in one click. Audit log shows the export. Async job appears in BullMQ for 10k+ row exports.

### Phase R4 — Admin UX consolidation (week 4)

**Goal:** Collapse the 21-route admin UI into the 12-route IA from §9.1 without breaking existing URLs.

| # | Task | Touch points |
|---|------|--------------|
| R4.1 | Refactor `CampaignNav.tsx` to grouped tabs (Overview · Insights · Demand · Operations · Trust · SMS · Settings · Exports · Audit) | `CampaignNav.tsx` |
| R4.2 | New **Insights** page with sub-tabs (KPIs · Trends · Daily · Vaccinations) — preserves Dashboard/Statistics/Vaccinations/Reports URLs as redirects | `bpa_web/.../campaigns/[id]/insights/*` |
| R4.3 | New **Demand** page with tabs — supersedes rollout-reports + pre-reg area tab | `bpa_web/.../campaigns/[id]/demand/*` |
| R4.4 | New **Trust** page (Certificates + Verification merged) | `bpa_web/.../campaigns/[id]/trust/*` |
| R4.5 | New **Settings** page (Edit + Pricing + Config history) — load `getConfigHistory` on tab open | `bpa_web/.../campaigns/[id]/settings/*` |
| R4.6 | **Bookings detail page** at `[id]/bookings/[ref]/page.tsx` with timeline, payment, SMS log, vaccination | new page |
| R4.7 | **User picker** for staff assignment | new component `UserSearchPicker.tsx` |
| R4.8 | Pagination + filters (date, location, status, payment) on bookings list | `bookings/page.tsx` |
| R4.9 | Phase create UI in Rollout | `rollout/page.tsx` |
| R4.10 | Per-region drill-down using `campaignAdminRolloutRegionStats` | `rollout/page.tsx` |
| R4.11 | Add CANCELLED to status filter on campaign list + add UI pagination | `campaigns/page.tsx` |
| R4.12 | Keep all old routes as **307 redirects** to the new IA (no broken bookmarks) | next.config or page-level redirect |

**Acceptance:** Old URLs still resolve (redirect). Operators see fewer tabs. Bookings detail page works. Staff assignment uses search.

### Phase R5 — Booking & payment hardening (week 5)

**Goal:** Resolve capacity drift, payment selector mismatch, refund policy, and public booking detail.

| # | Task | Touch points |
|---|------|--------------|
| R5.1 | Apply capacity model decision (Option C recommended): pet-aware slot counter + walk-in inclusion | DB migration with new triggers; `slot.service.ts`, `booking.service.ts`, `checkout.service.ts` |
| R5.2 | Per-method payment routing in `payment.service` (bKash / Nagad / SSL / AmarPay per request) | `payment.service.ts`, `paymentProvider.config.ts` |
| R5.3 | Refund policy enforcement (tiered) + admin route `POST /admin/bookings/:ref/refund` | `payment.service.ts`, `campaign.routes.ts` |
| R5.4 | Pay-at-venue staff endpoint (`POST /staff/bookings/:id/cash-paid`) | `booking.controller.ts` |
| R5.5 | Public booking detail by `ref + verificationCode` (`POST /public/booking/detail`) + use on `/booking/[ref]` | `campaign.routes.ts`, `vaccination_2026/app/booking/[ref]/page.tsx` |
| R5.6 | Resume checkout by `checkoutId` from `/book?checkoutId=` | `BookingWizard.tsx` |
| R5.7 | QR HMAC validation on scan (BUG-103) | `qr.service.ts` |
| R5.8 | Reschedule endpoint + UI in claim flow | new `POST /public/booking/reschedule` |
| R5.9 | Waitlist endpoint + UI (`FR-BK-14`) — optional gated by `CampaignConfig.waitlistEnabled` | new |
| R5.10 | Booking-to-account linking endpoint (`POST /booking/:ref/link-account` after BPA login) | new |
| R5.11 | Reconciliation cron: nightly `bookedCount` drift check on `CampaignSlot` + `CampaignRolloutRegion` | `scripts/reconcile-campaign-counts.ts` scheduled |
| R5.12 | Stale-doc banners removed once redesign verified in staging | docs/ |

**Acceptance:** Slot capacity = pet count + walk-ins. UI payment method actually selects gateway. Admin can refund per policy. Public booking detail works without OTP/session.

### Phase R6 (optional — Q3) — Multi-country, multi-tenant

| # | Task |
|---|------|
| R6.1 | Add nullable `Campaign.countryId` (FK to `Country`) — default BD, backfill |
| R6.2 | Add `Campaign.currencyCode` (FK to `Country.currencyCode`) |
| R6.3 | Generalize geography: support non-BD geo via `Country → State → LocationCity` while keeping BD `bd_*` |
| R6.4 | Country-aware permission seeding (`country.admin` vs `campaign.manage` interplay) |
| R6.5 | Multi-language SMS template variant per template code |

---

## 11. Out-of-scope notes (acknowledged, deferred)

- Flutter `bpa_app` campaign module redesign — outside this audit.
- Vaccine inventory and dose tracking integration with permanent stock module.
- Full multi-tenant SaaS — country-readiness is the bridge; full tenancy is a separate program.
- Push notifications (FCM) — `bpa_app` v2 concern.

---

## 12. Touch-point index (file map for execution)

When any phase is executed, the agent must confirm the touch points below before changes. This list is the **single source of truth** for "what is affected by the redesign" — keep it updated as phases land.

### 12.1 backend-api

```
src/api/v1/modules/campaign/
  campaign.routes.ts            # add export endpoints, gate legacy
  campaign.service.ts           # fill stub stats; daily summary completeness
  campaign.middleware.ts        # enforce canExportData on export routes
  campaign.smsQueue.ts          # broadcast lane
  booking.service.ts            # cancel/no-show SMS; reschedule; waitlist; capacity unit
  checkout.service.ts           # capacity unit; resume; rate limits
  payment.service.ts            # per-method routing; tiered refund
  payment.webhooks.service.ts   # IP allowlist
  sms.service.ts                # broadcast; cost monitoring; OTP logging
  sms.controller.ts             # webhook HMAC
  smsCostMonitoring.service.ts  # budget enforcement
  rollout.service.ts            # pre-reg SMS via template
  config.service.ts             # smsMonthlyBudgetBdt field
  qr.service.ts                 # HMAC validate
  claim.service.ts              # Redis rate limit
  certificate.service.ts        # batch ZIP, application/pdf attachment
  analytics.service.ts          # funnel, date range
  vaccination.service.ts        # ensure cert URL consistency
prisma/
  migrations/<R1_xxx>_campaign_audit_index/        # new
  migrations/<R3_xxx>_export_audit/                # new
  migrations/<R5_xxx>_capacity_unit/               # new (triggers)
  migrations/<R5_xxx>_refund_policy/               # new
infrastructure/queue/
  campaign-reminder.worker.ts                      # new (or extend notif worker)
  checkout-expiry.worker.ts                        # new
  export.worker.ts                                 # new
scripts/
  reconcile-campaign-counts.ts                     # new
src/api/v1/utils/
  exporter.ts                                      # new
```

### 12.2 bpa_web (admin)

```
app/admin/(larkon)/campaigns/
  page.tsx                                         # pagination + filters
  [id]/page.tsx                                    # → Overview
  [id]/insights/page.tsx                           # new — replaces Statistics + Reports + Vaccinations
  [id]/insights/daily/page.tsx                     # new
  [id]/insights/vaccinations/page.tsx              # new
  [id]/demand/page.tsx                             # new — supersedes rollout-reports, pre-reg area tab
  [id]/trust/page.tsx                              # new — Certificates + Verification merged
  [id]/settings/page.tsx                           # new — Edit + Pricing + Config history
  [id]/bookings/[ref]/page.tsx                     # new — booking detail
  [id]/exports/page.tsx                            # new — export center
  [id]/audit/page.tsx                              # rewire to CampaignAuditLog list
  # existing pages remain as 307 redirects:
  [id]/statistics, [id]/reports, [id]/vaccinations
  [id]/rollout-reports, [id]/certificates, [id]/verification
  [id]/pricing, [id]/edit
src/bpa/campaign/admin/
  CampaignNav.tsx                                  # grouped tabs
  UserSearchPicker.tsx                             # new
  smsTemplates.ts                                  # remove — use API
lib/
  campaignApi.ts                                   # add export, broadcast, refund, reschedule, link-account
```

### 12.3 vaccination_2026 (public)

```
app/
  book/page.tsx                                    # resume by checkoutId
  book/payment/                                    # legacy — mark deprecated when LEGACY env=false
  booking/[ref]/page.tsx                           # server fetch via new public detail endpoint
  booking/list/page.tsx                            # remove or gate behind OTP
components/booking/
  BookingWizard.tsx                                # resume; remove dead step imports
  steps/                                           # archive unused Step* files
lib/
  campaignApi.ts                                   # add reschedule, detail-by-code, link-account
docs in vaccination_2026/
  PREMIUM-NATIONAL-CAMPAIGN-EXPERIENCE.md          # HISTORICAL banner
  BEFORE-AFTER-LANDING-COMPARISON.md               # accurate, no change
```

### 12.4 Documentation

```
docs/campaign-redesign/                            # this folder
  master-plan.md                                   # this file
docs/vaccination-campaign-2026/
  IMPLEMENTATION_PROGRESS.md                       # re-version after R1
  PREMIUM-NATIONAL-CAMPAIGN-EXPERIENCE.md          # HISTORICAL banner (in vaccination_2026 too)
  03-BUG-LIST.md                                   # add new bugs found here as P2/P3 entries
  04-database-design.md                            # cross-reference §6 of audit (missing indexes, archival)
  booking-flow-simplification-plan.md              # canonical booking design
  15-reporting-design.md                           # export deliverables linked to R3
  10-certificate-design.md                         # batch ZIP linked to R3
```

---

## 13. Decision log (open questions for product)

Before R1 starts, product/leadership confirmation needed on:

| # | Question | Default proposed |
|---|----------|------------------|
| 1 | Capacity model — Option A / B / C? | **C — pet-aware + walk-ins included** |
| 2 | Hold slot during 30-min checkout? | **No** (current) — re-validate at fulfill |
| 3 | Donation pricing in 2026 campaign? | **No** — enum stays, no flow built |
| 4 | Pay-at-venue in 2026? | **Yes** — staff endpoint in R5 |
| 5 | Reschedule allowed? | **Yes — once, up to 24h before slot** |
| 6 | Waitlist? | **Optional via config flag, default off** |
| 7 | Multi-country in 2026? | **No** — R6 deferred to Q3 |
| 8 | Keep legacy OTP booking route accessible to staff testing? | **Yes — behind `CAMPAIGN_LEGACY_BOOKING_ENABLED=true` in dev only** |
| 9 | Bangla parity in `/book`, `/booking`, `/verify`? | **Yes, by R4 ship** |
| 10 | Admin "Export" page or embed export buttons on each page? | **Both — page is hub, per-page buttons for one-click** |

---

## 14. Bug list backfill (new findings)

To be added to `docs/vaccination-campaign-2026/03-BUG-LIST.md` under the next BUG IDs:

| Tentative ID | Component | Title | Priority |
|--------------|-----------|-------|----------|
| BUG-213 | Backend / Booking | Slot `bookedCount` not pet-aware (overbooking risk) | P1 |
| BUG-214 | Backend / Booking | Walk-ins bypass slot capacity | P1 |
| BUG-215 | Backend / Checkout | `expireStaleCheckoutSessions` not scheduled | P2 |
| BUG-216 | Backend / SMS | Cancel / no-show SMS not invoked from lifecycle | P1 |
| BUG-217 | Backend / SMS | Reminders not scheduled (`scheduleReminders`, `send2HourReminders`) | P1 |
| BUG-218 | Backend / SMS | Pre-reg open SMS hardcoded body bypasses templates | P2 |
| BUG-219 | Backend / SMS | OTP SMS not logged in `CampaignSmsLog` | P2 |
| BUG-220 | Backend / Stats | `getCampaignStats.byLocation/byDay` vaccination counts stubbed at 0 | P1 |
| BUG-221 | Backend / Stats | `getDailySummary` walkIns/byType/queue stubbed | P1 |
| BUG-222 | Backend / Payment | UI `paymentMethod` not routed to gateway (single `PAYMENT_PROVIDER`) | P1 |
| BUG-223 | Backend / Payment | Tiered refund policy not enforced; admin refund route missing | P2 |
| BUG-224 | Backend / Audit | `CampaignAuditLog` list API missing | P2 |
| BUG-225 | Web Admin | Reports page is JSON dump only | P2 |
| BUG-226 | Web Admin | No CSV/XLSX export anywhere | P1 |
| BUG-227 | Web Admin | Audit page is synthetic, not from `CampaignAuditLog` | P2 |
| BUG-228 | Web Admin | SMS template CRUD UI missing | P2 |
| BUG-229 | Web Admin | Phase create UI missing | P2 |
| BUG-230 | Web Admin | Staff user picker missing | P3 |
| BUG-231 | Web Public | `/booking/[ref]` is session-only — no shareable deep link | P2 |
| BUG-232 | Web Public | Legacy 7-step components and routes still in repo | P3 |
| BUG-233 | Web Public | Hero copy mentions OTP while booking does not use OTP | P2 |
| BUG-234 | Backend / Schema | `CampaignCheckoutSession.bookingId` orphan column | P3 |
| BUG-235 | Backend / Schema | `schema_final_clean/` stale parallel schema tree | P3 |
| BUG-236 | Backend / Schema | No `Campaign.countryId` — multi-country gap | P3 |
| BUG-237 | Backend / Booking | Two parallel booking paths active (legacy + express) | P2 |
| BUG-238 | Backend / SMS | No SMS budget caps / low-balance alerts | P2 |
| BUG-239 | Backend / Booking | Reschedule not implemented (`PO-6`) | P2 |
| BUG-240 | Backend / Booking | Waitlist not implemented (`FR-BK-14`) | P3 |

---

## 15. Verification checklist (before redesign sign-off)

- [ ] Product confirms §13 decision log answers
- [ ] Capacity option chosen with explicit semantics documented
- [ ] BUG IDs allocated by maintainer for §14 additions
- [ ] All redesign migrations reviewed against `PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`
- [ ] Touch-point list (§12) confirmed before each phase begins
- [ ] Feature flags created (`CAMPAIGN_LEGACY_BOOKING_ENABLED`, `CAMPAIGN_CAPACITY_MODEL`, `CAMPAIGN_SIMPLIFIED_BOOKING` if reintroduced) and documented in `.env.example`
- [ ] All new admin pages keep old URLs as redirects (`R4.12`)
- [ ] Stale docs banner-marked (`R1.10`)
- [ ] Reconciliation script run pre-/post-each phase

---

## 16. Related documents

- `docs/BPA_STANDARD.md`
- `docs/PROJECT_CONTEXT.md`
- `docs/vaccination-campaign-2026/01-business-requirements.md`
- `docs/vaccination-campaign-2026/02-user-flows.md`
- `docs/vaccination-campaign-2026/04-database-design.md`
- `docs/vaccination-campaign-2026/05-api-design.md`
- `docs/vaccination-campaign-2026/06-payment-flow.md`
- `docs/vaccination-campaign-2026/08-sms-design.md`
- `docs/vaccination-campaign-2026/10-certificate-design.md`
- `docs/vaccination-campaign-2026/12-web-admin-design.md`
- `docs/vaccination-campaign-2026/15-reporting-design.md`
- `docs/vaccination-campaign-2026/booking-flow-simplification-plan.md`
- `docs/vaccination-campaign-2026/NATIONAL-ROLLOUT-SYSTEM.md`
- `docs/vaccination-campaign-2026/CAMPAIGN-LOCATOR.md`
- `docs/vaccination-campaign-2026/DEMAND-INTELLIGENCE-SYSTEM.md`
- `docs/vaccination-campaign-2026/SMS-INTEGRATION-REPORT.md`
- `docs/vaccination-campaign-2026/PHASE-2-AUDIT.md`
- `docs/vaccination-campaign-2026/IMPLEMENTATION_PROGRESS.md`
- `docs/vaccination-campaign-2026/03-BUG-LIST.md`
- `docs/vaccination-campaign-2026/UAT-EXECUTION-REPORT.md`
- `docs/vaccination-campaign-2026/PAYMENT-AUDIT-REPORT.md`
- `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`

---

*Document version: 1.0 — June 4, 2026. Planning only; no code modified.*
